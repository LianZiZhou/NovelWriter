import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import { keyRegexes, visibleTokenProbs, type LoreEntry } from '@novelwriter/core';
import { useStory } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import {
  NovelPlugins,
  OriginMark,
  EXTERNAL,
  docPlainText,
  docToSpans,
  offsetToPos,
  posToOffset,
  replaceRangeTr,
  setDocTr,
  spansToJSON,
  matchOffset,
  countMatches,
  pmChange,
  REDECORATE,
  TOKEN_PROBS,
  TokenProbs,
  type TokenRange,
} from './pm.ts';
import { TokenPopover } from '../tokenprobs/TokenProbs.tsx';
import { EditorContextMenu, type MenuState } from './ContextMenu.tsx';
import { FindBar } from './FindBar.tsx';
import { SelectionToolbar } from './SelectionToolbar.tsx';

/** Recompiles key regexes only when the lorebook entries change. */
const loreKeyCache = {
  entries: null as LoreEntry[] | null,
  res: [] as RegExp[],
  get(): RegExp[] {
    if (!useSettings.getState().editorLoreKeys) return [];
    const entries = useStory.getState().current?.lorebook.entries ?? [];
    if (entries !== this.entries) {
      this.entries = entries;
      this.res = entries.filter((e) => e.enabled && !e.forceActivation).flatMap((e) => e.keys.flatMap(keyRegexes));
    }
    return this.res;
  },
};

