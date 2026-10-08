import type { Change, Mark, Origin, Span } from './types.ts';

export function docText(doc: readonly Span[]): string {
  let s = '';
  for (const sp of doc) s += sp.text;
  return s;
}

export function docLength(doc: readonly Span[]): number {
  let n = 0;
  for (const sp of doc) n += sp.text.length;
  return n;
}

function sameMarks(a?: Mark[], b?: Mark[]): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  const sx = [...x].sort();
  const sy = [...y].sort();
  return sx.every((m, i) => m === sy[i]);
}

/** Merge adjacent spans with identical attributes and drop empty ones. */
export function normalize(doc: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const sp of doc) {
    if (!sp.text) continue;
    const last = out[out.length - 1];
    if (last && last.origin === sp.origin && sameMarks(last.marks, sp.marks)) {
      out[out.length - 1] = { ...last, text: last.text + sp.text };
    } else {
      out.push(sp.marks && sp.marks.length ? { text: sp.text, origin: sp.origin, marks: [...sp.marks] } : { text: sp.text, origin: sp.origin });
    }
  }
  return out;
}

/** Return the spans covering [from, to). */
export function slice(doc: readonly Span[], from: number, to: number): Span[] {
  const out: Span[] = [];
  let pos = 0;
  for (const sp of doc) {
    const end = pos + sp.text.length;
    if (end > from && pos < to) {
      const a = Math.max(from, pos) - pos;
      const b = Math.min(to, end) - pos;
      out.push({ ...sp, text: sp.text.slice(a, b) });
    }
    pos = end;
    if (pos >= to) break;
  }
  return normalize(out);
}

/** Replace [from, to) with `inserted`. */
export function replace(doc: readonly Span[], from: number, to: number, inserted: readonly Span[]): Span[] {
  const len = docLength(doc);
  return normalize([...slice(doc, 0, from), ...inserted, ...slice(doc, to, len)]);
}

export function applyChange(doc: readonly Span[], c: Change): Span[] {
  return replace(doc, c.pos, c.pos + docLength(c.removed), c.inserted);
}

export function revertChange(doc: readonly Span[], c: Change): Span[] {
  return replace(doc, c.pos, c.pos + docLength(c.inserted), c.removed);
}

export function applyChanges(doc: readonly Span[], cs: readonly Change[]): Span[] {
  let d = doc as Span[];
  for (const c of cs) d = applyChange(d, c);
  return d;
}

export function revertChanges(doc: readonly Span[], cs: readonly Change[]): Span[] {
  let d = doc as Span[];
  for (let i = cs.length - 1; i >= 0; i--) d = revertChange(d, cs[i]);
  return d;
}

/**
 * Compute the minimal single change turning `before` into `after`, comparing
 * text and span attributes (so origin/mark changes are captured too).
 */
export function diffDocs(before: readonly Span[], after: readonly Span[]): Change | null {
  const a = flatten(before);
  const b = flatten(after);
  let start = 0;
  const min = Math.min(a.length, b.length);
  while (start < min && sameChar(a[start], b[start])) start++;
  if (start === a.length && start === b.length) return null;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && sameChar(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }
  return {
    pos: start,
    removed: slice(before, start, endA),
    inserted: slice(after, start, endB),
  };
}

interface Ch {
  c: string;
  o: Origin;
  m: string;
}

function flatten(doc: readonly Span[]): Ch[] {
  const out: Ch[] = [];
  for (const sp of doc) {
    const m = (sp.marks ?? []).slice().sort().join(',');
    for (const c of sp.text) {
      // Surrogate pairs are split into code points; keep UTF-16 indices aligned.
      if (c.length === 2) {
        out.push({ c: c[0], o: sp.origin, m }, { c: c[1], o: sp.origin, m });
      } else out.push({ c, o: sp.origin, m });
    }
  }
  return out;
}

function sameChar(x: Ch, y: Ch): boolean {
  return x.c === y.c && x.o === y.o && x.m === y.m;
}

/**
 * Text-only diff used to classify user typing. Returns the replaced range in
 * `before` and the inserted text.
 */
export function diffText(before: string, after: string): { pos: number; removed: string; inserted: string } | null {
  if (before === after) return null;
  let start = 0;
  const min = Math.min(before.length, after.length);
  while (start < min && before[start] === after[start]) start++;
  let endA = before.length;
  let endB = after.length;
  while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) {
    endA--;
    endB--;
  }
  return { pos: start, removed: before.slice(start, endA), inserted: after.slice(start, endB) };
}

export function plainDoc(text: string, origin: Origin): Span[] {
  return text ? [{ text, origin }] : [];
}

/** Split the document into paragraphs (by '\n'), keeping spans. */
export function paragraphs(doc: readonly Span[]): Span[][] {
  const out: Span[][] = [[]];
  for (const sp of doc) {
    const parts = sp.text.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) out.push([]);
      if (p) out[out.length - 1].push({ ...sp, text: p });
    });
  }
  return out;
}

export function fromParagraphs(paras: readonly Span[][]): Span[] {
  const out: Span[] = [];
  paras.forEach((p, i) => {
    if (i > 0) {
      // Attribute the newline to the following paragraph's first span origin, or the previous one.
      const origin = p[0]?.origin ?? out[out.length - 1]?.origin ?? 'user';
      out.push({ text: '\n', origin });
    }
    out.push(...p);
  });
  return normalize(out);
}
