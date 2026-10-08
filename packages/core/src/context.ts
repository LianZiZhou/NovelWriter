import { docText } from './doc.ts';
import { activateLorebook, type Activation } from './lorebook.ts';
import { ephemeralActive } from './ephemeral.ts';
import { contextConfig } from './defaults.ts';
import { countTokens, tokenize } from './tokenizer.ts';
import type { ContextConfig, LoreCategory, PhraseBiasGroup, Story, TrimType } from './types.ts';

export type ContextSourceKind = 'story' | 'memory' | 'authorsNote' | 'lore' | 'ephemeral' | 'subcontext' | 'attg';

export interface ContextSegment {
  text: string;
  sourceId: string;
  kind: ContextSourceKind;
}

export type InclusionReason =
  | 'included'
  | 'trimmed'
  | 'budgetExceeded'
  | 'noSpace'
  | 'empty'
  | 'notActivated'
  | 'disabled';

export interface ContextReportEntry {
  id: string;
  label: string;
  kind: ContextSourceKind;
  stage: number | null;
  order: number;
  included: boolean;
  reason: InclusionReason;
  activation?: Activation['reason'];
  key?: string;
  reservedTokens: number;
  tokens: number;
  originalTokens: number;
  trimType: TrimType | 'none';
  hidden?: boolean;
}

export interface BuiltContext {
  text: string;
  segments: ContextSegment[];
  stages: ContextSegment[][];
  report: ContextReportEntry[];
  maxTokens: number;
  usedTokens: number;
  phraseBias: PhraseBiasGroup[];
  activations: Activation[];
}

interface Candidate {
  id: string;
  label: string;
  kind: ContextSourceKind;
  text: string;
  config: ContextConfig;
  activation?: Activation;
  /** Absolute offset of the matched key in the story text (key-relative insertion). */
  keyOffset?: number;
  hidden?: boolean;
  index: number;
}

export interface BuildContextOptions {
  /** Max context size in tokens (before subtracting output). */
  maxContextTokens: number;
  /** Tokens reserved for the model output. */
  outputTokens: number;
  model?: string;
  random?: () => number;
  /** Override the story text (e.g. inline generation from the cursor). */
  storyText?: string;
}

