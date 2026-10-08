import type { WebSocket } from 'ws';
import type { AuthEvent, AuthInteraction, AuthPrompt, AuthType } from '@earendil-works/pi-ai';
import type { LLM } from './llm.ts';

/** Messages sent from server to browser during a login flow. */
export type LoginServerMessage =
  | { type: 'prompt'; id: number; prompt: Omit<AuthPrompt, 'signal'> }
  | { type: 'prompt_cancel'; id: number }
  | { type: 'notify'; event: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type LoginClientMessage = { type: 'answer'; id: number; value: string } | { type: 'cancel' };

/** One login per provider: OAuth flows bind fixed local callback ports. */
const active = new Map<string, { controller: AbortController; done: Promise<unknown> }>();
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Bridge a pi-ai login flow (which only runs in Node) to the browser: prompts
 * and notifications are forwarded over the socket, answers come back.
 */
export async function runLogin(socket: WebSocket, llm: LLM, provider: string, type: AuthType): Promise<void> {
  const previous = active.get(provider);
  if (previous) {
    previous.controller.abort();
    await Promise.race([previous.done, new Promise((r) => setTimeout(r, 3000))]);
    if (socket.readyState !== socket.OPEN) return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
  const pending = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  const send = (m: LoginServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
  };
  // pi-ai only releases an OAuth callback server once its pending prompt settles,
  // so every abort (cancel, disconnect, replacement, timeout) must reject prompts.
  const rejectPending = (reason: string) => {
    for (const p of pending.values()) p.reject(new Error(reason));
    pending.clear();
  };
  controller.signal.addEventListener('abort', () => rejectPending('Login cancelled'));

  socket.on('message', (raw) => {
    let msg: LoginClientMessage;
    try {
      msg = JSON.parse(String(raw)) as LoginClientMessage;
    } catch {
      return;
    }
    if (msg.type === 'cancel') {
      controller.abort();
    } else if (msg.type === 'answer') {
      pending.get(msg.id)?.resolve(msg.value);
      pending.delete(msg.id);
    }
  });
  socket.on('close', () => controller.abort());

  const interaction: AuthInteraction = {
    signal: controller.signal,
    prompt: (p) =>
      new Promise<string>((resolve, reject) => {
        const id = nextId++;
        const { signal, ...rest } = p;
        pending.set(id, { resolve, reject });
        send({ type: 'prompt', id, prompt: rest });
        signal?.addEventListener('abort', () => {
          if (pending.delete(id)) {
            send({ type: 'prompt_cancel', id });
            reject(new Error('Prompt superseded'));
          }
        });
      }),
    notify: (event: AuthEvent) => send({ type: 'notify', event }),
  };
  // An aborted login can release its local callback port a moment after its
  // promise settles, so retry briefly when the port is still busy.
  const attempt = async (n: number): Promise<unknown> => {
    try {
      return await llm.models.login(provider, type, interaction);
    } catch (e) {
      if (n < 10 && /EADDRINUSE/.test(String((e as Error).message)) && !controller.signal.aborted) {
        await new Promise((r) => setTimeout(r, 400));
        return attempt(n + 1);
      }
      throw e;
    }
  };
  const done = attempt(0)
    .then(() => {
      send({ type: 'done' });
      socket.close();
    })
    .catch((e: Error) => {
      send({ type: 'error', message: controller.signal.aborted ? 'Login cancelled' : e.message || String(e) });
      socket.close();
    })
    .finally(() => {
      clearTimeout(timeout);
      if (active.get(provider)?.controller === controller) active.delete(provider);
    });
  active.set(provider, { controller, done });
}
