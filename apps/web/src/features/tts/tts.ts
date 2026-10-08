import { useSettings } from '../../store/settings.ts';

/** Browser SpeechSynthesis wrapper honoring the TTS settings. */
export function speak(text: string): void {
  if (!('speechSynthesis' in window) || !text.trim()) return;
  const s = useSettings.getState();
  const u = new SpeechSynthesisUtterance(text);
  const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === s.ttsVoice);
  if (voice) u.voice = voice;
  u.rate = s.ttsRate;
  u.pitch = s.ttsPitch;
  u.volume = s.ttsVolume;
  speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

export function listVoices(): SpeechSynthesisVoice[] {
  return 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
}