/** Resolve a budget value: fractions in (0, 1] are relative to the max context. */
/** Lines starting with `##` are notes to self: they never reach the AI. */
export function stripComments(text: string): string {
  return text.includes('##') ? text.replace(/^[ \t]*##.*(?:\r?\n|$)/gm, '') : text;
}

export function resolveTokens(v: number, max: number): number {
  if (v > 0 && v <= 1) return Math.floor(v * max);
  return Math.max(0, Math.floor(v));
}

const SENTENCE_END = /[.!?…。！？]+["'”’)\]]*(\s+|$)|\n/g;

/** Offsets where units of the given type start; always includes 0 and text.length. */
export function unitBoundaries(text: string, type: TrimType): number[] {
  const b = new Set<number>([0, text.length]);
  if (type === 'newline') {
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') b.add(i + 1);
  } else if (type === 'sentence') {
    for (const m of text.matchAll(SENTENCE_END)) b.add((m.index ?? 0) + m[0].length);
  } else {
    let pos = 0;
    for (const t of tokenize(text)) {
      pos += t.length;
      b.add(pos);
    }
  }
  return [...b].filter((x) => x >= 0 && x <= text.length).sort((x, y) => x - y);
}

const TRIM_ORDER: TrimType[] = ['newline', 'sentence', 'token'];

/**
 * Trim `text` to at most `limit` tokens, removing whole units from the top or
 * bottom. Tries coarse units first and falls back to finer ones up to
 * `maxType`. Returns null if nothing fits.
 */
export function trimText(
  text: string,
  limit: number,
  direction: 'trimTop' | 'trimBottom',
  maxType: TrimType,
): { text: string; type: TrimType } | null {
  if (limit <= 0) return null;
  if (text.length <= limit * 32 && countTokens(text) <= limit) return { text, type: 'newline' };
  // Nothing longer than this many characters can fit (tokens average well under 16 characters), so only
  // that end of a long text is examined.
  const windowChars = limit * 16;
  const maxIdx = TRIM_ORDER.indexOf(maxType);
  for (let t = 0; t <= maxIdx; t++) {
    const type = TRIM_ORDER[t];
    const base = text.length > windowChars ? (direction === 'trimTop' ? text.length - windowChars : 0) : 0;
    const sub = text.length > windowChars ? (direction === 'trimTop' ? text.slice(base) : text.slice(0, windowChars)) : text;
    // Unit boundaries of the full text that fall inside the window, relative to the window.
    let bounds: number[];
    if (type === 'token') bounds = unitBoundaries(sub, type);
    else {
      bounds = unitBoundaries(sub, type).filter((x) => (direction === 'trimTop' ? x > 0 || base === 0 : x < sub.length || sub.length === text.length));
      if (direction === 'trimTop') bounds = [...bounds.filter((x) => x < sub.length), sub.length];
      else bounds = [0, ...bounds.filter((x) => x > 0)];
      // A boundary inside the window is only real if it is one in the full text (window edges are not).
      if (direction === 'trimTop' && base > 0) bounds = bounds.filter((x) => x > 0);
      if (direction === 'trimBottom' && sub.length < text.length) bounds = bounds.filter((x) => x < sub.length || x === 0);
    }
    if (bounds.length < 2 && !(bounds.length === 1 && bounds[0] === 0)) continue;
    // Token start offsets of the window give a cheap estimate of the tokens kept for each cut.
    const starts: number[] = [];
    let off = 0;
    for (const tok of tokenize(sub)) {
      starts.push(off);
      off += tok.length;
    }
    const tokensBefore = (c: number) => {
      let lo = 0;
      let hi = starts.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] < c) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const cutAt = (i: number) => (direction === 'trimTop' ? sub.slice(bounds[i]) : sub.slice(0, bounds[i]));
    const estimate = (i: number) => (direction === 'trimTop' ? starts.length - tokensBefore(bounds[i]) : tokensBefore(bounds[i]));
    // Keep as much as fits: for trimTop the smallest bound index, for trimBottom the largest.
    let best = -1;
    if (direction === 'trimTop') {
      let lo = 0;
      let hi = bounds.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (estimate(mid) <= limit) {
          best = mid;
          hi = mid - 1;
        } else lo = mid + 1;
      }
      if (best < 0) continue;
      // Verify exactly, then step to the neighbouring units if the estimate was off.
      while (best < bounds.length - 1 && countTokens(cutAt(best)) > limit) best++;
      while (best > 0 && countTokens(cutAt(best - 1)) <= limit) best--;
    } else {
      let lo = 0;
      let hi = bounds.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (estimate(mid) <= limit) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (best < 0) continue;
      while (best > 0 && countTokens(cutAt(best)) > limit) best--;
      while (best < bounds.length - 1 && countTokens(cutAt(best + 1)) <= limit) best++;
    }
    const kept = cutAt(best);
    if (kept.trim() && countTokens(kept) <= limit) return { text: kept, type };
  }
  return null;
}

/** Character offset in `full` for insertion position `pos` in units of `type`. */
function insertionOffset(full: string, type: TrimType, pos: number): number {
  const b = unitBoundaries(full, type);
  const n = b.length - 1;
  const idx = pos >= 0 ? Math.min(pos, n) : Math.max(0, n + 1 + pos);
  return b[idx];
}

function insertAt(segments: ContextSegment[], offset: number, seg: ContextSegment): ContextSegment[] {
  const out: ContextSegment[] = [];
  let pos = 0;
  let inserted = false;
  for (const s of segments) {
    const end = pos + s.text.length;
    if (!inserted && offset >= pos && offset < end) {
      const a = s.text.slice(0, offset - pos);
      const b = s.text.slice(offset - pos);
      if (a) out.push({ ...s, text: a });
      out.push(seg);
      if (b) out.push({ ...s, text: b });
      inserted = true;
    } else out.push(s);
    pos = end;
  }
  if (!inserted) out.push(seg);
  return out;
}

function joinSegments(segs: ContextSegment[]): string {
  return segs.map((s) => s.text).join('');
}

