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
  const lenA = docLength(before);
  const lenB = docLength(after);
  // Common prefix, walking both span lists in step without allocating per character.
  let start = 0;
  {
    let ia = 0;
    let ib = 0;
    let oa = 0;
    let ob = 0;
    while (ia < before.length && ib < after.length) {
      const sa = before[ia];
      const sb = after[ib];
      if (sa.origin !== sb.origin || !sameMarks(sa.marks, sb.marks)) break;
      const n = Math.min(sa.text.length - oa, sb.text.length - ob);
      let k = 0;
      while (k < n && sa.text.charCodeAt(oa + k) === sb.text.charCodeAt(ob + k)) k++;
      start += k;
      if (k < n) break;
      oa += k;
      ob += k;
      if (oa === sa.text.length) {
        ia++;
        oa = 0;
      }
      if (ob === sb.text.length) {
        ib++;
        ob = 0;
      }
    }
  }
  if (start === lenA && start === lenB) return null;
  // Common suffix, not overlapping the prefix.
  let suffix = 0;
  {
    const max = Math.min(lenA, lenB) - start;
    let ia = before.length - 1;
    let ib = after.length - 1;
    let oa = ia >= 0 ? before[ia].text.length : 0;
    let ob = ib >= 0 ? after[ib].text.length : 0;
    while (ia >= 0 && ib >= 0 && suffix < max) {
      const sa = before[ia];
      const sb = after[ib];
      if (oa === 0) {
        ia--;
        oa = ia >= 0 ? before[ia].text.length : 0;
        continue;
      }
      if (ob === 0) {
        ib--;
        ob = ib >= 0 ? after[ib].text.length : 0;
        continue;
      }
      if (sa.origin !== sb.origin || !sameMarks(sa.marks, sb.marks)) break;
      const n = Math.min(oa, ob, max - suffix);
      let k = 0;
      while (k < n && sa.text.charCodeAt(oa - 1 - k) === sb.text.charCodeAt(ob - 1 - k)) k++;
      suffix += k;
      if (k < n) break;
      oa -= k;
      ob -= k;
    }
  }
  const endA = lenA - suffix;
  const endB = lenB - suffix;
  return {
    pos: start,
    removed: slice(before, start, endA),
    inserted: slice(after, start, endB),
  };
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
