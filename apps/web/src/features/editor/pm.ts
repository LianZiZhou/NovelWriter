import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { diffDocs, normalize, paragraphs, slice, type Change, type Mark as SpanMark, type Origin, type Span } from '@novelwriter/core';

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

function paraSpans(para: PMNode): Span[] {
  const out: Span[] = [];
  para.forEach((n) => {
    if (!n.isText || !n.text) return;
    const origin = (n.marks.find((m) => m.type.name === 'origin')?.attrs.o as Origin) ?? 'user';
    const marks = n.marks.map((m) => SPAN_MARKS[m.type.name]).filter(Boolean);
    out.push(marks.length ? { text: n.text, origin, marks } : { text: n.text, origin });
  });
  return out;
}

/** Text offset of the start of paragraph `index` (paragraphs hold only text, so content size = length). */
function paraOffset(doc: PMNode, index: number): number {
  let off = 0;
  for (let k = 0; k < index; k++) off += doc.child(k).content.size + 1;
  return off;
}

function indexAt(doc: PMNode, pos: number): number {
  const p = Math.max(0, Math.min(pos, doc.content.size - 1));
  return Math.min(doc.resolve(p).index(0), doc.childCount - 1);
}

/**
 * The span-level change between two editor documents, given the span form of `before` (canonical, as kept in
 * the store). Only the paragraphs that differ are converted, so the cost does not grow with story length:
 * ProseMirror shares unchanged paragraph nodes, which makes findDiffStart/End cheap.
 */
export function pmChange(before: PMNode, after: PMNode, spans: readonly Span[]): Change | null {
  const start = before.content.findDiffStart(after.content);
  if (start == null) return null;
  const end = before.content.findDiffEnd(after.content)!;
  let endA = end.a;
  const overlap = start - Math.min(end.a, end.b);
  if (overlap > 0) endA += overlap;
  const delta = after.childCount - before.childCount;
  const i0 = indexAt(before, start);
  let i1 = Math.max(indexAt(before, endA - 1), i0, i0 - delta);
  // A newline before an empty paragraph takes its origin from the text before it, so keep those together.
  while (i1 + 1 < before.childCount && before.child(i1 + 1).content.size === 0) i1++;
  const j1 = i1 + delta;
  const offStart = i0 > 0 ? paraOffset(before, i0) - 1 : 0;
  const offEnd = paraOffset(before, i1) + before.child(i1).content.size;
  const removed = slice(spans, offStart, offEnd);
  const prevOrigin = offStart > 0 ? slice(spans, offStart - 1, offStart)[0]?.origin : undefined;
  const inserted: Span[] = [];
  for (let j = i0; j <= j1; j++) {
    const ps = paraSpans(after.child(j));
    if (j > 0) inserted.push({ text: '\n', origin: ps[0]?.origin ?? inserted[inserted.length - 1]?.origin ?? prevOrigin ?? 'user' });
    inserted.push(...ps);
  }
  const change = diffDocs(removed, normalize(inserted));
  if (!change) return null;
  return { ...change, pos: change.pos + offStart };
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
  return state.tr.replaceWith(0, state.doc.content.size, content).setMeta(EXTERNAL, true).setMeta(REDECORATE, true).setMeta('addToHistory', false);
}

export interface EditorOptionsRef {
  hasAI: () => boolean;
  adventure: () => boolean;
  highlightSpeech: () => boolean;
  placeholder: () => string;
  find: () => { query: string; index: number };
  /** Global regexes for enabled lorebook keys, when the editor should mark them. */
  loreKeys?: () => RegExp[];
}

const decoKey = new PluginKey<DecorationSet>('nw-decorations');
/** Transaction meta that forces decorations to be rebuilt (display options changed). */
export const REDECORATE = 'nw-redecorate';

interface DecoContext {
  adventure: boolean;
  speech: boolean;
  loreKeys: RegExp[];
}

function decoContext(opts: EditorOptionsRef): DecoContext {
  return { adventure: opts.adventure(), speech: opts.highlightSpeech(), loreKeys: opts.loreKeys?.() ?? [] };
}

