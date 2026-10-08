// NovelAI `.story` files (storyContainerVersion 1, storyContentVersion up to 7).
//
// Newer stories keep their text in `content.document`: base64 MessagePack (msgpackr, see msgpackr.ts) of a
// Document — `sections` (paragraphs) listed by `order`, plus a `history` tree whose nodes hold per-section
// create / update / remove changes. Origins and formatting are ranges in each section's `meta` (key 1 =
// origin, key 2 = formatting). Older stories keep origin-tagged `story.fragments` instead.
//
// Import replays the whole history tree into our branching history; export does the reverse, so undo/redo
// and retry branches survive the trip both ways.
import { applyChanges, docText, fromParagraphs, normalize, paragraphs, replace, slice } from './doc.ts';
import { createHistory, flatten, pathTo } from './history.ts';
import { pack, unpack, Ext } from './msgpackr.ts';
import { uid } from './util.ts';
import type { Change, Condition, EquationTerm, History, HistoryNode, HistoryNodeType, Mark, Origin, SideChat, Span, Story } from './types.ts';

// ------------------------------------------------------------------ codes

const META_ORIGIN = 1;
const META_FORMAT = 2;
const ORIGIN_CODE: Record<Origin, number> = { user: 1, ai: 2, edit: 3, prompt: 10 };
/** root 0, user 1, ai 2, edit 3, prompt 10, flattened 20, unknown 100, script 200 */
function codeOrigin(n: number): Origin {
  if (n === 1) return 'user';
  if (n === 2) return 'ai';
  if (n === 3 || n === 200) return 'edit';
  return 'prompt';
}
const MARK_CODE: Record<Mark, number> = { bold: 1, italic: 2, underline: 3, strike: 4 };
const CODE_MARK: Record<number, Mark | undefined> = { 1: 'bold', 2: 'italic', 3: 'underline', 4: 'strike' };
const SOURCE = { story: 0, action: 1, dialogue: 2, instruction: 10 } as const;
const TEXT = 1;

interface MetaRange {
  position: number;
  data: number;
  length: number;
}
interface NSection {
  type: number;
  text?: string;
  meta?: Map<number, MetaRange[]>;
  source?: number;
}
interface Part {
  from: number;
  insert: string;
  delete: string;
}
interface MetaDelta {
  index: number;
  position: number;
  data: number;
  length: number;
}
type NChange = { type: 0; section: NSection; after?: number } | { type: 1; diff: Ext } | { type: 2; previous: NSection; after?: number };

interface DocState {
  sections: Map<number, NSection>;
  order: number[];
}

const asMap = <K, V>(v: unknown): Map<K, V> => (v instanceof Map ? (v as Map<K, V>) : new Map(Object.entries((v ?? {}) as object)) as unknown as Map<K, V>);
const unwrap = (v: unknown): Record<string, unknown> => (v instanceof Ext ? (v.value as Record<string, unknown>) : (v as Record<string, unknown>)) ?? {};

function cloneSection(s: NSection): NSection {
  if (s.type !== TEXT) return { ...s };
  const meta = new Map<number, MetaRange[]>();
  for (const [k, v] of asMap<number, MetaRange[]>(s.meta)) meta.set(Number(k), (v ?? []).map((r) => ({ ...r })));
  return { ...s, meta };
}

// ------------------------------------------------------------------ diffs (ext 40 → 41 text diff / 42 replace)

function diffOf(e: Ext): Ext {
  return e.type === 40 && e.value instanceof Ext ? e.value : e;
}

function applyDiff(e: Ext, sec: NSection, undo = false): NSection {
  const d = diffOf(e);
  const v = d.value as Record<string, unknown>;
  if (d.type === 42) return cloneSection((undo ? v.from : v.to) as NSection);
  if (sec.type !== TEXT) throw new Error('NovelAI document: text diff on a non-text section');
  const parts = (v.parts as Part[] | undefined) ?? [];
  const metas = asMap<number, MetaDelta[]>(v.metas);
  const out = cloneSection(sec);
  let text = out.text ?? '';
  let pos = 0;
  for (const part of parts) {
    pos += part.from;
    const del = undo ? part.insert : part.delete;
    const ins = undo ? part.delete : part.insert;
    text = text.slice(0, pos) + text.slice(pos + del.length);
    text = text.slice(0, pos) + ins + text.slice(pos);
    pos += ins.length;
  }
  out.text = text;
  for (const [key, deltas] of metas) {
    const k = Number(key);
    let ranges = out.meta!.get(k);
    if (!ranges) {
      if (undo) throw new Error(`NovelAI document: cannot undo meta ${k}`);
      out.meta!.set(k, (deltas ?? []).map((d2) => ({ position: d2.position, data: d2.data, length: d2.length })));
      continue;
    }
    for (const dl of deltas ?? []) {
      const sign = undo ? -1 : 1;
      const i = undo ? (dl.index < 0 ? -dl.index - 1 : dl.index) : dl.index;
      if (!undo && i < 0) {
        ranges = ranges.slice(0, -i - 1);
        break;
      }
      if (!ranges[i]) {
        ranges.push({ data: dl.data, length: dl.length, position: dl.position });
        continue;
      }
      ranges[i].data += sign * dl.data;
      ranges[i].length += sign * dl.length;
      ranges[i].position += sign * dl.position;
      for (const r of ranges.slice(i + 1)) r.position += sign * dl.length;
    }
    out.meta!.set(k, ranges.filter((r) => r.length !== 0));
  }
  out.source = (sec.source ?? 0) + (undo ? -1 : 1) * Number(v.source ?? 0);
  if (out.source === 0 && sec.source === undefined) delete out.source;
  return out;
}

