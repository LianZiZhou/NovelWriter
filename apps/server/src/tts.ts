// Text-to-speech through an OpenAI-compatible `/audio/speech` endpoint (OpenAI, Kokoro-FastAPI, openedai-speech,
// LocalAI…). The key stays on the server; the browser only gets audio back.
import type { Storage } from './storage.ts';

export interface TTSConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  voice: string;
}

export const DEFAULT_TTS: TTSConfig = { baseUrl: 'https://api.openai.com/v1', model: 'tts-1', voice: 'alloy', apiKey: '' };
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'];
export const MASK = '••••';

export async function readTTS(storage: Storage): Promise<TTSConfig> {
  return { ...DEFAULT_TTS, ...(await storage.readJson<Partial<TTSConfig>>('tts.json', {})) };
}

export async function writeTTS(storage: Storage, next: Partial<TTSConfig>): Promise<void> {
  const prev = await readTTS(storage);
  const merged: TTSConfig = { ...prev, ...next, apiKey: next.apiKey === MASK ? prev.apiKey : (next.apiKey ?? prev.apiKey) };
  await storage.writeJson('tts.json', merged);
}

const base = (c: TTSConfig) => c.baseUrl.replace(/\/+$/, '');
const auth = (c: TTSConfig): Record<string, string> => (c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {});

/** Synthesize speech; returns the audio bytes and content type. */
export async function synthesize(c: TTSConfig, req: { text: string; voice?: string; model?: string; speed?: number; format?: string }): Promise<{ audio: Buffer; type: string }> {
  const format = req.format ?? 'mp3';
  const res = await fetch(`${base(c)}/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth(c) },
    body: JSON.stringify({ model: req.model || c.model, voice: req.voice || c.voice, input: req.text, response_format: format, ...(req.speed ? { speed: req.speed } : {}) }),
  });
  if (!res.ok) {
    let msg = `TTS endpoint returned HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } | string; detail?: string };
      msg = typeof body.error === 'string' ? body.error : (body.error?.message ?? body.detail ?? msg);
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return { audio: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? (format === 'mp3' ? 'audio/mpeg' : `audio/${format}`) };
}

/** Voices the endpoint offers: Kokoro-style `/audio/voices`, else OpenAI's list. */
export async function listVoices(c: TTSConfig): Promise<string[]> {
  try {
    const res = await fetch(`${base(c)}/audio/voices`, { headers: auth(c) });
    if (res.ok) {
      const json = (await res.json()) as { voices?: (string | { id?: string; name?: string })[] } | string[];
      const list = Array.isArray(json) ? json : (json.voices ?? []);
      const names = list.map((v) => (typeof v === 'string' ? v : (v.id ?? v.name ?? ''))).filter(Boolean);
      if (names.length) return names;
    }
  } catch {
    /* fall back */
  }
  return OPENAI_VOICES;
}
