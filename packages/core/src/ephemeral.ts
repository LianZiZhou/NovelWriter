import { uid } from './util.ts';
import type { EphemeralEntry } from './types.ts';

const EPHEMERAL_RE = /^\{\s*(\+?)(\d+)(r?)\s*~\s*(\d+)\s*,\s*([+-]?\d+)\s*:([\s\S]*)\}$/;

/**
 * Parse ephemeral context syntax `{[+]step[r]~duration,position:text}`. With `+` the step is a delay counted from
 * `currentStep`; without it, the absolute story step the entry starts at. Example: `{+3~10,-2:Example}`.
 * Returns null when the string is invalid.
 */
export function parseEphemeral(src: string, currentStep: number): EphemeralEntry | null {
  const m = EPHEMERAL_RE.exec(src.trim());
  if (!m) return null;
  const relative = m[1] === '+';
  const n = parseInt(m[2], 10);
  return {
    id: uid(),
    delay: relative ? n : Math.max(0, n - currentStep),
    repeat: m[3] === 'r',
    duration: parseInt(m[4], 10),
    position: parseInt(m[5], 10),
    text: m[6],
    startingStep: currentStep,
  };
}

/** The entry in absolute form: `{startStep[r]~duration,position:text}`. */
export function formatEphemeral(e: EphemeralEntry): string {
  const pos = e.position >= 0 ? `+${e.position}` : `${e.position}`;
  return `{${e.startingStep + e.delay}${e.repeat ? 'r' : ''}~${e.duration},${pos}:${e.text}}`;
}

/** Story lines written in ephemeral syntax: their offsets (line plus its newline) and parsed entries. */
export function findEphemeralLines(text: string, currentStep: number): { from: number; to: number; entry: EphemeralEntry }[] {
  const out: { from: number; to: number; entry: EphemeralEntry }[] = [];
  let pos = 0;
  for (const line of text.split('\n')) {
    const entry = line.trimStart().startsWith('{') ? parseEphemeral(line, currentStep) : null;
    if (entry) {
      // Take the preceding newline when the line ends the text, the following one otherwise.
      const end = pos + line.length;
      out.push(end < text.length ? { from: pos, to: end + 1, entry } : { from: Math.max(0, pos - 1), to: end, entry });
    }
    pos += line.length + 1;
  }
  return out;
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