/**
 * Assemble candidates into a context within `maxTokens`, NovelAI style:
 * reserve tokens in insertion-order, then insert entries (highest order
 * first), trimming each to its budget, at its insertion position.
 */
export function assemble(candidates: Candidate[], maxTokens: number): Omit<BuiltContext, 'phraseBias' | 'activations' | 'maxTokens'> {
  const order = [...candidates].sort((a, b) => b.config.budgetPriority - a.config.budgetPriority || a.index - b.index);
  const report = new Map<string, ContextReportEntry>();
  const reserved = new Map<string, number>();
  let reservedTotal = 0;

  for (const c of order) {
    if (!c.text) continue;
    const budget = resolveTokens(c.config.tokenBudget, maxTokens) || maxTokens;
    const want = resolveTokens(c.config.reservedTokens, maxTokens);
    if (want <= 0) continue;
    const full = c.config.prefix + c.text + c.config.suffix;
    // Long texts exceed any reservation; skip counting them.
    const fullTokens = full.length > maxTokens * 32 ? Infinity : countTokens(full);
    const r = Math.min(want, fullTokens, budget);
    if (r > 0) {
      reserved.set(c.id, r);
      reservedTotal += r;
    }
  }

  let segments: ContextSegment[] = [];
  const stages: ContextSegment[][] = [];
  let used = 0;
  let stage = 0;
  // Where the (trimmed) story starts within the original story text, for key-relative insertion.
  let storyTrimStart = 0;

  // Key-relative entries wait for the story when it is placed after them, so they can find their key.
  const queue = [...order];
  const deferred: Candidate[] = [];
  const storyPending = () => queue.some((x, j) => j >= qi && x.kind === 'story');
  let qi = 0;
  for (; qi < queue.length; qi++) {
    const c = queue[qi];
    if (c.keyOffset !== undefined && !segments.some((s) => s.kind === 'story') && storyPending()) {
      deferred.push(c);
      continue;
    }
    if (c.kind === 'story' && deferred.length) queue.splice(qi + 1, 0, ...deferred.splice(0));
    const own = reserved.get(c.id) ?? 0;
    reservedTotal -= own;
    // A text this long can't fit anyway; skip the exact count (it costs a full tokenization of the story).
    const fullText = c.config.prefix + c.text + c.config.suffix;
    const originalTokens = fullText.length > maxTokens * 32 ? Math.ceil(fullText.length / 4) : countTokens(fullText);
    const base: ContextReportEntry = {
      id: c.id,
      label: c.label,
      kind: c.kind,
      stage: null,
      order: c.config.budgetPriority,
      included: false,
      reason: 'empty',
      activation: c.activation?.reason,
      key: c.activation?.match?.key,
      reservedTokens: own,
      tokens: 0,
      originalTokens,
      trimType: 'none',
      hidden: c.hidden,
    };
    if (!c.text) {
      report.set(c.id, base);
      continue;
    }
    const budget = resolveTokens(c.config.tokenBudget, maxTokens) || maxTokens;
    const available = maxTokens - used - reservedTotal;
    const limit = Math.min(budget, available);
    let body = c.text;
    let trimType: TrimType | 'none' = 'none';
    if (originalTokens > limit) {
      if (c.config.trimDirection === 'doNotTrim' || limit <= 0) {
        report.set(c.id, { ...base, reason: limit <= 0 ? 'noSpace' : 'budgetExceeded' });
        continue;
      }
      const room = limit - countTokens(c.config.prefix) - countTokens(c.config.suffix);
      const t = trimText(c.text, room, c.config.trimDirection, c.config.maximumTrimType);
      if (!t) {
        report.set(c.id, { ...base, reason: 'budgetExceeded' });
        continue;
      }
      if (c.kind === 'story' && c.config.trimDirection === 'trimTop') storyTrimStart = c.text.length - t.text.length;
      body = t.text;
      trimType = t.type;
    }

    let piece = c.config.prefix + body + c.config.suffix;
    const current = joinSegments(segments);
    let offset: number;
    if (c.keyOffset !== undefined && segments.some((s) => s.kind === 'story')) {
      offset = keyRelativeOffset(segments, current, c.keyOffset - storyTrimStart, c.config) ?? insertionOffset(current, c.config.insertionType, c.config.insertionPosition);
    } else {
      offset = insertionOffset(current, c.config.insertionType, c.config.insertionPosition);
    }
    if (c.config.insertionType === 'newline' && offset > 0 && current[offset - 1] !== '\n') piece = '\n' + piece;
    if (c.config.insertionType === 'newline' && offset < current.length && !piece.endsWith('\n')) piece += '\n';

    segments = insertAt(segments, offset, { text: piece, sourceId: c.id, kind: c.kind });
    const tokens = countTokens(piece);
    used += tokens;
    stages.push(segments.map((s) => ({ ...s })));
    report.set(c.id, {
      ...base,
      stage: stage++,
      included: true,
      reason: trimType === 'none' ? 'included' : 'trimmed',
      tokens,
      trimType,
    });
  }

  return {
    text: joinSegments(segments),
    segments,
    stages,
    report: candidates.map((c) => report.get(c.id)!),
    usedTokens: used,
  };
}

