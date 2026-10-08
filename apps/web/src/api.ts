import type { BackendFlavor, GenerateRequest, Preset, Shelf, Story, StoryMeta, TokenLogprob } from '@novelwriter/core';

export interface ProviderInfo {
  id: string;
  name: string;
  apiKey: { name: string; interactive: boolean } | null;
  oauth: { name: string; label: string | null; subscription: boolean } | null;
  configured: boolean;
  source?: string;
  stored: 'api_key' | 'oauth' | null;
  error?: string;
  custom: boolean;
  modelCount: number;
}

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  api: string;
  /** Server kind; decides which generation settings reach the model (see core/backend.ts). */
  flavor: BackendFlavor;
}

/** OpenAI-compatible speech endpoint (the key comes back masked). */
export interface TTSConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
}

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  flavor?: BackendFlavor;
  models: { id: string; name?: string; contextWindow?: number; maxTokens?: number }[];
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

const put = (url: string, body: unknown) => fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  listStories: () => fetch('/api/stories').then((r) => json<StoryMeta[]>(r)),
  getStory: (id: string) => fetch(`/api/stories/${id}`).then((r) => json<Story>(r)),
  saveStory: (s: Story) => put(`/api/stories/${s.id}`, s).then((r) => json<StoryMeta>(r)),
  deleteStory: (id: string) => fetch(`/api/stories/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),
  getSettings: () => fetch('/api/settings').then((r) => json<Record<string, unknown>>(r)),
  saveSettings: (s: unknown) => put('/api/settings', s).then((r) => json<{ ok: true }>(r)),
  getPresets: () => fetch('/api/presets').then((r) => json<Preset[]>(r)),
  savePresets: (p: Preset[]) => put('/api/presets', p).then((r) => json<{ ok: true }>(r)),
  getShelves: () => fetch('/api/shelves').then((r) => json<Shelf[]>(r)),
  saveShelves: (s: Shelf[]) => put('/api/shelves', s).then((r) => json<{ ok: true }>(r)),
  providers: () => fetch('/api/providers').then((r) => json<ProviderInfo[]>(r)),
  models: (provider?: string) => fetch(`/api/models${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`).then((r) => json<ModelInfo[]>(r)),
  setKey: (provider: string, key: string) => put(`/api/auth/${provider}/key`, { key }).then((r) => json<{ ok: true }>(r)),
  logout: (provider: string) => fetch(`/api/auth/${provider}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),
  customProviders: () => fetch('/api/custom-providers').then((r) => json<CustomProvider[]>(r)),
  saveCustomProviders: (c: CustomProvider[]) => put('/api/custom-providers', c).then((r) => json<{ ok: true }>(r)),
  tokenize: (model: { provider: string; id: string }, text: string) =>
    fetch('/api/tokenize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, text }) }).then((r) =>
      json<{ tokenizer: 'o200k' | 'remote' | 'none'; ids: number[] }>(r),
    ),
  ttsConfig: () => fetch('/api/tts/config').then((r) => json<TTSConfig>(r)),
  saveTtsConfig: (c: TTSConfig) => put('/api/tts/config', c).then((r) => json<{ ok: true }>(r)),
  ttsVoices: () => fetch('/api/tts/voices').then((r) => json<string[]>(r)),
  probeCustom: (baseUrl: string, apiKey?: string, id?: string) =>
    fetch('/api/custom-providers/probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl, apiKey, id }) }).then((r) =>
      json<{ id: string }[]>(r),
    ),
};

export type GenerateEvent =
  | { type: 'delta'; text: string }
  | { type: 'logprobs'; tokens: TokenLogprob[] }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string };

/** Stream a generation from the server (SSE over fetch). */
export async function* generateStream(req: GenerateRequest, signal: AbortSignal): AsyncGenerator<GenerateEvent> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Generation failed: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (line) yield JSON.parse(line.slice(6)) as GenerateEvent;
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      yield { type: 'done', stopReason: 'aborted' };
      return;
    }
    throw e;
  }
}

/** Collect a whole (non-streamed to UI) generation. */
export async function generateText(req: GenerateRequest, signal?: AbortSignal, onDelta?: (all: string) => void): Promise<string> {
  let out = '';
  for await (const ev of generateStream(req, signal ?? new AbortController().signal)) {
    if (ev.type === 'delta') {
      out += ev.text;
      onDelta?.(out);
    } else if (ev.type === 'error') throw new Error(ev.message);
  }
  return out;
}

export type LoginPrompt =
  | { type: 'text' | 'secret' | 'manual_code'; message: string; placeholder?: string }
  | { type: 'select'; message: string; options: { id: string; label: string; description?: string }[] };

export type LoginEvent =
  | { type: 'info'; message: string; links?: { url: string; label?: string }[] }
  | { type: 'auth_url'; url: string; instructions?: string }
  | { type: 'device_code'; userCode: string; verificationUri: string; expiresInSeconds?: number }
  | { type: 'progress'; message: string };

export type LoginServerMessage =
  | { type: 'prompt'; id: number; prompt: LoginPrompt }
  | { type: 'prompt_cancel'; id: number }
  | { type: 'notify'; event: LoginEvent }
  | { type: 'done' }
  | { type: 'error'; message: string };

export function openLogin(provider: string, type: 'oauth' | 'api_key', onMessage: (m: LoginServerMessage) => void): { answer: (id: number, value: string) => void; cancel: () => void } {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/api/auth/login?provider=${encodeURIComponent(provider)}&type=${type}`);
  ws.onmessage = (e) => onMessage(JSON.parse(String(e.data)) as LoginServerMessage);
  ws.onerror = () => onMessage({ type: 'error', message: 'Connection to server failed' });
  return {
    answer: (id, value) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'answer', id, value })),
    cancel: () => {
      const bye = () => {
        ws.send(JSON.stringify({ type: 'cancel' }));
        ws.close();
      };
      // Closing a still-connecting socket can leave the server-side login (and its
      // callback port) running behind a proxy, so cancel explicitly once open.
      if (ws.readyState === ws.CONNECTING) ws.addEventListener('open', bye, { once: true });
      else if (ws.readyState === ws.OPEN) bye();
    },
  };
}