/** The text diff NovelAI stores for an update (one changed run of text, plus meta deltas). */
function makeDiff(a: NSection, b: NSection): Ext {
  if (a.type !== TEXT || b.type !== TEXT) return new Ext(40, new Ext(42, { from: a, to: b }));
  const at = a.text ?? '';
  const bt = b.text ?? '';
  const parts: Part[] = [];
  if (at !== bt) {
    let s = 0;
    while (s < at.length && s < bt.length && at[s] === bt[s]) s++;
    let e = 0;
    while (e < at.length - s && e < bt.length - s && at[at.length - 1 - e] === bt[bt.length - 1 - e]) e++;
    parts.push({ from: s, insert: bt.slice(s, bt.length - e), delete: at.slice(s, at.length - e) });
  }
  const metas = new Map<number, MetaDelta[]>();
  const am = asMap<number, MetaRange[]>(a.meta);
  const bm = asMap<number, MetaRange[]>(b.meta);
  for (const key of new Set([...am.keys(), ...bm.keys()])) {
    const x = am.get(key) ?? [];
    const y = bm.get(key) ?? [];
    let shift = 0;
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = x[i];
      const q = y[i];
      let d: MetaDelta;
      if (p && q) {
        d = { index: i, position: q.position - p.position - shift, data: q.data - p.data, length: q.length - p.length };
        shift += d.length;
        if (d.position === 0 && d.data === 0 && d.length === 0) continue;
      } else if (p) d = { index: -i - 1, position: p.position, data: p.data, length: p.length };
      else d = { index: i, position: q.position, data: q.data, length: q.length };
      metas.set(key, [...(metas.get(key) ?? []), d]);
    }
  }
  return new Ext(40, new Ext(41, { parts, metas, source: (b.source ?? 0) - (a.source ?? 0) }));
}

// ------------------------------------------------------------------ applying change sets in NovelAI's order

type Entry = [number, NChange];

/** Order creates/removes so each `after` refers to a section placed before it (NovelAI's bucket ordering). */
function chainOrder(entries: Entry[]): Entry[] {
  const buckets: Entry[][] = [];
  let prev = 0;
  for (const e of entries) {
    const after = (e[1] as { after?: number }).after;
    if (prev === 0 || after !== prev) buckets.push([e]);
    else buckets[buckets.length - 1].push(e);
    prev = e[0];
  }
  if (buckets.length <= 1) return buckets.flat();
  const ordered = (bs: Entry[][]) => {
    for (let i = 0; i < bs.length; i++) {
      const last = bs[i][bs[i].length - 1][0];
      if (!(i < bs.length - 1) || last !== (bs[i + 1][0][1] as { after?: number }).after) {
        for (let j = 0; j < bs.length; j++) if (i !== j && i + 1 !== j && last === (bs[j][0][1] as { after?: number }).after) return false;
      }
    }
    return true;
  };
  let bs = buckets;
  for (let guard = 0; bs.length > 1 && !ordered(bs) && guard < 1000; guard++) {
    const next: Entry[][] = [];
    while (bs.length > 0) {
      const group: Entry[][] = [];
      const first = bs.splice(0, 1)[0];
      group.push(first);
      let tail = first[first.length - 1][0];
      for (let j = 0; j < bs.length; ++j) {
        if ((bs[j][0][1] as { after?: number }).after === tail) {
          group.push(bs[j]);
          tail = bs[j][bs[j].length - 1][0];
          bs.splice(j, 1);
          j = -1;
        }
      }
      let head = (first[0][1] as { after?: number }).after;
      for (let j = 0; j < bs.length; ++j) {
        if (bs[j][bs[j].length - 1][0] === head) {
          group.unshift(bs[j]);
          head = (bs[j][0][1] as { after?: number }).after;
          bs.splice(j, 1);
          j = -1;
        }
      }
      next.push(group.flat());
    }
    bs = next;
  }
  return bs.flat();
}