/** Offset for key-relative insertion: units counted from the unit containing the key. */
function keyRelativeOffset(segments: ContextSegment[], full: string, storyKeyOffset: number, cfg: ContextConfig): number | null {
  if (storyKeyOffset < 0) return null;
  // Map the story-relative offset onto the assembled context.
  let pos = 0;
  let storySeen = 0;
  let abs: number | null = null;
  for (const s of segments) {
    if (s.kind === 'story') {
      if (storyKeyOffset < storySeen + s.text.length) {
        abs = pos + (storyKeyOffset - storySeen);
        break;
      }
      storySeen += s.text.length;
    }
    pos += s.text.length;
  }
  if (abs === null) return null;
  const b = unitBoundaries(full, cfg.insertionType);
  let unit = 0;
  while (unit + 1 < b.length && b[unit + 1] <= abs) unit++;
  const p = cfg.insertionPosition;
  const idx = p >= 0 ? unit + 1 + p : unit + 1 + p;
  return b[Math.max(0, Math.min(b.length - 1, idx))];
}

function attgLine(s: Story): string {
  const parts: string[] = [];
  if (s.author) parts.push(`Author: ${s.author}`);
  if (s.title && s.title !== 'New Story') parts.push(`Title: ${s.title}`);
  if (s.tags.length) parts.push(`Tags: ${s.tags.join(', ')}`);
  if (s.genre) parts.push(`Genre: ${s.genre}`);
  const line = parts.length && (s.author || s.tags.length || s.genre) ? `[ ${parts.join('; ')} ]` : '';
  const style = s.styleTag > 0 ? `[ S: ${Math.min(5, Math.round(s.styleTag))} ]` : '';
  return [line, style].filter(Boolean).join('\n');
}

function collectBias(story: Story, activations: Activation[], cats: LoreCategory[]): PhraseBiasGroup[] {
  const out: PhraseBiasGroup[] = story.phraseBias.filter((g) => g.enabled && g.phrases.length && g.bias !== 0);
  for (const a of activations) {
    for (const g of a.entry.loreBiasGroups ?? []) {
      if (!g.enabled || !g.phrases.length || g.bias === 0) continue;
      if (a.active !== g.whenInactive) out.push(g);
    }
  }
  for (const c of cats) {
    const anyActive = activations.some((a) => a.active && a.entry.category === c.id);
    for (const g of c.categoryBiasGroups ?? []) {
      if (g.enabled && g.phrases.length && g.bias !== 0 && anyActive !== g.whenInactive) out.push(g);
    }
  }
  return out;
}

