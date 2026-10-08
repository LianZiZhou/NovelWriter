import { describe, expect, it } from 'vitest';
import { applyChange, diffDocs, docText, normalize, replace, revertChange, slice } from '../src/doc.ts';
import { canRedo, commit, createHistory, structureStats, flatten, jumpTo, materialize, redo, retryOptions, trim, undo } from '../src/history.ts';
import type { Span } from '../src/types.ts';

describe('doc', () => {
  it('normalizes and replaces spans', () => {
    const d: Span[] = [{ text: 'Hello ', origin: 'prompt' }, { text: 'world', origin: 'ai' }];
    const r = replace(d, 6, 11, [{ text: 'there', origin: 'edit' }]);
    expect(docText(r)).toBe('Hello there');
    expect(r[1]).toEqual({ text: 'there', origin: 'edit' });
    expect(normalize([{ text: 'a', origin: 'ai' }, { text: 'b', origin: 'ai' }])).toEqual([{ text: 'ab', origin: 'ai' }]);
  });

  it('diffs and round-trips changes', () => {
    const a: Span[] = [{ text: 'The cat sat.', origin: 'prompt' }];
    const b: Span[] = [{ text: 'The ', origin: 'prompt' }, { text: 'big ', origin: 'edit' }, { text: 'cat sat.', origin: 'prompt' }];
    const c = diffDocs(a, b)!;
    expect(c.pos).toBe(4);
    expect(applyChange(a, c)).toEqual(b);
    expect(revertChange(b, c)).toEqual(a);
    expect(diffDocs(a, a)).toBeNull();
  });

  it('detects origin-only changes', () => {
    const a: Span[] = [{ text: 'abc', origin: 'ai' }];
    const b: Span[] = [{ text: 'abc', origin: 'edit' }];
    expect(diffDocs(a, b)).not.toBeNull();
  });
});

describe('history', () => {
  const ins = (pos: number, text: string, origin: Span['origin']) => ({ pos, removed: [], inserted: [{ text, origin }] });

  it('supports undo/redo/retry branches and jumps', () => {
    let h = createHistory();
    let doc: Span[] = [];
    const c1 = ins(0, 'Once.', 'prompt');
    doc = applyChange(doc, c1);
    h = commit(h, 'prompt', [c1]).history;
    const c2 = ins(5, ' AI one.', 'ai');
    doc = applyChange(doc, c2);
    const r2 = commit(h, 'ai', [c2]);
    h = r2.history;
    // retry: undo, then a new AI sibling
    const u = undo(h, doc)!;
    h = u.history;
    doc = u.doc;
    expect(docText(doc)).toBe('Once.');
    expect(canRedo(h)).toBe(true);
    const c3 = ins(5, ' AI two.', 'ai');
    doc = applyChange(doc, c3);
    const r3 = commit(h, 'ai', [c3]);
    h = r3.history;
    expect(retryOptions(h)).toHaveLength(2);
    const j = jumpTo(h, doc, r2.node.id);
    expect(docText(j.doc)).toBe('Once. AI one.');
    expect(docText(materialize(j.history))).toBe('Once. AI one.');
    // redo after undo follows the preferred (last visited) child
    const u2 = undo(j.history, j.doc)!;
    const rr = redo(u2.history, u2.doc)!;
    expect(docText(rr.doc)).toBe('Once. AI one.');
    // trim keeps only current path
    const t = trim(rr.history);
    expect(Object.keys(t.nodes)).toHaveLength(3);
  });

  it('flattens', () => {
    const h = flatten([{ text: 'x', origin: 'ai' }]);
    expect(docText(materialize(h))).toBe('x');
  });
});

describe('structure stats', () => {
  it('measures steps, retries and abandoned branches', () => {
    const ch = (t: string) => [{ pos: 0, removed: [], inserted: [{ text: t, origin: 'ai' as const }] }];
    let h = createHistory();
    h = commit(h, 'prompt', ch('a')).history;
    const prompt = h.current;
    h = commit(h, 'ai', ch('b')).history;
    h = commit(h, 'user', ch('c')).history;
    h = commit(h, 'ai', ch('d')).history;
    // Retry from the prompt: a second AI child, then continue that branch.
    h = { ...h, current: prompt };
    h = commit(h, 'ai', ch('x')).history;
    h = commit(h, 'ai', ch('y')).history;
    const s = structureStats(h);
    expect(s.currentStep).toBe(3);
    expect(s.furthestStep).toBe(4);
    expect(s.deadEnds).toBe(1);
    expect(s.longestAbandonedBranch).toBe(3);
    expect(s.mostRetries).toBe(1);
    expect(s.noRetryStreak).toBe(1);
  });
});

describe('diffDocs', () => {
  // Reference: the original per-character implementation.
  function reference(before: Span[], after: Span[]) {
    const flat = (d: Span[]) => d.flatMap((sp) => [...sp.text].flatMap((c) => (c.length === 2 ? [c[0], c[1]] : [c])).map((c) => `${c}|${sp.origin}|${(sp.marks ?? []).slice().sort().join(',')}`));
    const a = flat(before);
    const b = flat(after);
    let start = 0;
    while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
    if (start === a.length && start === b.length) return null;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA--;
      endB--;
    }
    return { pos: start, removed: slice(before, start, endA), inserted: slice(after, start, endB) };
  }
  it('matches the per-character reference on random edits', () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    const origins = ['prompt', 'ai', 'edit', 'user'] as const;
    const marks = [undefined, ['bold'], ['italic', 'bold']] as const;
    const randomDoc = (): Span[] =>
      normalize(Array.from({ length: 1 + rnd(6) }, () => ({ text: 'ab\nc d😀e'.slice(rnd(4), 4 + rnd(6)) || 'x', origin: origins[rnd(4)], ...(rnd(3) ? {} : { marks: [...(marks[rnd(3)] ?? [])] as Span['marks'] }) })));
    for (let i = 0; i < 3000; i++) {
      const a = randomDoc();
      const b = rnd(3) === 0 ? randomDoc() : replace(a, Math.min(rnd(8), docText(a).length), Math.min(rnd(8) + 2, docText(a).length), rnd(2) ? [] : randomDoc());
      expect(diffDocs(a, b)).toEqual(reference(a, b));
      const c = diffDocs(a, b);
      if (c) expect(applyChange(a, c)).toEqual(normalize(b));
    }
  });
});