function sortChanges(changes: Map<number, NChange>, reverse: boolean): Entry[] {
  const all = [...changes.entries()].map(([k, v]) => [Number(k), v] as Entry);
  const updates = all.filter((e) => e[1].type === 1);
  let creates = chainOrder(all.filter((e) => e[1].type === 0));
  let removes = chainOrder(all.filter((e) => e[1].type === 2));
  if (!reverse) {
    removes = [...removes].reverse();
    return [...creates, ...updates, ...removes];
  }
  creates = [...creates].reverse();
  const groups: Entry[][] = [];
  let prev: number | null = null;
  for (const e of removes) {
    const after = (e[1] as { after?: number }).after ?? 0;
    if (prev === null || after !== prev) groups.push([e]);
    else groups[groups.length - 1].push(e);
    prev = after;
  }
  return [...groups.flatMap((g) => g.reverse()), ...updates, ...creates];
}

function addToOrder(order: number[], id: number, after: number | undefined) {
  const i = after === undefined ? -1 : after === 0 ? 0 : order.indexOf(after) + 1;
  order.splice(i === -1 ? order.length : i, 0, id);
}

function applySet(st: DocState, changes: Map<number, NChange>) {
  for (const [id, c] of sortChanges(changes, false)) {
    if (c.type === 0) {
      st.sections.set(id, cloneSection(c.section));
      addToOrder(st.order, id, c.after);
    } else if (c.type === 1) {
      const cur = st.sections.get(id);
      if (cur) st.sections.set(id, applyDiff(c.diff, cur));
    } else {
      st.sections.delete(id);
      st.order = st.order.filter((x) => x !== id);
    }
  }
}

function undoSet(st: DocState, changes: Map<number, NChange>) {
  for (const [id, c] of sortChanges(changes, true)) {
    if (c.type === 0) {
      st.sections.delete(id);
      st.order = st.order.filter((x) => x !== id);
    } else if (c.type === 1) {
      const cur = st.sections.get(id);
      if (cur) st.sections.set(id, applyDiff(c.diff, cur, true));
    } else {
      st.sections.set(id, cloneSection(c.previous));
      addToOrder(st.order, id, c.after);
    }
  }
}

// ------------------------------------------------------------------ sections <-> our spans

const paraCache = new WeakMap<NSection, Span[]>();

