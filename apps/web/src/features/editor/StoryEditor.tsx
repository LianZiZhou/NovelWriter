import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
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
} from './pm.ts';
import { EditorContextMenu, type MenuState } from './ContextMenu.tsx';
import { FindBar } from './FindBar.tsx';

export function StoryEditor() {
  const story = useStory((s) => s.current);
  const storyId = story?.id;
  const setEditor = useStory((s) => s.setEditor);
  const highlight = useSettings((s) => s.highlightSpeech);
  const inverted = useSettings((s) => s.highlightSpeechInverted);
  const spellcheck = useSettings((s) => s.editorSpellcheck);
  const findOpen = useUI((s) => s.findOpen);
  const generating = useStory((s) => s.generating);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [find, setFind] = useState({ query: '', index: 0 });
  const findRef = useRef(find);
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
    }),
    [],
  );

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
    ],
    content: spansToJSON(useStory.getState().current?.doc ?? []),
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
          if (event.ctrlKey || event.metaKey) return false;
          event.preventDefault();
          const { from, to } = view.state.selection;
          setMenu({ x: event.clientX, y: event.clientY, hasSelection: from !== to });
          return true;
        },
      },
    },
    onUpdate({ editor: ed, transaction }) {
      if (transaction.getMeta(EXTERNAL)) return;
      useStory.getState().editorChanged(docToSpans(ed.state.doc));
    },
  });

  // Register controller for the store.
  useEffect(() => {
    if (!editor) return;
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
        const el = editor.view.dom.closest('.editor-scroll');
        if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 400) el.scrollTop = el.scrollHeight;
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
    editor.view.dispatch(editor.state.tr.setMeta(EXTERNAL, true));
  }, [editor, highlight, find, story?.mode]);

  useEffect(() => {
    editor?.view.dom.setAttribute('spellcheck', String(spellcheck));
  }, [editor, spellcheck]);

  // Streamed text is written at fixed offsets, so editing waits until generation ends.
  useEffect(() => {
    editor?.setEditable(!generating, false);
  }, [editor, generating]);

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
    <div className={`nw-editor ${highlight ? 'highlight-speech' : ''} ${inverted ? 'inverted' : ''}`}>
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
      {menu && editor && <EditorContextMenu state={menu} editor={editor} onClose={() => setMenu(null)} />}
    </div>
  );
}
