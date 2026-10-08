import type { WebSocket } from 'ws';
import type { AuthPrompt, AuthType } from '@earendil-works/pi-ai';
import type { LLM } from './llm.ts';

/** Messages sent from server to browser during a login flow. */
export type LoginServerMessage =
  | { type: 'prompt'; id: number; prompt: Omit<AuthPrompt, 'signal'> }
  | { type: 'prompt_cancel'; id: number }
  | { type: 'notify'; event: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type LoginClientMessage = { type: 'answer'; id: number; value: string } | { type: 'cancel' };

/**
 * Bridge a pi-ai login flow (which only runs in Node) to the browser: prompts
 * and notifications are forwarded over the socket, answers come back.
 */
export function runLogin(socket: WebSocket, llm: LLM, provider: string, type: AuthType): void {
  const controller = new AbortController();
  const pending = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  const send = (m: LoginServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
  };

  socket.on('message', (raw) => {
    let msg: LoginClientMessage;
    try {
      msg = JSON.parse(String(raw)) as LoginClientMessage;
    } catch {
      return;
    }
    if (msg.type === 'cancel') {
      controller.abort();
      for (const p of pending.values()) p.reject(new Error('Login cancelled'));
      pending.clear();
    } else if (msg.type === 'answer') {
      pending.get(msg.id)?.resolve(msg.value);
      pending.delete(msg.id);
    }
  });
  socket.on('close', () => {
    controller.abort();
    for (const p of pending.values()) p.reject(new Error('Connection closed'));
    pending.clear();
  });

  llm.models
    .login(provider, type, {
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
      notify: (event) => send({ type: 'notify', event }),
    })
    .then(() => {
      send({ type: 'done' });
      socket.close();
    })
    .catch((e: Error) => {
      send({ type: 'error', message: e.message || String(e) });
      socket.close();
    });
}
