import { useSettings, type SavedVoice } from '../../store/settings.ts';
import { useUI } from '../../store/ui.ts';

/**
 * Text to speech from two sources: the browser's SpeechSynthesis voices, or an OpenAI-compatible
 * `/audio/speech` endpoint (configured in Settings → Text to Speech, proxied by our server so the key stays there).
 * A saved voice (or a story voice set to "saved:<id>") brings its own system voice, speed and pitch.
 */
export interface SpeakOptions {
  /** A saved browser voice to use instead of the story voice. */
  voice?: SavedVoice;
  /** HypeBot comments use the HypeBot voice when one is set. */
  hypebot?: boolean;
}

let queue: HTMLAudioElement[] = [];
let generation = 0;

export function speak(text: string, opts: SpeakOptions | SavedVoice = {}): void {
  // A SavedVoice can be passed directly (it has its own id/rate), or options.
  const o: SpeakOptions = 'rate' in opts && 'id' in opts ? { voice: opts as SavedVoice } : (opts as SpeakOptions);
  if (!text.trim()) return;
  const s = useSettings.getState();
  if (s.ttsSource === 'endpoint') return void speakEndpoint(text, o.hypebot && s.ttsHypebotVoice ? s.ttsHypebotVoice : s.ttsEndpointVoice);
  if (!('speechSynthesis' in window)) return;
  const voiceId = o.hypebot && s.ttsHypebotVoice ? s.ttsHypebotVoice : s.ttsVoice;
  const saved = o.voice ?? (voiceId.startsWith('saved:') ? s.ttsSavedVoices.find((v) => `saved:${v.id}` === voiceId) : undefined);
  const u = new SpeechSynthesisUtterance(text);
  const uri = saved ? saved.voice : voiceId;
  const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === uri);
  if (voice) u.voice = voice;
  u.rate = saved ? saved.rate : s.ttsRate;
  u.pitch = saved ? saved.pitch : s.ttsPitch;
  u.volume = s.ttsVolume;
  speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  generation++;
  for (const a of queue) {
    a.pause();
    URL.revokeObjectURL(a.src);
  }
  queue = [];
}

export function listVoices(): SpeechSynthesisVoice[] {
  return 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
}

async function fetchSpeech(text: string, voice: string): Promise<Blob> {
  const s = useSettings.getState();
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, voice: voice || undefined, speed: s.ttsRate !== 1 ? s.ttsRate : undefined }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res.blob();
}

/** Split text into chunks of whole sentences (~300 chars) so playback can start before everything is synthesized. */
export function speechChunks(text: string, max = 300): string[] {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?。！？…]+[.!?。！？…]*["'”’)]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const sn of sentences) {
    if (cur && cur.length + sn.length > max) {
      out.push(cur.trim());
      cur = '';
    }
    cur += sn;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function speakEndpoint(text: string, voice: string): Promise<void> {
  const s = useSettings.getState();
  const my = ++generation;
  // Streamed: fetch the next chunk while the current one plays. Otherwise synthesize everything in one request.
  const chunks = s.ttsStreamed ? speechChunks(text) : [text];
  let next: Promise<Blob> | null = fetchSpeech(chunks[0], voice);
  for (let i = 0; i < chunks.length; i++) {
    let blob: Blob;
    try {
      blob = await next!;
    } catch (e) {
      if (my === generation) useUI.getState().toast(`TTS: ${(e as Error).message}`, 'error');
      return;
    }
    if (my !== generation) return;
    next = i + 1 < chunks.length ? fetchSpeech(chunks[i + 1], voice) : null;
    next?.catch(() => {});
    const audio = new Audio(URL.createObjectURL(blob));
    audio.volume = s.ttsVolume;
    queue.push(audio);
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
    URL.revokeObjectURL(audio.src);
    queue = queue.filter((a) => a !== audio);
    if (my !== generation) return;
  }
}

/** Download `text` spoken by the endpoint voice as an audio file. */
export async function downloadSpeech(text: string, name = 'speech'): Promise<void> {
  const s = useSettings.getState();
  const blob = await fetchSpeech(text, s.ttsEndpointVoice);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.mp3`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