export const StoryEditor = memo(function StoryEditor() {
  // Narrow subscriptions: the editor must not re-render on its own keystrokes.
  const storyId = useStory((s) => s.current?.id);
  const mode = useStory((s) => s.current?.mode);
  const entries = useStory((s) => s.current?.lorebook.entries);
  const setEditor = useStory((s) => s.setEditor);
  const highlight = useSettings((s) => s.highlightSpeech);
  const inverted = useSettings((s) => s.highlightSpeechInverted);
  const spellcheck = useSettings((s) => s.editorSpellcheck);
  const loreKeysOn = useSettings((s) => s.editorLoreKeys);
  const showToolbar = useSettings((s) => s.showEditorToolbar);
  const visibilityRange = useSettings((s) => s.paragraphVisibilityRange);
  const showProbs = useSettings((s) => s.tokenProbabilities && s.editorTokenProbabilities);
  const historyStep = useStory((s) => s.current?.history.current);
  const [tokenPick, setTokenPick] = useState<{ range: TokenRange; rect: DOMRect } | null>(null);
  const findOpen = useUI((s) => s.findOpen);
  const generating = useStory((s) => s.generating);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [find, setFind] = useState({ query: '', index: 0 });
  const findRef = useRef(find);
  /** Editor document as of the last update, for structural diffs. */
  const prevDoc = useRef<import('@tiptap/pm/model').Node | null>(null);
  findRef.current = find;

  const opts = useMemo(
    () => ({
      hasAI: () => {
        const s = useStory.getState().current;
        return !!s && (s.step > 0 || Object.values(s.history.nodes).some((n) => n.type === 'ai'));
      },
      adventure: () => useStory.getState().current?.mode === 'adventure',
      highlightSpeech: () => useSettings.getState().highlightSpeech,
      placeholder: () => t('Enter your prompt here...'),
      find: () => findRef.current,
      loreKeys: () => loreKeyCache.get(),
    }),
    [],
  );

  // Built once; later documents are loaded with setDocTr.
  const [initialContent] = useState(() => spansToJSON(useStory.getState().current?.doc ?? []));
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        undoRedo: false,
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        hardBreak: false,
        link: false,
        trailingNode: false,
        dropcursor: false,
      }),
      OriginMark,
      NovelPlugins(opts),
      TokenProbs((range, rect) => setTokenPick({ range, rect })),
    ],
    content: initialContent,
    editorProps: {
      attributes: { spellcheck: String(spellcheck), 'aria-label': 'Story', role: 'textbox', 'aria-multiline': 'true' },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain');
        if (text === undefined) return false;
        const { from, to } = view.state.selection;
        const a = posToOffset(view.state.doc, from);
        const b = posToOffset(view.state.doc, to);
        // Insert as user text; the origin plugin tags it (paste is not EXTERNAL).
        const tr = replaceRangeTr(view.state, a, b, [{ text: text.replace(/\r\n/g, '\n'), origin: 'user' }]);
        tr.setMeta(EXTERNAL, false);
        const end = offsetToPos(tr.doc, a + text.length);
        tr.setSelection(TextSelection.create(tr.doc, end));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      handleDOMEvents: {
        contextmenu(view, event) {
          // Ctrl+right-click opens the browser menu; "Swap Context Menu Controls" reverses that.
          const native = event.ctrlKey || event.metaKey;
          if (useSettings.getState().swapContextMenu ? !native : native) return false;
          event.preventDefault();
          const { from, to } = view.state.selection;
          setMenu({ x: event.clientX, y: event.clientY, hasSelection: from !== to });
          return true;
        },
      },
    },
    onCreate({ editor: ed }) {
      prevDoc.current = ed.state.doc;
    },
    onUpdate({ editor: ed, transaction }) {
      const before = prevDoc.current;
      prevDoc.current = ed.state.doc;
      if (transaction.getMeta(EXTERNAL) || !before) return;
      const store = useStory.getState();
      if (!store.current || store.generating) return;
      const change = pmChange(before, ed.state.doc, store.current.doc);
      if (change) store.editorChanged(change);
      // Debug aid for tests: verify the incremental change against a full conversion.
      if ((window as { __nwCheckDoc?: boolean }).__nwCheckDoc) {
        const want = JSON.stringify(docToSpans(ed.state.doc));
        const got = JSON.stringify(useStory.getState().current?.doc);
        if (want !== got) throw new Error(`editor/store doc mismatch\nwant ${want.slice(0, 400)}\ngot  ${got.slice(0, 400)}`);
      }
    },
  });

  // Register controller for the store.
  useEffect(() => {
    if (!editor) return;
    let scrollQueued = false;
    setEditor({
      setDoc(doc, cursor) {
        const tr = setDocTr(editor.state, doc);
        if (cursor !== undefined) {
          const pos = Math.min(offsetToPos(tr.doc, cursor), tr.doc.content.size);
          tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
        }
        editor.view.dispatch(tr);
      },
      replaceRange(from, to, spans) {
        editor.view.dispatch(replaceRangeTr(editor.state, from, to, spans));
      },
      getSelection() {
        const { from, to } = editor.state.selection;
        const a = posToOffset(editor.state.doc, from);
        const b = posToOffset(editor.state.doc, to);
        return { from: a, to: b, text: docPlainText(editor.state.doc).slice(a, b) };
      },
      focus() {
        editor.commands.focus();
      },
      scrollToEnd() {
        // Coalesced to one layout read per frame while text streams in.
        if (scrollQueued) return;
        scrollQueued = true;
        requestAnimationFrame(() => {
          scrollQueued = false;
          const el = editor.view.dom.closest('.editor-scroll');
          if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 400) el.scrollTop = el.scrollHeight;
        });
      },
    });
    return () => setEditor(null);
  }, [editor, setEditor]);

  // Load a different story.
  useEffect(() => {
    if (!editor) return;
    const s = useStory.getState().current;
    editor.view.dispatch(setDocTr(editor.state, s?.doc ?? []));
    requestAnimationFrame(() => {
      const el = editor.view.dom.closest('.editor-scroll');
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [editor, storyId]);

  // Re-render decorations when display options change.
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(EXTERNAL, true).setMeta(REDECORATE, true));
  }, [editor, highlight, find, mode, loreKeysOn, entries]);

  useEffect(() => {
    editor?.view.dom.setAttribute('spellcheck', String(spellcheck));
  }, [editor, spellcheck]);

  // Streamed text is written at fixed offsets, so editing waits until generation ends.
  useEffect(() => {
    editor?.setEditable(!generating, false);
  }, [editor, generating]);

  // Editor Token Probabilities: re-place token ranges when the history step changes (generation, undo, jump).
  useEffect(() => {
    if (!editor) return;
    const h = useStory.getState().current?.history;
    const ranges = showProbs && h ? visibleTokenProbs(h) : [];
    editor.view.dispatch(editor.state.tr.setMeta(EXTERNAL, true).setMeta(TOKEN_PROBS, ranges));
    if (!showProbs) setTokenPick(null);
  }, [editor, showProbs, historyStep, storyId]);

  // Paragraph Visibility Range: off-screen paragraphs skip layout and paint (content-visibility), except a band
  // of `visibilityRange` characters around the caret, which stays fully rendered for editing and selection.
  const keepStyle = useRef<HTMLStyleElement | null>(null);
  useEffect(() => {
    if (!editor || !visibilityRange) return;
    const style = document.createElement('style');
    document.head.appendChild(style);
    keepStyle.current = style;
    let last = '';
    const update = () => {
      const doc = editor.state.doc;
      const caret = Math.min(editor.state.selection.head, doc.content.size - 1);
      const idx = doc.resolve(Math.max(0, caret)).index(0);
      let a = idx;
      let chars = 0;
      while (a > 0 && chars < visibilityRange) chars += doc.child(--a).content.size + 1;
      let b = idx;
      chars = 0;
      while (b < doc.childCount - 1 && chars < visibilityRange) chars += doc.child(++b).content.size + 1;
      const rule = `.nw-editor.pv .ProseMirror > p:nth-child(n+${a + 1}):nth-child(-n+${b + 1}){content-visibility:visible}`;
      if (rule !== last) style.textContent = last = rule;
    };
    update();
    editor.on('selectionUpdate', update);
    editor.on('update', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('update', update);
      style.remove();
      keepStyle.current = null;
    };
  }, [editor, visibilityRange]);

  const gotoMatch = (index: number) => {
    if (!editor || !find.query) return;
    const text = docPlainText(editor.state.doc);
    const n = countMatches(text, find.query);
    if (!n) return;
    const i = ((index % n) + n) % n;
    setFind({ ...find, index: i });
    const off = matchOffset(text, find.query, i);
    const from = offsetToPos(editor.state.doc, off);
    const to = offsetToPos(editor.state.doc, off + find.query.length);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)).scrollIntoView().setMeta(EXTERNAL, true));
  };

  return (
    <div className={`nw-editor ${highlight ? 'highlight-speech' : ''} ${inverted ? 'inverted' : ''} ${visibilityRange ? 'pv' : ''}`}>
      {findOpen && editor && (
        <FindBar
          query={find.query}
          index={find.index}
          total={countMatches(docPlainText(editor.state.doc), find.query)}
          onQuery={(q) => setFind({ query: q, index: 0 })}
          onNext={() => gotoMatch(find.index + 1)}
          onPrev={() => gotoMatch(find.index - 1)}
          onClose={() => {
            setFind({ query: '', index: 0 });
            useUI.getState().set({ findOpen: false });
          }}
        />
      )}
      <EditorContent editor={editor} />
      {showToolbar && editor && !generating && <SelectionToolbar editor={editor} />}
      {tokenPick && <TokenPopover range={tokenPick.range} rect={tokenPick.rect} onClose={() => setTokenPick(null)} />}
      {menu && editor && <EditorContextMenu state={menu} editor={editor} onClose={() => setMenu(null)} />}
    </div>
  );
});