/** One section as paragraph spans (without the text-adventure / instruction prefixes). */
function sectionSpans(s: NSection): Span[] {
  const hit = paraCache.get(s);
  if (hit) return hit;
  const text = s.text ?? '';
  const meta = asMap<number, MetaRange[]>(s.meta);
  const origins = meta.get(META_ORIGIN) ?? [];
  const formats = meta.get(META_FORMAT) ?? [];
  const cuts = new Set<number>([0, text.length]);
  for (const r of [...origins, ...formats]) {
    cuts.add(Math.max(0, Math.min(text.length, r.position)));
    cuts.add(Math.max(0, Math.min(text.length, r.position + r.length)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Span[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b <= a) continue;
    const o = origins.find((r) => r.position <= a && a < r.position + r.length);
    const marks = [...new Set(formats.filter((r) => r.position <= a && a < r.position + r.length).map((r) => CODE_MARK[r.data]).filter((m): m is Mark => !!m))];
    out.push(marks.length ? { text: text.slice(a, b), origin: o ? codeOrigin(o.data) : 'prompt', marks } : { text: text.slice(a, b), origin: o ? codeOrigin(o.data) : 'prompt' });
  }
  const spans = normalize(out);
  paraCache.set(s, spans);
  return spans;
}

/** Paragraphs as shown: action/dialogue get "> ", instruction runs are wrapped in "{ … }". */
type Para = { id: number; section: NSection; spans: Span[]; deco: string };

function visibleParagraphs(st: DocState): Para[] {
  const list = st.order.map((id) => ({ id, section: st.sections.get(id) })).filter((x): x is { id: number; section: NSection } => !!x.section && x.section.type === TEXT);
  return list.map((x, i) => {
    let spans = sectionSpans(x.section);
    let deco = '';
    const src = x.section.source ?? 0;
    const origin: Origin = spans[0]?.origin ?? 'user';
    if (src === SOURCE.action || src === SOURCE.dialogue) {
      spans = [{ text: '> ', origin }, ...spans];
      deco = '>';
    } else if (src === SOURCE.instruction) {
      if (i === 0 || list[i - 1].section.source !== SOURCE.instruction) {
        spans = [{ text: '{ ', origin }, ...spans];
        deco += '{';
      }
      if (i === list.length - 1 || list[i + 1].section.source !== SOURCE.instruction) {
        spans = [...spans, { text: ' }', origin: spans[spans.length - 1]?.origin ?? origin }];
        deco += '}';
      }
    }
    return { id: x.id, section: x.section, spans: deco ? normalize(spans) : spans, deco };
  });
}

function stateDoc(st: DocState): Span[] {
  const paras = visibleParagraphs(st);
  return paras.length ? fromParagraphs(paras.map((p) => p.spans)) : [];
}

/** Ranges in NovelAI's record layout ({ position, data, length }), merged where adjacent. */
function ranges(spans: Span[], value: (sp: Span) => number[]): MetaRange[] {
  const out: MetaRange[] = [];
  let pos = 0;
  for (const sp of spans) {
    for (const data of value(sp)) {
      const last = [...out].reverse().find((r) => r.data === data && r.position + r.length === pos);
      if (last) last.length += sp.text.length;
      else out.push({ position: pos, data, length: sp.text.length });
    }
    pos += sp.text.length;
  }
  return out.sort((a, b) => a.position - b.position);
}

/** A paragraph of ours as a NovelAI section (detecting "> " actions and "{ … }" instructions). */
function paragraphSection(spans: Span[], source: number): NSection {
  const meta = new Map<number, MetaRange[]>();
  meta.set(META_ORIGIN, ranges(spans, (sp) => [ORIGIN_CODE[sp.origin]]));
  meta.set(META_FORMAT, ranges(spans, (sp) => (sp.marks ?? []).map((m) => MARK_CODE[m]).filter((x) => x !== undefined)));
  const sec: NSection = { type: TEXT, text: spans.map((s) => s.text).join(''), meta };
  if (source) sec.source = source;
  return sec;
}

function trimSpans(spans: Span[], from: number, to: number): Span[] {
  return slice(spans, from, docText(spans).length - to);
}

/** Our document as NovelAI sections (with sources), one per paragraph. */
function docSections(doc: Span[], adventure: boolean): NSection[] {
  if (!docText(doc)) return [];
  const paras = paragraphs(doc);
  const texts = paras.map((p) => docText(p));
  const out: NSection[] = [];
  for (let i = 0; i < paras.length; i++) {
    const t = texts[i];
    if (adventure && /^> /.test(t)) {
      out.push(paragraphSection(trimSpans(paras[i], 2, 0), /^> You (say|ask|shout|whisper)\b/i.test(t) ? SOURCE.dialogue : SOURCE.action));
      continue;
    }
    // "{ … }" over one or more paragraphs becomes instruction sections.
    if (/^\{ /.test(t)) {
      let j = i;
      while (j < paras.length && !/ \}$/.test(texts[j])) j++;
      if (j < paras.length && !texts.slice(i + 1, j + 1).some((x) => x.startsWith('{ '))) {
        for (let k = i; k <= j; k++) out.push(paragraphSection(trimSpans(paras[k], k === i ? 2 : 0, k === j ? 2 : 0), SOURCE.instruction));
        i = j;
        continue;
      }
    }
    out.push(paragraphSection(paras[i], SOURCE.story));
  }
  return out;
}

function sameSection(a: NSection, b: NSection): boolean {
  if (a.type !== b.type || (a.text ?? '') !== (b.text ?? '') || (a.source ?? 0) !== (b.source ?? 0)) return false;
  const am = asMap<number, MetaRange[]>(a.meta);
  const bm = asMap<number, MetaRange[]>(b.meta);
  for (const k of new Set([...am.keys(), ...bm.keys()])) {
    const x = am.get(k) ?? [];
    const y = bm.get(k) ?? [];
    if (x.length !== y.length || x.some((r, i) => r.position !== y[i].position || r.data !== y[i].data || r.length !== y[i].length)) return false;
  }
  return true;
}

// ------------------------------------------------------------------ ids

/** Random ids like NovelAI's (two random uint32 folded into a safe integer). */
function naiId(): number {
  const a = Math.floor(Math.random() * 4294967296);
  const b = Math.floor(Math.random() * 4294967296);
  const id = Math.abs(Math.floor(524288 * a + b));
  return id || naiId();
}

// ------------------------------------------------------------------ import

export interface ImportedDocument {
  doc: Span[];
  history: History;
  step: number;
}

function nodeType(changes: Change[], ai: boolean): HistoryNodeType {
  if (ai) return 'ai';
  const origins = new Set(changes.flatMap((c) => c.inserted.map((s) => s.origin)));
  if (origins.has('ai')) return 'ai';
  if (origins.has('user')) return 'user';
  if (origins.has('prompt') && !changes.some((c) => c.removed.length)) return 'prompt';
  return 'edit';
}

/**
 * The change between two states, as one replacement of whole paragraphs (paragraphs equal by identity at the
 * start and end are skipped).
 */
function paragraphChange(doc: Span[], before: Para[], after: Para[]): Change | null {
  const same = (a: Para, b: Para) => a.id === b.id && a.section === b.section && a.deco === b.deco;
  let k = 0;
  while (k < before.length && k < after.length && same(before[k], after[k])) k++;
  let m = 0;
  while (m < before.length - k && m < after.length - k && same(before[before.length - 1 - m], after[after.length - 1 - m])) m++;
  const oldMid = before.slice(k, before.length - m);
  const newMid = after.slice(k, after.length - m);
  if (!oldMid.length && !newMid.length) return null;
  let start = 0;
  for (let i = 0; i < k; i++) start += docText(before[i].spans).length + 1;
  const total = docText(doc).length;
  const joined = newMid.length ? fromParagraphs(newMid.map((p) => p.spans)) : [];
  let from: number;
  let to: number;
  let inserted: Span[];
  if (oldMid.length) {
    let end = start;
    oldMid.forEach((p, i) => (end += docText(p.spans).length + (i ? 1 : 0)));
    if (newMid.length) {
      from = start;
      to = end;
      inserted = joined;
    } else if (k + oldMid.length < before.length) {
      from = start;
      to = end + 1;
      inserted = [];
    } else {
      from = Math.max(0, start - 1);
      to = end;
      inserted = [];
    }
  } else if (k < before.length) {
    from = to = start;
    inserted = normalize([...joined, { text: '\n', origin: joined[joined.length - 1]?.origin ?? 'user' }]);
  } else {
    from = to = total;
    inserted = before.length ? normalize([{ text: '\n', origin: joined[0]?.origin ?? 'user' }, ...joined]) : joined;
  }
  return { pos: from, removed: slice(doc, from, to), inserted };
}

/** Decode `content.document` and replay its history into our document + branching history. */
export function importNovelAIDocument(b64: string): ImportedDocument {
  const raw = unpack(base64ToBytes(b64));
  const d = unwrap(raw);
  const hist = unwrap(d.history);
  const nodes = asMap<number, unknown>(hist.nodes);
  const byId = new Map<number, Record<string, unknown>>();
  for (const [k, v] of nodes) byId.set(Number(k), unwrap(v));
  const rootId = Number(hist.root);
  const currentId = Number(hist.current);
  const changesOf = (n: Record<string, unknown>) => asMap<number, NChange>(n.changes);
  const childrenOf = (n: Record<string, unknown>) => [...((n.children as Set<number> | number[] | undefined) ?? [])].map(Number).filter((c) => byId.has(c));

  const history = createHistory();
  history.nodes.root.time = byId.get(rootId)?.date instanceof Date ? (byId.get(rootId)!.date as Date).getTime() : Date.now();
  const ourId = new Map<number, string>([[rootId, 'root']]);
  const st: DocState = { sections: new Map(), order: [] };
  // The root may carry changes in older files; apply them as part of the base.
  const rootNode = byId.get(rootId);
  if (rootNode) applySet(st, changesOf(rootNode));
  let doc = stateDoc(st);
  let paras = visibleParagraphs(st);
  if (doc.length) {
    const first = { id: uid(), parent: 'root', children: [], type: 'prompt' as const, changes: [{ pos: 0, removed: [], inserted: doc }], time: history.nodes.root.time };
    history.nodes[first.id] = first;
    history.nodes.root.children.push(first.id);
    ourId.set(rootId, first.id);
  }
  let finalDoc: Span[] = doc;

  // Iterative DFS: enter applies a node's changes, exit undoes them.
  type Frame = { id: number; exit: boolean; parentDoc?: Span[]; parentParas?: typeof paras };
  const stack: Frame[] = [];
  const rootKids = rootNode ? childrenOf(rootNode) : [];
  for (const c of [...rootKids].reverse()) stack.push({ id: c, exit: false });
  const routes = new Map<number, number>();
  for (const [id, n] of byId) if (n.route !== undefined) routes.set(id, Number(n.route));
  while (stack.length) {
    const f = stack.pop()!;
    const n = byId.get(f.id)!;
    if (f.exit) {
      undoSet(st, changesOf(n));
      doc = f.parentDoc!;
      paras = f.parentParas!;
      continue;
    }
    const parentDoc = doc;
    const parentParas = paras;
    applySet(st, changesOf(n));
    paras = visibleParagraphs(st);
    const change = paragraphChange(parentDoc, parentParas, paras);
    doc = change ? normalize(replace(parentDoc, change.pos, change.pos + docText(change.removed).length, change.inserted)) : parentDoc;
    const parent = ourId.get(Number(n.parent)) ?? 'root';
    const node: HistoryNode = {
      id: uid(),
      parent,
      children: [],
      type: nodeType(change ? [change] : [], n.genPosition !== undefined && n.genPosition !== null),
      changes: change ? [change] : [],
      time: n.date instanceof Date ? n.date.getTime() : Date.now(),
    };
    ourId.set(f.id, node.id);
    history.nodes[node.id] = node;
    history.nodes[parent].children.push(node.id);
    if (f.id === currentId) finalDoc = doc;
    stack.push({ id: f.id, exit: true, parentDoc, parentParas });
    for (const c of [...childrenOf(n)].reverse()) stack.push({ id: c, exit: false });
  }
  // Redo follows NovelAI's route (last visited child).
  for (const [nai, route] of routes) {
    const a = ourId.get(nai);
    const b = ourId.get(route);
    if (a && b && history.nodes[a]?.children.includes(b)) history.nodes[a].preferred = b;
  }
  history.current = ourId.get(currentId) ?? 'root';
  if (history.current === 'root' && ourId.get(rootId) !== 'root') history.current = ourId.get(rootId)!;

  // Unsaved edits (dirtySections) sit on top of the current node.
  const dirty = asMap<number, NChange>(d.dirtySections);
  if (dirty.size) {
    const cur: DocState = { sections: new Map(), order: [] };
    // Rebuild the current state by replaying the path, then apply the dirty set.
    const path = pathToNai(byId, currentId, rootId);
    for (const id of path) applySet(cur, changesOf(byId.get(id)!));
    const before = visibleParagraphs(cur);
    applySet(cur, dirty);
    const after = visibleParagraphs(cur);
    const change = paragraphChange(finalDoc, before, after);
    if (change) {
      finalDoc = normalize(replace(finalDoc, change.pos, change.pos + docText(change.removed).length, change.inserted));
      const node: HistoryNode = { id: uid(), parent: history.current, children: [], type: nodeType([change], false), changes: [change], time: Date.now() };
      history.nodes[node.id] = node;
      history.nodes[history.current].children.push(node.id);
      history.nodes[history.current].preferred = node.id;
      history.current = node.id;
    }
  }
  // Point every ancestor of the current node at it, so redo follows the visible branch.
  const path = pathTo(history, history.current);
  for (let i = 0; i + 1 < path.length; i++) history.nodes[path[i]].preferred = path[i + 1];
  return { doc: finalDoc, history, step: Number(d.step ?? 0) };
}

function pathToNai(byId: Map<number, Record<string, unknown>>, id: number, root: number): number[] {
  const out: number[] = [];
  let cur: number | undefined = id;
  while (cur !== undefined && byId.has(cur)) {
    out.unshift(cur);
    if (cur === root) break;
    const p: unknown = byId.get(cur)!.parent;
    cur = p === undefined || p === null ? undefined : Number(p);
  }
  return out;
}

// ------------------------------------------------------------------ export

interface ExportNode {
  ours: HistoryNode;
  naiId: number;
  changes: Map<number, NChange>;
  genPosition?: { sectionId: number; offset: number };
}

/** Encode our document and its whole history tree as a NovelAI Document (base64). */
export function exportNovelAIDocument(story: Pick<Story, 'doc' | 'history' | 'mode'>): string {
  const adventure = story.mode === 'adventure';
  const h = story.history;
  const ids = new Map<string, number>();
  const nai = (id: string) => {
    let v = ids.get(id);
    if (!v) ids.set(id, (v = naiId()));
    return v;
  };
  const out = new Map<string, ExportNode>();
  // DFS over our tree with the document, keeping the parent's sections (with ids) to diff against.
  type Sec = { id: number; section: NSection };
  type Frame = { id: string; doc: Span[]; secs: Sec[] };
  const stack: Frame[] = [{ id: 'root', doc: [], secs: [] }];
  let currentSecs: Sec[] = [];
  while (stack.length) {
    const { id, doc, secs } = stack.pop()!;
    const node = h.nodes[id];
    if (!node) continue;
    let myDoc = doc;
    let mySecs = secs;
    const changes = new Map<number, NChange>();
    let genPosition: ExportNode['genPosition'];
    if (id !== 'root') {
      myDoc = applyChanges(doc, node.changes);
      const next = docSections(myDoc, adventure);
      // Match paragraphs: unchanged prefix/suffix keep their ids; the middle becomes updates/creates/removes.
      let k = 0;
      while (k < secs.length && k < next.length && sameSection(secs[k].section, next[k])) k++;
      let m = 0;
      while (m < secs.length - k && m < next.length - k && sameSection(secs[secs.length - 1 - m].section, next[next.length - 1 - m])) m++;
      const oldMid = secs.slice(k, secs.length - m);
      const newMid = next.slice(k, next.length - m);
      const result: Sec[] = secs.slice(0, k);
      const pairs = Math.min(oldMid.length, newMid.length);
      for (let i = 0; i < pairs; i++) {
        changes.set(oldMid[i].id, { type: 1, diff: makeDiff(oldMid[i].section, newMid[i]) });
        result.push({ id: oldMid[i].id, section: newMid[i] });
      }
      for (let i = pairs; i < newMid.length; i++) {
        const sid = naiId();
        const after = result.length ? result[result.length - 1].id : 0;
        changes.set(sid, { type: 0, section: newMid[i], after });
        result.push({ id: sid, section: newMid[i] });
      }
      for (let i = pairs; i < oldMid.length; i++) {
        const prevIndex = secs.indexOf(oldMid[i]) - 1;
        changes.set(oldMid[i].id, { type: 2, previous: oldMid[i].section, after: prevIndex >= 0 ? secs[prevIndex].id : 0 });
      }
      result.push(...secs.slice(secs.length - m));
      mySecs = result;
      if (node.type === 'ai') {
        // Where the generated text ends: section and offset (NovelAI's genPosition).
        const last = node.changes[node.changes.length - 1];
        if (last) {
          const end = last.pos + docText(last.inserted).length;
          const before = docText(myDoc).slice(0, end);
          const pIndex = (before.match(/\n/g) ?? []).length;
          const offset = end - (before.lastIndexOf('\n') + 1);
          const sec = mySecs[Math.min(pIndex, mySecs.length - 1)];
          if (sec) genPosition = { sectionId: sec.id, offset };
        }
      }
    }
    out.set(id, { ours: node, naiId: nai(id), changes, genPosition });
    if (id === h.current) currentSecs = mySecs;
    for (const c of [...node.children].reverse()) stack.push({ id: c, doc: myDoc, secs: mySecs });
  }
  const depth = pathTo(h, h.current).length - 1;
  const nodes = new Map<number, Ext>();
  for (const [id, e] of out) {
    const n = e.ours;
    nodes.set(
      e.naiId,
      new Ext(31, {
        id: e.naiId,
        parent: n.parent ? out.get(n.parent)?.naiId : undefined,
        children: new Set(n.children.filter((c) => out.has(c)).map((c) => out.get(c)!.naiId)),
        route: n.preferred && out.has(n.preferred) ? out.get(n.preferred)!.naiId : undefined,
        changes: e.changes,
        date: new Date(n.time || Date.now()),
        genPosition: e.genPosition,
      }),
    );
    void id;
  }
  const sections = new Map<number, NSection>(currentSecs.map((s) => [s.id, s.section]));
  const document = new Ext(20, {
    sections,
    order: currentSecs.map((s) => s.id),
    history: new Ext(30, { root: out.get('root')!.naiId, current: out.get(h.current)?.naiId ?? out.get('root')!.naiId, nodes }),
    dirtySections: new Map(),
    step: depth,
  });
  return bytesToBase64(pack(document));
}

// ------------------------------------------------------------------ base64

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ------------------------------------------------------------------ advanced conditions (lorebook v6)

type NCondition = Record<string, unknown> & { type?: string };

export function conditionFromNovelAI(c: NCondition): Condition {
  switch (c.type) {
    case 'key': {
      const where = (Array.isArray(c.in) ? c.in : []).map(String);
      const loc = (w: string) => (w === 'memory' ? 'memory' : w === 'an' ? 'authorsNote' : w === 'lore' ? 'lore' : 'story') as 'story' | 'memory' | 'authorsNote' | 'lore';
      const range = typeof c.range === 'number' ? c.range : undefined;
      const one = (w: string): Condition => ({ type: 'keyword', key: String(c.key ?? ''), location: loc(w), range });
      if (where.length <= 1) return one(where[0] ?? 'story');
      return { type: 'or', conditions: where.map(one) };
    }
    case 'lore':
      return { type: 'loreActive', entryId: String(c.entryId ?? '') };
    case 'not':
      return { type: 'not', condition: c.condition ? conditionFromNovelAI(c.condition as NCondition) : { type: 'true' } };
    case 'or':
    case 'and':
      return { type: c.type, conditions: (Array.isArray(c.children) ? c.children : []).map((x) => conditionFromNovelAI(x as NCondition)) };
    case 'equation': {
      const terms: EquationTerm[] = (Array.isArray(c.terms) ? c.terms : []).map((t) => {
        const tt = t as { value?: unknown; operator?: unknown };
        const value = typeof tt.value === 'number' ? tt.value : String(tt.value ?? 0);
        return { operator: (['+', '-', '*', '/', '%'].includes(String(tt.operator)) ? tt.operator : '+') as EquationTerm['operator'], value: value as EquationTerm['value'] };
      });
      return { type: 'equation', terms, op: (['<', '<=', '=', '>=', '>'].includes(String(c.comparison)) ? c.comparison : '=') as '=', value: Number(c.target ?? 0) };
    }
    case 'string':
      return {
        type: 'string',
        variable: (['storyText', 'memoryText', 'authorsNoteText'].includes(String(c.left)) ? c.left : 'storyText') as 'storyText',
        op: ({ equals: 'equals', includes: 'includes', startswith: 'startsWith', endswith: 'endsWith' } as const)[String(c.comparison) as 'equals'] ?? 'equals',
        value: String(c.right ?? ''),
      };
    case 'model':
      return { type: 'model', model: String(c.model ?? c.modelName ?? '') };
    case 'random':
      return { type: 'random', chance: typeof c.chance === 'number' ? c.chance : 50 };
    case 'storymode':
      return { type: 'storyMode', mode: c.mode === 'adventure' ? 'adventure' : 'storyteller' };
  }
  return { type: 'true' };
}

export function conditionToNovelAI(c: Condition): NCondition {
  switch (c.type) {
    case 'true':
      return { type: 'true' };
    case 'keyword':
      return { type: 'key', key: c.key, in: [c.location === 'memory' ? 'memory' : c.location === 'authorsNote' ? 'an' : c.location === 'lore' ? 'lore' : 'story'], range: c.range && c.range > 0 ? c.range : 4000 };
    case 'loreActive':
      return { type: 'lore', entryId: c.entryId };
    case 'model':
      return { type: 'model', model: c.model, modelName: c.model };
    case 'storyMode':
      return { type: 'storymode', mode: c.mode === 'adventure' ? 'adventure' : 'normal' };
    case 'random':
      return { type: 'random', chance: c.chance };
    case 'number': {
      const eq = { type: 'equation', terms: [{ value: c.variable, operator: '+' }], comparison: c.op === '!=' ? '=' : c.op, target: c.value };
      return c.op === '!=' ? { type: 'not', condition: eq } : eq;
    }
    case 'equation': {
      // NovelAI has no "active entries" or "random" terms; they count as 0 there.
      const terms = c.terms.map((t) => ({ value: t.value === 'activeEntries' || t.value === 'random' ? 0 : t.value, operator: t.operator }));
      const eq = { type: 'equation', terms, comparison: c.op === '!=' ? '=' : c.op, target: c.value };
      return c.op === '!=' ? { type: 'not', condition: eq } : eq;
    }
    case 'string':
      return { type: 'string', left: c.variable, comparison: { equals: 'equals', includes: 'includes', startsWith: 'startswith', endsWith: 'endswith' }[c.op], right: c.value };
    case 'and':
    case 'or':
      return { type: c.type, children: c.conditions.map(conditionToNovelAI) };
    case 'not':
      return { type: 'not', condition: conditionToNovelAI(c.condition) };
  }
}

// ------------------------------------------------------------------ side chats

export function sideChatsFromNovelAI(raw: unknown): SideChat[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const chat = c as { id?: string; name?: string; createdAt?: number | string; messages?: Record<string, unknown>[] };
    return {
      id: String(chat.id ?? uid()),
      title: String(chat.name ?? 'Chat'),
      createdAt: Number(new Date(chat.createdAt ?? Date.now())),
      messages: (chat.messages ?? []).map((m) =>
        m.type === 'excerpt'
          ? { role: 'user' as const, content: '', excerpt: { label: String(m.excerptLoreName ?? m.excerptSource ?? 'Excerpt'), text: String(m.content ?? '') } }
          : { role: m.type === 'assistant' ? ('assistant' as const) : ('user' as const), content: String(m.content ?? '') },
      ),
    };
  });
}

