import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { diffText, paragraphs, type Mark as SpanMark, type Origin, type Span } from '@novelwriter/core';

/** Origin of text (prompt / ai / edit / user), rendered as a colored span. */
export const OriginMark = Mark.create({
  name: 'origin',
  inclusive: true,
  excludes: 'origin',
  addAttributes() {
    return {
      o: {
        default: 'user',
        parseHTML: (el) => (el as HTMLElement).dataset.o ?? 'user',
        renderHTML: (attrs) => ({ 'data-o': attrs.o, class: `o-${attrs.o}` }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-o]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
});

const MARK_NAMES: Record<SpanMark, string> = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike' };
const SPAN_MARKS = Object.fromEntries(Object.entries(MARK_NAMES).map(([k, v]) => [v, k])) as Record<string, SpanMark>;

export const EXTERNAL = 'nw-external';

export function spansToJSON(doc: Span[]) {
  return {
    type: 'doc',
    content: paragraphs(doc).map((p) => ({
      type: 'paragraph',
      content: p.length
        ? p.map((sp) => ({
            type: 'text',
            text: sp.text,
            marks: [{ type: 'origin', attrs: { o: sp.origin } }, ...(sp.marks ?? []).map((m) => ({ type: MARK_NAMES[m] }))],
          }))
        : undefined,
    })),
  };
}

function paragraphNodes(schema: Schema, doc: Span[]): PMNode[] {
  return paragraphs(doc).map((p) =>
    schema.nodes.paragraph.create(
      null,
      p.map((sp) => schema.text(sp.text, [schema.marks.origin.create({ o: sp.origin }), ...(sp.marks ?? []).map((m) => schema.marks[MARK_NAMES[m]].create())])),
    ),
  );
}

export function docToSpans(doc: PMNode): Span[] {
  const out: Span[] = [];
  doc.forEach((para, _offset, index) => {
    if (index > 0) {
      let origin: Origin | undefined;
      para.forEach((n) => {
        if (!origin && n.isText) origin = (n.marks.find((m) => m.type.name === 'origin')?.attrs.o as Origin) ?? 'user';
      });
      origin ??= out[out.length - 1]?.origin ?? 'user';
      out.push({ text: '\n', origin });
    }
    para.forEach((n) => {
      if (!n.isText || !n.text) return;
      const origin = (n.marks.find((m) => m.type.name === 'origin')?.attrs.o as Origin) ?? 'user';
      const marks = n.marks.map((m) => SPAN_MARKS[m.type.name]).filter(Boolean);
      out.push(marks.length ? { text: n.text, origin, marks } : { text: n.text, origin });
    });
  });
  // normalize: merge neighbours
  const merged: Span[] = [];
  for (const sp of out) {
    const last = merged[merged.length - 1];
    if (last && last.origin === sp.origin && (last.marks ?? []).join() === (sp.marks ?? []).join()) last.text += sp.text;
    else merged.push({ ...sp });
  }
  return merged;
}

/** Plain text with '\n' between paragraphs. */
export function docPlainText(doc: PMNode): string {
  const parts: string[] = [];
  doc.forEach((p) => parts.push(p.textContent));
  return parts.join('\n');
}

/** Map a plain-text offset to a ProseMirror position. */
export function offsetToPos(doc: PMNode, offset: number): number {
  let pos = 0;
  let remaining = offset;
  let result = -1;
  doc.forEach((para, paraPos) => {
    if (result >= 0) return;
    const len = para.textContent.length;
    if (remaining <= len) {
      result = paraPos + 1 + posInPara(para, remaining);
      return;
    }
    remaining -= len + 1;
    pos = paraPos + para.nodeSize;
  });
  return result >= 0 ? result : Math.max(0, pos - 1);
}

function posInPara(para: PMNode, textOffset: number): number {
  // Paragraphs only contain text nodes, so text offset equals content position.
  return Math.min(textOffset, para.content.size);
}

export function posToOffset(doc: PMNode, pos: number): number {
  let offset = 0;
  let result = -1;
  doc.forEach((para, paraPos, index) => {
    if (result >= 0) return;
    if (index > 0) offset += 1;
    const start = paraPos + 1;
    const end = start + para.content.size;
    if (pos <= end) {
      result = offset + Math.max(0, pos - start);
      return;
    }
    offset += para.textContent.length;
  });
  return result >= 0 ? result : offset;
}

/** Replace a plain-text range with spans (which may contain newlines). */
export function replaceRangeTr(state: EditorState, from: number, to: number, spans: Span[]): Transaction {
  const a = offsetToPos(state.doc, from);
  const b = offsetToPos(state.doc, to);
  const tr = state.tr;
  if (!spans.length || spans.every((s) => !s.text)) {
    tr.delete(a, b);
  } else {
    const nodes = paragraphNodes(state.schema, spans);
    tr.replace(a, b, new Slice(Fragment.from(nodes), 1, 1));
  }
  return tr.setMeta(EXTERNAL, true).setMeta('addToHistory', false);
}

export function setDocTr(state: EditorState, spans: Span[]): Transaction {
  const nodes = paragraphNodes(state.schema, spans);
  const content = nodes.length ? nodes : [state.schema.nodes.paragraph.create()];
  return state.tr.replaceWith(0, state.doc.content.size, content).setMeta(EXTERNAL, true).setMeta('addToHistory', false);
}

export interface EditorOptionsRef {
  hasAI: () => boolean;
  adventure: () => boolean;
  highlightSpeech: () => boolean;
  placeholder: () => string;
  find: () => { query: string; index: number };
}

const decoKey = new PluginKey('nw-decorations');

const QUOTE_RE = /"[^"\n]*"?|“[^”\n]*”?|「[^」\n]*」?|『[^』\n]*』?/g;

/**
 * Assigns origins to user-typed text and renders decorations (placeholder,
 * speech highlighting, adventure action lines, find results).
 */
export function NovelPlugins(opts: EditorOptionsRef) {
  return Extension.create({
    name: 'novelPlugins',
    addKeyboardShortcuts() {
      return {
        'Mod-d': () => this.editor.commands.toggleStrike(),
        'Shift-Enter': () => this.editor.commands.splitBlock(),
      };
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          appendTransaction(trs, oldState, newState) {
            if (!trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta(EXTERNAL))) return null;
            const before = docPlainText(oldState.doc);
            const after = docPlainText(newState.doc);
            const d = diffText(before, after);
            const originType = newState.schema.marks.origin;
            if (!d) {
              // Formatting-only change or paragraph restructure: nothing to tag.
              return null;
            }
            if (!d.inserted.replace(/\n/g, '')) return null;
            const atEnd = d.pos + d.inserted.length === after.length;
            const origin: Origin = !opts.hasAI() ? 'prompt' : atEnd && !d.removed ? 'user' : 'edit';
            const from = offsetToPos(newState.doc, d.pos);
            const to = offsetToPos(newState.doc, d.pos + d.inserted.length);
            const tr = newState.tr.removeMark(from, to, originType).addMark(from, to, originType.create({ o: origin }));
            tr.setStoredMarks([originType.create({ o: origin }), ...(newState.storedMarks ?? []).filter((m) => m.type !== originType)]);
            return tr;
          },
        }),
        new Plugin({
          key: decoKey,
          props: {
            decorations(state) {
              const decos: Decoration[] = [];
              const doc = state.doc;
              if (doc.childCount === 1 && doc.firstChild!.content.size === 0) {
                decos.push(Decoration.node(0, doc.firstChild!.nodeSize, { class: 'is-editor-empty', 'data-placeholder': opts.placeholder() }));
              }
              const adventure = opts.adventure();
              const speech = opts.highlightSpeech();
              const find = opts.find();
              const q = find.query.toLowerCase();
              let hit = 0;
              doc.forEach((para, pos) => {
                const text = para.textContent;
                const start = pos + 1;
                if (adventure && text.startsWith('>')) {
                  decos.push(Decoration.node(pos, pos + para.nodeSize, { class: 'action-line' }));
                  const markerLen = text.startsWith('> ') ? 2 : 1;
                  decos.push(Decoration.inline(start, start + markerLen, { class: 'action-marker' }));
                }
                if (speech && text) {
                  let last = 0;
                  for (const m of text.matchAll(QUOTE_RE)) {
                    const s = m.index ?? 0;
                    if (s > last) decos.push(Decoration.inline(start + last, start + s, { class: 'narration' }));
                    decos.push(Decoration.inline(start + s, start + s + m[0].length, { class: 'speech' }));
                    last = s + m[0].length;
                  }
                  if (last < text.length) decos.push(Decoration.inline(start + last, start + text.length, { class: 'narration' }));
                }
                if (q) {
                  const lower = text.toLowerCase();
                  let i = lower.indexOf(q);
                  while (i >= 0) {
                    decos.push(Decoration.inline(start + i, start + i + q.length, { class: `find-hit ${hit === find.index ? 'current' : ''}` }));
                    hit++;
                    i = lower.indexOf(q, i + q.length);
                  }
                }
              });
              return DecorationSet.create(doc, decos);
            },
          },
        }),
      ];
    },
  });
}

/** Count find matches in plain text. */
export function countMatches(text: string, q: string): number {
  if (!q) return 0;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let n = 0;
  let i = lower.indexOf(ql);
  while (i >= 0) {
    n++;
    i = lower.indexOf(ql, i + ql.length);
  }
  return n;
}

/** Plain-text offset of the n-th match. */
export function matchOffset(text: string, q: string, n: number): number {
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let i = lower.indexOf(ql);
  for (let k = 0; k < n && i >= 0; k++) i = lower.indexOf(ql, i + ql.length);
  return i;
}
