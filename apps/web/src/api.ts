import { backendCaps, type BackendFlavor, type EmbeddingConfig, type EmbeddingConfigPatch, type OnnxDtype, type OnnxDevice, type GenerateRequest, type InstructTemplateId, type ModelCaps, type ModelReading, type NlpConfig, type NlpConfigPatch, type NlpTask, type Preset, type Shelf, type Story, type StoryMeta, type TokenLogprob } from '@novelwriter/core';

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
  /** What this model takes (flavor minus what the model rejects); older servers leave it out. */
  caps?: ModelCaps;
  /** Run as text completion: rendered in an instruct template, or raw story text. */
  completion?: 'instruct' | 'raw';
}

/** Capabilities of the selected model. */
export function capsOf(info: ModelInfo | undefined): ModelCaps {
  return info?.caps ?? backendCaps(info?.flavor ?? 'chat-only');
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
  completion?: 'off' | 'instruct' | 'raw';
  template?: InstructTemplateId | 'auto';
  models: { id: string; name?: string; contextWindow?: number; maxTokens?: number }[];
}

export interface EmbeddingTask {
  id: string;
  key: string;
  label: string;
  status: 'running' | 'done' | 'error' | 'canceled';
  received: number;
  total: number;
  current?: string;
  error?: string;
  startedAt: number;
}

export interface HardwareDevice {
  vendor: string;
  name: string;
  memoryMB?: number;
  driver?: string;
}

export interface HardwareInfo {
  os: string;
  arch: string;
  cpu: string;
  cores: number;
  memoryGB: number;
  gpus: HardwareDevice[];
  npus: HardwareDevice[];
  cuda: { driver: boolean; runtime12: boolean; cudnn9: boolean };
  vulkan: boolean;
  suggest: { onnxDevice: OnnxDevice; llamaVariant: string };
}

export interface EmbeddingStatus {
  runtime: { installed: boolean; version: string; dir: string; sizeMB: number; cudaProviders: boolean; cudaAvailable: boolean };
  llamaBuilds: { tag: string; variant: string; dir: string; sizeMB: number; installedAt: number }[];
  llama: { running: boolean; starting: boolean; pid?: number; url?: string; model?: string; args?: string[]; error?: string; log: string };
  models: { onnx: { repo: string; dtypes: OnnxDtype[]; sizeMB: number }[]; gguf: { repo: string; file: string; sizeMB: number }[]; totalMB: number };
  modelsDir: string;
  tasks: EmbeddingTask[];
  key: string;
}

export interface IndexStatus {
  key: string;
  total: number;
  indexed: number;
  running: boolean;
  error?: string;
  updatedAt: number;
}

export interface VectorSearchResult {
  hashes: string[];
  scores: number[];
  indexed: number;
  ms?: number;
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
const post = (url: string, body?: unknown, signal?: AbortSignal) =>
  fetch(url, { method: 'POST', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
const del = (url: string, body?: unknown) =>
  fetch(url, { method: 'DELETE', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

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
  embeddingConfig: () => fetch('/api/embeddings/config').then((r) => json<EmbeddingConfig>(r)),
  saveEmbeddingConfig: (c: EmbeddingConfigPatch) => put('/api/embeddings/config', c).then((r) => json<{ ok: true }>(r)),
  embeddingStatus: () => fetch('/api/embeddings/status').then((r) => json<EmbeddingStatus>(r)),
  hardware: (refresh = false) => fetch(`/api/embeddings/hardware${refresh ? '?refresh=1' : ''}`).then((r) => json<HardwareInfo>(r)),
  installRuntime: (which: 'onnx' | 'onnx-cuda' | 'llama') => post(`/api/embeddings/runtime/${which}`).then((r) => json<EmbeddingTask>(r)),
  removeRuntime: (which: 'onnx' | 'onnx-cuda') => del(`/api/embeddings/runtime/${which}`).then((r) => json<{ ok: true }>(r)),
  removeLlamaBuild: (tag: string, variant: string) => del(`/api/embeddings/runtime/llama/${encodeURIComponent(tag)}/${encodeURIComponent(variant)}`).then((r) => json<{ ok: true }>(r)),
  llamaDevices: () => fetch('/api/embeddings/llama/devices').then((r) => json<{ output: string }>(r)),
  llamaStart: () => post('/api/embeddings/llama/start').then((r) => json<{ url: string }>(r)),
  llamaStop: () => post('/api/embeddings/llama/stop').then((r) => json<{ ok: true }>(r)),
  downloadModel: (m: { kind: 'onnx'; repo: string; dtype?: OnnxDtype } | { kind: 'gguf'; model: string; quant: string }) => post('/api/embeddings/models', m).then((r) => json<EmbeddingTask>(r)),
  deleteModel: (m: { kind: 'onnx'; repo: string; dtype?: OnnxDtype } | { kind: 'gguf'; repo: string; file: string }) => del('/api/embeddings/models', m).then((r) => json<{ ok: true }>(r)),
  cancelTask: (id: string) => del(`/api/embeddings/tasks/${id}`).then((r) => json<{ ok: boolean }>(r)),
  nlpConfig: () => fetch('/api/nlp/config').then((r) => json<NlpConfig>(r)),
  saveNlpConfig: (c: NlpConfigPatch) => put('/api/nlp/config', c).then((r) => json<{ ok: true }>(r)),
  nlpStatus: () => fetch('/api/nlp/status').then((r) => json<{ installed: { id: string; sizeMB: number }[]; modelsDir: string }>(r)),
  downloadNlpModel: (id: string) => post('/api/nlp/models', { id }).then((r) => json<EmbeddingTask>(r)),
  deleteNlpModel: (id: string) => del('/api/nlp/models', { id }).then((r) => json<{ ok: true }>(r)),
  testNlp: (task: NlpTask, text: string) => post('/api/nlp/test', { task, text }).then((r) => json<{ text: string; result: unknown; ms: number }>(r)),
  /** What the local text-analysis models make of typed lines (nulls when none is set up). */
  nlpRead: (texts: string[], signal?: AbortSignal) => post('/api/nlp/read', { texts }, signal).then((r) => json<{ readings: (ModelReading | null)[] }>(r)),
  testEmbeddings: () => post('/api/embeddings/test').then((r) => json<{ dims: number; ms: number; queryMs: number; related: number; unrelated: number }>(r)),
  syncVectors: (storyId: string, text: string) => post(`/api/vectors/${storyId}/sync`, { text }).then((r) => json<IndexStatus>(r)),
  vectorStatus: (storyId: string, text?: string) => post(`/api/vectors/${storyId}/status`, { text }).then((r) => json<IndexStatus>(r)),
  searchVectors: (storyId: string, query: string, signal?: AbortSignal) => post(`/api/vectors/${storyId}/search`, { query }, signal).then((r) => json<VectorSearchResult>(r)),
  dropVectors: (storyId?: string) => del(storyId ? `/api/vectors/${storyId}` : '/api/vectors').then((r) => json<{ ok: true }>(r)),
  probeCustom: (baseUrl: string, apiKey?: string, id?: string) =>
    fetch('/api/custom-providers/probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl, apiKey, id }) }).then((r) =>
      json<{ id: string }[]>(r),
    ),
};

export type GenerateEvent =
  | { type: 'delta'; text: string }
  | { type: 'logprobs'; tokens: TokenLogprob[] }
  | { type: 'done'; stopReason: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }
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
