import { uid } from './util.ts';
import type { EphemeralEntry } from './types.ts';

/**
 * Parse ephemeral context syntax `{+delay[r]~duration,position:text}`.
 * Example: `{+3~10,-2:Example}`. Returns null when the string is invalid.
 */
export function parseEphemeral(src: string, currentStep: number): EphemeralEntry | null {
  const m = /^\{\s*([+-]?\d+)(r?)\s*~\s*(\d+)\s*,\s*([+-]?\d+)\s*:([\s\S]*)\}$/.exec(src.trim());
  if (!m) return null;
  return {
    id: uid(),
    delay: Math.abs(parseInt(m[1], 10)),
    repeat: m[2] === 'r',
    duration: parseInt(m[3], 10),
    position: parseInt(m[4], 10),
    text: m[5],
    startingStep: currentStep,
  };
}

export function formatEphemeral(e: EphemeralEntry): string {
  const pos = e.position >= 0 ? `+${e.position}` : `${e.position}`;
  return `{+${e.delay}${e.repeat ? 'r' : ''}~${e.duration},${pos}:${e.text}}`;
}

/** Whether the entry is active at `step`. */
export function ephemeralActive(e: EphemeralEntry, step: number): boolean {
  const elapsed = step - e.startingStep;
  if (elapsed < e.delay) return false;
  if (!e.repeat) return elapsed < e.delay + e.duration;
  // Repeating: active for `duration` steps out of every cycle of max(delay, duration) steps.
  const cycle = Math.max(e.delay, e.duration, 1);
  if (e.duration >= e.delay) return true;
  return (elapsed - e.delay) % cycle < e.duration;
}