function decorateParagraph(para: PMNode, pos: number, ctx: DecoContext, decos: Decoration[]): void {
  const text = para.textContent;
  if (!text) return;
  const start = pos + 1;
  if (ctx.adventure && text.startsWith('>')) {
    decos.push(Decoration.node(pos, pos + para.nodeSize, { class: /^>\s*You (say|ask|shout|whisper)\b/i.test(text) ? 'action-line say' : 'action-line' }));
    const markerLen = text.startsWith('> ') ? 2 : 1;
    decos.push(Decoration.inline(start, start + markerLen, { class: 'action-marker' }));
  }
  if (ctx.speech) {
    let last = 0;
    for (const m of text.matchAll(QUOTE_RE)) {
      const s = m.index ?? 0;
      if (s > last) decos.push(Decoration.inline(start + last, start + s, { class: 'narration' }));
      decos.push(Decoration.inline(start + s, start + s + m[0].length, { class: 'speech' }));
      last = s + m[0].length;
    }
    if (last < text.length) decos.push(Decoration.inline(start + last, start + text.length, { class: 'narration' }));
  }
  for (const re of ctx.loreKeys) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (!m[0]) break;
      const i = m.index ?? 0;
      decos.push(Decoration.inline(start + i, start + i + m[0].length, { class: 'lore-key' }));
    }
  }
}

function buildDecorations(doc: PMNode, opts: EditorOptionsRef): DecorationSet {
  const decos: Decoration[] = [];
  if (doc.childCount === 1 && doc.firstChild!.content.size === 0) {
    decos.push(Decoration.node(0, doc.firstChild!.nodeSize, { class: 'is-editor-empty', 'data-placeholder': opts.placeholder() }));
  }
  const ctx = decoContext(opts);
  const find = opts.find();
  const q = find.query.toLowerCase();
  let hit = 0;
  doc.forEach((para, pos) => {
    decorateParagraph(para, pos, ctx, decos);
    if (q) {
      const lower = para.textContent.toLowerCase();
      const start = pos + 1;
      let i = lower.indexOf(q);
      while (i >= 0) {
        decos.push(Decoration.inline(start + i, start + i + q.length, { class: `find-hit ${hit === find.index ? 'current' : ''}` }));
        hit++;
        i = lower.indexOf(q, i + q.length);
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

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
            // Structural diff: cost follows the size of the edit, not of the story.
            const start = oldState.doc.content.findDiffStart(newState.doc.content);
            if (start == null) return null;
            const end = oldState.doc.content.findDiffEnd(newState.doc.content)!;
            let { a: endA, b: endB } = end;
            const overlap = start - Math.min(endA, endB);
            if (overlap > 0) {
              endA += overlap;
              endB += overlap;
            }
            const removed = oldState.doc.textBetween(start, endA, '\n');
            const inserted = newState.doc.textBetween(start, endB, '\n');
            // Formatting-only changes and paragraph splits/joins: nothing to tag.
            if (removed === inserted || !inserted.replace(/\n/g, '')) return null;
            const originType = newState.schema.marks.origin;
            const atEnd = endB >= newState.doc.content.size - 1;
            const origin: Origin = !opts.hasAI() ? 'prompt' : atEnd && !removed ? 'user' : 'edit';
            const tr = newState.tr.removeMark(start, endB, originType).addMark(start, endB, originType.create({ o: origin }));
            tr.setStoredMarks([originType.create({ o: origin }), ...(newState.storedMarks ?? []).filter((m) => m.type !== originType)]);
            return tr;
          },
        }),
        new Plugin({
          key: decoKey,
          state: {
            init: (_, state) => buildDecorations(state.doc, opts),
            apply(tr, set, oldState, newState) {
              // Option changes (and find, whose "current" hit depends on every match before it) rebuild everything.
              if (tr.getMeta(REDECORATE) || opts.find().query) return buildDecorations(newState.doc, opts);
              if (!tr.docChanged) return set;
              if (newState.doc.childCount <= 1 || oldState.doc.childCount <= 1) return buildDecorations(newState.doc, opts);
              const start = oldState.doc.content.findDiffStart(newState.doc.content);
              if (start == null) return set.map(tr.mapping, newState.doc);
              const end = oldState.doc.content.findDiffEnd(newState.doc.content)!;
              const endB = Math.max(end.b, start);
              // Re-decorate only the paragraphs touched by the edit.
              const doc = newState.doc;
              const i0 = indexAt(doc, start);
              const i1 = Math.max(i0, indexAt(doc, endB - 1));
              let from = 0;
              for (let k = 0; k < i0; k++) from += doc.child(k).nodeSize;
              let to = from;
              for (let k = i0; k <= i1; k++) to += doc.child(k).nodeSize;
              const mapped = set.map(tr.mapping, doc);
              const stale = mapped.find(from, to);
              const fresh: Decoration[] = [];
              const ctx = decoContext(opts);
              let pos = from;
              for (let k = i0; k <= i1; k++) {
                const para = doc.child(k);
                decorateParagraph(para, pos, ctx, fresh);
                pos += para.nodeSize;
              }
              return mapped.remove(stale).add(doc, fresh);
            },
          },
          props: {
            decorations(state) {
              return decoKey.getState(state) as DecorationSet;
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
