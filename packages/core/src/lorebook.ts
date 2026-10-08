import type { Condition, EquationTerm, LoreCategory, LoreEntry, Lorebook, StoryMode } from './types.ts';

/** Largest search range NovelAI allows. */
export const MAX_SEARCH_RANGE = 50000;
/** Activation passes before giving up on conditions that keep flipping each other. */
const MAX_PASSES = 30;

export interface KeyMatch {
  key: string;
  /** Index of the match start within the searched text. */
  index: number;
  length: number;
}

const REGEX_KEY = /^\$?\/(.+)\/([gimsuy]*)$/s;

export function isRegexKey(key: string): boolean {
  return REGEX_KEY.test(key);
}

/** Compile a regex key, or return null when it is not one / invalid. */
export function compileRegexKey(key: string): RegExp | null {
  const m = REGEX_KEY.exec(key);
  if (!m) return null;
  try {
    const flags = m[2].replace(/g/g, '');
    return new RegExp(m[1], flags + 'g');
  } catch {
    return null;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Find the last match of a single (non-composite) key in `text`. */
function lastMatch(key: string, text: string): KeyMatch | null {
  const re = compileRegexKey(key) ?? new RegExp(escapeRe(key.trim()), 'gi');
  if (!re.source || re.source === '(?:)') return null;
  let last: KeyMatch | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    last = { key, index: m.index, length: m[0].length };
    if (m[0].length === 0) re.lastIndex++;
  }
  return last;
}

/** Global regexes that find every occurrence of a key's parts (for highlighting keys in the editor). */
export function keyRegexes(key: string): RegExp[] {
  if (!key.trim()) return [];
  const parts = !isRegexKey(key) && key.includes('&') ? key.split('&').map((p) => p.trim()).filter(Boolean) : [key];
  return parts.map((p) => compileRegexKey(p) ?? new RegExp(escapeRe(p.trim()), 'gi')).filter((re) => re.source && re.source !== '(?:)');
}

/**
 * Match a key against text. `A & B` requires every part to match; the match
 * reported is the latest of the parts.
 */
export function matchKey(key: string, text: string): KeyMatch | null {
  if (!key.trim()) return null;
  if (!isRegexKey(key) && key.includes('&')) {
    const parts = key.split('&').map((p) => p.trim()).filter(Boolean);
    let latest: KeyMatch | null = null;
    for (const p of parts) {
      const m = lastMatch(p, text);
      if (!m) return null;
      if (!latest || m.index > latest.index) latest = m;
    }
    return latest ? { ...latest, key } : null;
  }
  return lastMatch(key, text);
}

/** The latest match among an entry's keys. */
export function matchEntry(entry: LoreEntry, text: string): KeyMatch | null {
  let best: KeyMatch | null = null;
  for (const k of entry.keys) {
    const m = matchKey(k, text);
    if (m && (!best || m.index > best.index)) best = m;
  }
  return best;
}

export interface ConditionEnv {
  storyText: string;
  memoryText: string;
  authorsNoteText: string;
  currentStep: number;
  model: string;
  mode: StoryMode;
  activeIds: Set<string>;
  random: () => number;
  /** Text of the currently active entries (for Keyword Match in Active Lorebook Entries). */
  activeText?: () => string;
}

function compare(v: number, op: '<' | '<=' | '=' | '>=' | '>' | '!=', value: number): boolean {
  switch (op) {
    case '<': return v < value;
    case '<=': return v <= value;
    case '=': return v === value;
    case '>=': return v >= value;
    case '>': return v > value;
    case '!=': return v !== value;
  }
}

function variable(name: string, env: ConditionEnv): number {
  switch (name) {
    case 'currentStep': return env.currentStep;
    case 'paragraphCount': return env.storyText.split('\n').filter((l) => l.trim()).length;
    case 'characterCount': return env.storyText.length;
    case 'activeEntries': return env.activeIds.size;
    case 'random': return Math.floor(env.random() * 100);
  }
  return 0;
}

/** Evaluate equation terms left to right: `2 + 3 * 4` is 20. Division by zero gives 0. */
export function evalEquation(terms: EquationTerm[], env: ConditionEnv): number {
  let acc = 0;
  terms.forEach((term, i) => {
    const v = typeof term.value === 'number' ? term.value : variable(term.value, env);
    if (i === 0) return void (acc = v);
    switch (term.operator) {
      case '+': acc += v; break;
      case '-': acc -= v; break;
      case '*': acc *= v; break;
      case '/': acc = v === 0 ? 0 : acc / v; break;
      case '%': acc = v === 0 ? 0 : acc % v; break;
    }
  });
  return acc;
}

export function evalCondition(c: Condition, env: ConditionEnv): boolean {
  switch (c.type) {
    case 'true':
      return true;
    case 'keyword': {
      const text = c.location === 'memory' ? env.memoryText : c.location === 'authorsNote' ? env.authorsNoteText : c.location === 'lore' ? (env.activeText?.() ?? '') : env.storyText;
      return matchKey(c.key, c.range && c.range > 0 ? text.slice(-c.range) : text) !== null;
    }
    case 'equation':
      return compare(evalEquation(c.terms, env), c.op, c.value);
    case 'loreActive':
      return env.activeIds.has(c.entryId);
    case 'model':
      return env.model === c.model;
    case 'storyMode':
      return env.mode === c.mode;
    case 'random':
      return env.random() * 100 < c.chance;
    case 'number': {
      const v =
        c.variable === 'currentStep'
          ? env.currentStep
          : c.variable === 'paragraphCount'
            ? env.storyText.split('\n').filter((l) => l.trim()).length
            : env.storyText.length;
      return compare(v, c.op, c.value);
    }
    case 'string': {
      const v = c.variable === 'storyText' ? env.storyText : c.variable === 'memoryText' ? env.memoryText : env.authorsNoteText;
      switch (c.op) {
        case 'equals': return v === c.value;
        case 'includes': return v.includes(c.value);
        case 'startsWith': return v.startsWith(c.value);
        case 'endsWith': return v.endsWith(c.value);
      }
      return false;
    }
    case 'and':
      return c.conditions.every((x) => evalCondition(x, env));
    case 'or':
      return c.conditions.some((x) => evalCondition(x, env));
    case 'not':
      return !evalCondition(c.condition, env);
  }
}

export type ActivationReason = 'forced' | 'key' | 'cascade' | 'condition' | 'disabled' | 'categoryDisabled' | 'noMatch' | 'noText';

export interface Activation {
  entry: LoreEntry;
  active: boolean;
  reason: ActivationReason;
  match: KeyMatch | null;
  /** Where the key matched: in the story (offset into story text) or another entry. */
  matchedIn: 'story' | string | null;
}

export interface ActivationInput {
  lorebook: Lorebook;
  storyText: string;
  memoryText: string;
  authorsNoteText: string;
  currentStep: number;
  model: string;
  mode: StoryMode;
  random?: () => number;
}

/**
 * Decide which lore entries are active. Keys are searched in the last
 * `searchRange` characters of the story; entries with cascading activation
 * may also be activated by text of memory, author's note, or other active
 * entries, repeated until nothing new activates.
 */
export function activateLorebook(input: ActivationInput): Activation[] {
  const { lorebook, storyText } = input;
  const cats = new Map<string, LoreCategory>(lorebook.categories.map((c) => [c.id, c]));
  const results = new Map<string, Activation>();
  const env: ConditionEnv = {
    storyText,
    memoryText: input.memoryText,
    authorsNoteText: input.authorsNoteText,
    currentStep: input.currentStep,
    model: input.model,
    mode: input.mode,
    activeIds: new Set(),
    random: input.random ?? Math.random,
  };

  const pending: LoreEntry[] = [];
  for (const e of lorebook.entries) {
    const cat = e.category ? cats.get(e.category) : undefined;
    if (!e.enabled) {
      results.set(e.id, { entry: e, active: false, reason: 'disabled', match: null, matchedIn: null });
      continue;
    }
    if (cat && !cat.enabled) {
      results.set(e.id, { entry: e, active: false, reason: 'categoryDisabled', match: null, matchedIn: null });
      continue;
    }
    if (e.forceActivation) {
      results.set(e.id, { entry: e, active: true, reason: 'forced', match: null, matchedIn: null });
      env.activeIds.add(e.id);
      continue;
    }
    // A range of 0 means keys are never searched in the story (conditions and cascading still apply).
    const range = Math.max(0, Math.min(e.searchRange ?? 1000, MAX_SEARCH_RANGE));
    const offset = Math.max(0, storyText.length - range);
    const m = range > 0 ? matchEntry(e, storyText.slice(offset)) : null;
    if (m) {
      results.set(e.id, { entry: e, active: true, reason: 'key', match: { ...m, index: m.index + offset }, matchedIn: 'story' });
      env.activeIds.add(e.id);
      continue;
    }
    pending.push(e);
  }

  env.activeText = () => [...env.activeIds].map((id) => lorebook.entries.find((x) => x.id === id)?.text ?? '').join('\n');

  // Advanced conditions and cascading activation iterate to a fixpoint (capped, in case conditions loop).
  let changed = true;
  for (let pass = 0; changed && pass < MAX_PASSES; pass++) {
    changed = false;
    for (const e of pending) {
      if (results.get(e.id)?.active) continue;
      if (e.conditions.length && e.conditions.some((c) => evalCondition(c, env))) {
        results.set(e.id, { entry: e, active: true, reason: 'condition', match: null, matchedIn: null });
        env.activeIds.add(e.id);
        changed = true;
        continue;
      }
      if (!e.nonStoryActivatable) continue;
      const sources: [string, string][] = [
        ['memory', input.memoryText],
        ['authorsNote', input.authorsNoteText],
        ...[...env.activeIds].map((id) => [id, lorebook.entries.find((x) => x.id === id)?.text ?? ''] as [string, string]),
      ];
      for (const [src, text] of sources) {
        if (src === e.id || !text) continue;
        const m = matchEntry(e, text);
        if (m) {
          results.set(e.id, { entry: e, active: true, reason: 'cascade', match: m, matchedIn: src });
          env.activeIds.add(e.id);
          changed = true;
          break;
        }
      }
    }
  }

  return lorebook.entries.map(
    (e) => results.get(e.id) ?? { entry: e, active: false, reason: e.text ? 'noMatch' : 'noText', match: null, matchedIn: null },
  );
}

/** Search entries by name, keys, or text (Lorebook Quick Access / search box). */
export function searchLore(entries: LoreEntry[], q: string): LoreEntry[] {
  const s = q.trim().toLowerCase();
  if (!s) return entries;
  return entries.filter(
    (e) => e.displayName.toLowerCase().includes(s) || e.keys.some((k) => k.toLowerCase().includes(s)) || e.text.toLowerCase().includes(s),
  );
}
