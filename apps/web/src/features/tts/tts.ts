import { useSettings, type SavedVoice } from '../../store/settings.ts';

/**
 * Browser SpeechSynthesis wrapper honoring the TTS settings. A saved voice (or a story voice
 * set to "saved:<id>") brings its own system voice, speed and pitch.
 */
export function speak(text: string, override?: SavedVoice): void {
  if (!('speechSynthesis' in window) || !text.trim()) return;
  const s = useSettings.getState();
  const saved = override ?? (s.ttsVoice.startsWith('saved:') ? s.ttsSavedVoices.find((v) => `saved:${v.id}` === s.ttsVoice) : undefined);
  const u = new SpeechSynthesisUtterance(text);
  const uri = saved ? saved.voice : s.ttsVoice;
  const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === uri);
  if (voice) u.voice = voice;
  u.rate = saved ? saved.rate : s.ttsRate;
  u.pitch = saved ? saved.pitch : s.ttsPitch;
  u.volume = s.ttsVolume;
  speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

export function listVoices(): SpeechSynthesisVoice[] {
  return 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
}
