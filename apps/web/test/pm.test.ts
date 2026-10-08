import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { applyChange } from '@novelwriter/core';
import { OriginMark, docToSpans, pmChange, spansToJSON } from '../src/features/editor/pm.ts';

const schema = getSchema([StarterKit.configure({ undoRedo: false }), OriginMark]);

describe('pmChange', () => {
  it('matches a full conversion after random edits', () => {
    let seed = 11;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    const origins = ['prompt', 'ai', 'edit', 'user'] as const;
    const words = ['rain', 'bridge', ' ', '"Hi,"', 'Mara', '', 'x'];
    const randomSpans = () => {
      const out = [];
      const n = 1 + rnd(6);
      for (let i = 0; i < n; i++) out.push({ text: (rnd(4) === 0 ? '\n' : '') + words[rnd(words.length)] + (rnd(3) === 0 ? '\n\n' : ''), origin: origins[rnd(4)] });
      return out.filter((s) => s.text);
    };
    for (let round = 0; round < 1500; round++) {
      let state = EditorState.create({ schema, doc: schema.nodeFromJSON(spansToJSON(randomSpans().length ? randomSpans() : [{ text: 'a', origin: 'ai' }])) });
      let spans = docToSpans(state.doc);
      for (let step = 0; step < 8; step++) {
        const size = state.doc.content.size;
        const a = 1 + rnd(Math.max(1, size - 1));
        const b = Math.min(size - 1, a + rnd(12));
        const tr = state.tr;
        const kind = rnd(9);
        try {
          if (kind === 0) tr.insertText(words[rnd(words.length)] || 'y', a);
          else if (kind === 1) tr.delete(a, Math.max(a, b));
          else if (kind === 2) tr.split(Math.min(a, size - 1));
          else if (kind === 3) tr.addMark(a, Math.max(a, b), schema.marks.bold.create());
          else if (kind === 4) tr.addMark(a, Math.max(a, b), schema.marks.origin.create({ o: origins[rnd(4)] }));
          else if (kind === 6) tr.delete(a, size - 1);
          else if (kind === 7 && state.doc.childCount > 1) {
            // Delete whole paragraphs at node boundaries (e.g. the last ones).
            const k = 1 + rnd(state.doc.childCount - 1);
            let from = 0;
            for (let i = 0; i < k; i++) from += state.doc.child(i).nodeSize;
            tr.delete(from, rnd(2) ? size : Math.min(size, from + state.doc.child(k).nodeSize));
          } else if (kind === 8) tr.delete(Math.max(1, a - 3), size - 1);
          else {
            tr.setSelection(TextSelection.create(tr.doc, a, Math.max(a, b)));
            tr.replaceSelectionWith(schema.text(words[rnd(words.length)] || 'z', [schema.marks.origin.create({ o: 'user' })]));
          }
        } catch {
          continue;
        }
        if (!tr.docChanged) continue;
        const next = state.apply(tr);
        const change = pmChange(state.doc, next.doc, spans);
        const got = change ? applyChange(spans, change) : spans;
        const want = docToSpans(next.doc);
        expect(got).toEqual(want);
        state = next;
        spans = want;
      }
    }
  });
});
