import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { TextB, TextItalic, TextStrikethrough, TextUnderline } from '@phosphor-icons/react';
import type { Editor } from '@tiptap/react';
import { t } from '../../i18n.ts';

type MarkName = 'bold' | 'italic' | 'underline' | 'strike';

const BUTTONS: { mark: MarkName; label: string; icon: React.ReactNode }[] = [
  { mark: 'bold', label: 'Bold', icon: <TextB size={16} weight="bold" /> },
  { mark: 'italic', label: 'Italic', icon: <TextItalic size={16} weight="bold" /> },
  { mark: 'underline', label: 'Underline', icon: <TextUnderline size={16} weight="bold" /> },
  { mark: 'strike', label: 'Strikethrough', icon: <TextStrikethrough size={16} weight="bold" /> },
];

/** Floating formatting bar above a non-empty text selection ("Show Editor Toolbar"). */
export function SelectionToolbar({ editor }: { editor: Editor }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || !editor.isFocused) return setPos(null);
      const a = editor.view.coordsAtPos(from);
      const b = editor.view.coordsAtPos(to);
      setPos({ x: (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2, y: Math.min(a.top, b.top) });
      force((n) => n + 1);
    };
    const hide = () => setTimeout(() => !editor.isFocused && setPos(null), 150);
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    editor.on('blur', hide);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
      editor.off('blur', hide);
    };
  }, [editor]);
  if (!pos) return null;
  return createPortal(
    <div className="selection-toolbar fade-in" style={{ left: pos.x, top: pos.y }} role="toolbar" aria-label={t('Formatting')} onMouseDown={(e) => e.preventDefault()}>
      {BUTTONS.map((b) => (
        <button
          type="button"
          key={b.mark}
          aria-label={t(b.label)}
          title={t(b.label)}
          aria-pressed={editor.isActive(b.mark)}
          className={editor.isActive(b.mark) ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleMark(b.mark).run()}
        >
          {b.icon}
        </button>
      ))}
    </div>,
    document.body,
  );
}