export function sideChatsToNovelAI(chats: SideChat[], model: string): unknown[] {
  return chats.map((c) => ({
    id: c.id,
    name: c.title,
    createdAt: c.createdAt,
    lastUpdatedAt: c.createdAt,
    messages: c.messages.flatMap((m) => {
      const base = { id: uid(), model, createdAt: c.createdAt };
      const out: Record<string, unknown>[] = [];
      if (m.excerpt) out.push({ ...base, id: uid(), type: 'excerpt', content: m.excerpt.text, excerptSource: 'selection', excerptLoreName: m.excerpt.label });
      if (m.content) out.push({ ...base, type: m.role, content: m.content });
      return out;
    }),
  }));
}

// ------------------------------------------------------------------ helpers shared with formats.ts

/** Story text and history from a `.story` content object (document or legacy fragments). */
export function novelAIContentDoc(content: Record<string, unknown>): ImportedDocument {
  if (typeof content.document === 'string' && content.document) return importNovelAIDocument(content.document);
  const story = (content.story ?? {}) as { fragments?: { data: string; origin: string }[]; step?: number };
  const doc = normalize(
    (story.fragments ?? []).map((f) => ({
      text: String(f.data ?? ''),
      origin: (f.origin === 'ai' ? 'ai' : f.origin === 'edit' ? 'edit' : f.origin === 'user' ? 'user' : 'prompt') as Origin,
    })),
  );
  return { doc, history: flatten(doc), step: Number(story.step ?? 0) };
}