/** Build the full context for the next generation of `story`. */
export function buildContext(story: Story, opts: BuildContextOptions): BuiltContext {
  const maxTokens = Math.max(64, opts.maxContextTokens - opts.outputTokens);
  const storyText = stripComments(opts.storyText ?? docText(story.doc));
  const activations = activateLorebook({
    lorebook: story.lorebook,
    storyText,
    memoryText: story.memory,
    authorsNoteText: story.authorsNote,
    currentStep: story.step,
    model: opts.model ?? story.model?.id ?? '',
    mode: story.mode,
    random: opts.random,
  });
  const cats = story.lorebook.categories;
  const catById = new Map(cats.map((c) => [c.id, c]));
  let index = 0;
  const candidates: Candidate[] = [];
  const cs = story.contextSettings;

  const attg = attgLine(story);
  if (attg) {
    candidates.push({
      id: 'attg',
      label: 'ATTG',
      kind: 'attg',
      text: attg,
      config: contextConfig({ budgetPriority: 1000, insertionPosition: 0, trimDirection: 'doNotTrim' }),
      index: index++,
    });
  }
  candidates.push({ id: 'story', label: 'Story', kind: 'story', text: storyText, config: cs.story, index: index++ });
  candidates.push({ id: 'memory', label: 'Memory', kind: 'memory', text: stripComments(story.memory), config: cs.memory, index: index++ });
  candidates.push({ id: 'authorsNote', label: "Author's Note", kind: 'authorsNote', text: stripComments(story.authorsNote), config: cs.authorsNote, index: index++ });

  const subcontextMembers = new Map<string, Candidate[]>();
  // "Order by Key Location": entries whose keys appear later in the story come later among equal priorities.
  const ordered = story.lorebook.settings.orderByKeyLocations
    ? [...activations].sort((a, b) => (a.matchedIn === 'story' ? (a.match?.index ?? -1) : -1) - (b.matchedIn === 'story' ? (b.match?.index ?? -1) : -1))
    : activations;
  for (const a of ordered) {
    if (!a.active || !a.entry.text) continue;
    const e = a.entry;
    const cat = e.category ? catById.get(e.category) : undefined;
    const text = stripComments(cat?.entryHeader ? `${cat.entryHeader}\n${e.text}` : e.text);
    const cand: Candidate = {
      id: e.id,
      label: e.displayName,
      kind: 'lore',
      text,
      config: e.contextConfig,
      activation: a,
      hidden: e.hidden,
      keyOffset: e.keyRelative && a.matchedIn === 'story' && a.match ? a.match.index : undefined,
      index: index++,
    };
    if (cat?.createSubcontext) {
      const list = subcontextMembers.get(cat.id) ?? [];
      list.push(cand);
      subcontextMembers.set(cat.id, list);
    } else candidates.push(cand);
  }

  const subReports: ContextReportEntry[] = [];
  for (const [catId, members] of subcontextMembers) {
    const cat = catById.get(catId)!;
    const budget = resolveTokens(cat.subcontextSettings.tokenBudget, maxTokens) || maxTokens;
    const inner = assemble(members, budget);
    subReports.push(...inner.report);
    candidates.push({ id: `subcontext:${catId}`, label: `${cat.name} (Subcontext)`, kind: 'subcontext', text: inner.text, config: cat.subcontextSettings, index: index++ });
  }

  for (const e of story.ephemeral) {
    if (!ephemeralActive(e, story.step)) continue;
    candidates.push({
      id: `ephemeral:${e.id}`,
      label: 'Ephemeral',
      kind: 'ephemeral',
      text: stripComments(e.text),
      config: contextConfig({ budgetPriority: -10000, insertionPosition: e.position, prefix: '', suffix: '\n', trimDirection: 'doNotTrim' }),
      index: index++,
    });
  }

  const built = assemble(candidates, maxTokens);

  // Report inactive lore entries too, so the viewer can show why they were left out.
  const reported = new Set(built.report.map((r) => r.id).concat(subReports.map((r) => r.id)));
  const inactive: ContextReportEntry[] = activations
    .filter((a) => !reported.has(a.entry.id))
    .map((a) => ({
      id: a.entry.id,
      label: a.entry.displayName,
      kind: 'lore',
      stage: null,
      order: a.entry.contextConfig.budgetPriority,
      included: false,
      reason: a.reason === 'disabled' || a.reason === 'categoryDisabled' ? 'disabled' : a.active ? 'empty' : 'notActivated',
      activation: a.reason,
      reservedTokens: 0,
      tokens: 0,
      originalTokens: countTokens(a.entry.text),
      trimType: 'none',
      hidden: a.entry.hidden,
    }));

  return {
    ...built,
    report: [...built.report, ...subReports, ...inactive],
    maxTokens,
    phraseBias: collectBias(story, activations, cats),
    activations,
  };
}
