import { describe, expect, it } from 'vitest';
import { applyChange, diffDocs, docText, normalize, replace, revertChange } from '../src/doc.ts';
import { canRedo, commit, createHistory, flatten, jumpTo, materialize, redo, retryOptions, trim, undo } from '../src/history.ts';
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
