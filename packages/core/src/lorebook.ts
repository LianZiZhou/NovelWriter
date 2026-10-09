import type { Condition, EquationTerm, LoreCategory, LoreEntry, Lorebook, LoreState, StoryMode } from './types.ts';

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

export interface MatchOptions {
  caseSensitive?: boolean;
  wholeWords?: boolean;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function plainKeyRegex(key: string, o: MatchOptions): RegExp {
  const k = key.trim();
  // Word boundaries mean nothing in scripts written without spaces.
  const whole = o.wholeWords && !CJK.test(k);
  const src = whole ? `(?<![\\p{L}\\p{N}_])${escapeRe(k)}(?![\\p{L}\\p{N}_])` : escapeRe(k);
  return new RegExp(src, (o.caseSensitive ? 'g' : 'gi') + (whole ? 'u' : ''));
}

/** Find the last match of a single (non-composite) key in `text`. */
function lastMatch(key: string, text: string, o: MatchOptions = {}): KeyMatch | null {
  const re = compileRegexKey(key) ?? plainKeyRegex(key, o);
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
export function matchKey(key: string, text: string, o: MatchOptions = {}): KeyMatch | null {
  if (!key.trim()) return null;
  if (!isRegexKey(key) && key.includes('&')) {
    const parts = key.split('&').map((p) => p.trim()).filter(Boolean);
    let latest: KeyMatch | null = null;
    for (const p of parts) {
      const m = lastMatch(p, text, o);
      if (!m) return null;
      if (!latest || m.index > latest.index) latest = m;
    }
    return latest ? { ...latest, key } : null;
  }
  return lastMatch(key, text, o);
}

/** The latest match among an entry's keys. */
export function matchEntry(entry: LoreEntry, text: string): KeyMatch | null {
  let best: KeyMatch | null = null;
  const o = { caseSensitive: entry.caseSensitive, wholeWords: entry.wholeWords };
  for (const k of entry.keys) {
    const m = matchKey(k, text, o);
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

export type ActivationReason =
  | 'forced'
  | 'key'
  | 'cascade'
  | 'condition'
  | 'sticky'
  | 'disabled'
  | 'categoryDisabled'
  | 'noMatch'
  | 'noText'
  | 'delayed'
  | 'cooldown'
  | 'probability'
  | 'group';

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
  /** Sticky / cooldown timing from earlier generations. */
  state?: LoreState;
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

  const random = env.random;
  const state = input.state ?? {};
  const step = input.currentStep;
  /** Delay, cooldown and probability; `null` when the entry may activate. */
  const blocked = (e: LoreEntry): ActivationReason | null => {
    if (e.delay && step < e.delay) return 'delayed';
    const st = state[e.id];
    if (st && step > st.stickyUntil && step <= st.cooldownUntil) return 'cooldown';
    if (e.probability !== undefined && e.probability < 100 && random() * 100 >= Math.max(0, e.probability)) return 'probability';
    return null;
  };
  const activate = (a: Activation): boolean => {
    const why = blocked(a.entry);
    if (why) {
      results.set(a.entry.id, { entry: a.entry, active: false, reason: why, match: null, matchedIn: null });
      return false;
    }
    results.set(a.entry.id, a);
    env.activeIds.add(a.entry.id);
    return true;
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
    // Sticky entries stay on for a while after they activate, whatever the story says.
    const st = state[e.id];
    if (st && e.sticky && step <= st.stickyUntil) {
      results.set(e.id, { entry: e, active: true, reason: 'sticky', match: null, matchedIn: null });
      env.activeIds.add(e.id);
      continue;
    }
    // A range of 0 means keys are never searched in the story (conditions and cascading still apply).
    const range = Math.max(0, Math.min(e.searchRange ?? 1000, MAX_SEARCH_RANGE));
    const offset = Math.max(0, storyText.length - range);
    const m = range > 0 ? matchEntry(e, storyText.slice(offset)) : null;
    if (m) {
      if (activate({ entry: e, active: true, reason: 'key', match: { ...m, index: m.index + offset }, matchedIn: 'story' })) continue;
    }
    pending.push(e);
  }

  const byId = new Map(lorebook.entries.map((e) => [e.id, e]));
  // Entries that already failed their delay / cooldown / probability check stay off for this generation.
  const settled = (id: string) => results.get(id)?.active || ['delayed', 'cooldown', 'probability'].includes(results.get(id)?.reason ?? '');
  env.activeText = () => [...env.activeIds].map((id) => byId.get(id)?.text ?? '').join('\n');

  // Advanced conditions and cascading activation iterate to a fixpoint (capped, in case conditions loop).
  let changed = true;
  for (let pass = 0; changed && pass < MAX_PASSES; pass++) {
    changed = false;
    for (const e of pending) {
      if (settled(e.id)) continue;
      if (e.conditions.length && e.conditions.some((c) => evalCondition(c, env))) {
        activate({ entry: e, active: true, reason: 'condition', match: null, matchedIn: null });
        changed = true;
        continue;
      }
      if (!e.nonStoryActivatable) continue;
      const sources: [string, string][] = [
        ['memory', input.memoryText],
        ['authorsNote', input.authorsNoteText],
        ...[...env.activeIds].filter((id) => !byId.get(id)?.preventRecursion).map((id) => [id, byId.get(id)?.text ?? ''] as [string, string]),
      ];
      for (const [src, text] of sources) {
        if (src === e.id || !text) continue;
        const m = matchEntry(e, text);
        if (m) {
          activate({ entry: e, active: true, reason: 'cascade', match: m, matchedIn: src });
          changed = true;
          break;
        }
      }
    }
  }

  // Inclusion groups: of the active entries in a group, one is kept (sticky and forced entries always stay).
  const groups = new Map<string, LoreEntry[]>();
  for (const id of env.activeIds) {
    const e = byId.get(id)!;
    const r = results.get(id)?.reason;
    if (!e.group?.trim() || r === 'forced' || r === 'sticky') continue;
    for (const g of e.group.split(',').map((x) => x.trim()).filter(Boolean)) groups.set(g, [...(groups.get(g) ?? []), e]);
  }
  const dropped = new Set<string>();
  for (const members of groups.values()) {
    const live = members.filter((e) => !dropped.has(e.id));
    if (live.length < 2) continue;
    let keep: LoreEntry;
    const prio = live.filter((e) => e.groupPrioritize);
    if (prio.length) keep = prio.reduce((a, b) => (b.contextConfig.budgetPriority > a.contextConfig.budgetPriority ? b : a));
    else {
      const weights = live.map((e) => Math.max(0, e.groupWeight ?? 100));
      let r = random() * (weights.reduce((a, b) => a + b, 0) || 1);
      keep = live[live.length - 1];
      for (let i = 0; i < live.length; i++) if ((r -= weights[i]) < 0) {
        keep = live[i];
        break;
      }
    }
    for (const e of live) if (e !== keep) dropped.add(e.id);
  }
  for (const id of dropped) {
    results.set(id, { entry: byId.get(id)!, active: false, reason: 'group', match: null, matchedIn: null });
    env.activeIds.delete(id);
  }

  return lorebook.entries.map(
    (e) => results.get(e.id) ?? { entry: e, active: false, reason: e.text ? 'noMatch' : 'noText', match: null, matchedIn: null },
  );
}

/**
 * Sticky / cooldown timing after a generation at `step`: an entry that activated (not just stayed on) starts its
 * sticky span and, after it, its cooldown.
 */
export function nextLoreState(prev: LoreState | undefined, activations: Activation[], step: number): LoreState {
  const out: LoreState = {};
  for (const a of activations) {
    const e = a.entry;
    if (!e.sticky && !e.cooldown) continue;
    const old = prev?.[e.id];
    if (a.active && a.reason !== 'sticky' && a.reason !== 'forced') {
      const stickyUntil = step + Math.max(0, e.sticky ?? 0);
      out[e.id] = { stickyUntil, cooldownUntil: stickyUntil + Math.max(0, e.cooldown ?? 0) };
    } else if (old && old.cooldownUntil >= step) out[e.id] = old;
  }
  return out;
}

/** Search entries by name, keys, or text (Lorebook Quick Access / search box). */
export function searchLore(entries: LoreEntry[], q: string): LoreEntry[] {
  const s = q.trim().toLowerCase();
  if (!s) return entries;
  return entries.filter(
    (e) => e.displayName.toLowerCase().includes(s) || e.keys.some((k) => k.toLowerCase().includes(s)) || e.text.toLowerCase().includes(s),
  );
}
