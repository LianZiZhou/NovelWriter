import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CaretRight } from '@phosphor-icons/react';
import type { Editor } from '@tiptap/react';
import { LORE_GEN_TYPES, SPECIAL_CHARACTERS, newLoreEntry } from '@novelwriter/core';
import { useStory } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { useSettings } from '../../store/settings.ts';
import { t } from '../../i18n.ts';
import { downloadSpeech, speak, stopSpeaking } from '../tts/tts.ts';
import { chatAsExcerpt } from '../right/SideChatTab.tsx';
import { invoke, useScripts } from '../scripts/host.ts';
import { posToOffset, docPlainText } from './pm.ts';

export interface MenuState {
  x: number;
  y: number;
  hasSelection: boolean;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';

function Item({ label, shortcut, onClick, disabled, sub, desc, glyph }: { label: string; shortcut?: string; onClick?: () => void; disabled?: boolean; sub?: ReactNode; desc?: string; glyph?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className={`item ${open && sub && !disabled ? 'open' : ''} ${desc ? 'two-line' : ''}`} disabled={disabled} onClick={onClick} role="menuitem">
        <span className="item-main">
          <span className="item-label">
            {glyph !== undefined && <span className="glyph">{glyph}</span>}
            {label}
          </span>
          {desc && <span className="item-desc">{desc}</span>}
        </span>
        {shortcut && <span className="shortcut">{shortcut}</span>}
        {sub && <CaretRight weight="fill" size={14} />}
      </button>
      {sub && open && !disabled && <div className="context-menu submenu">{sub}</div>}
    </div>
  );
}

export function EditorContextMenu({ state, editor, onClose }: { state: MenuState; editor: Editor; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(state.x, window.innerWidth - r.width - 8), y: Math.min(state.y, window.innerHeight - r.height - 8) });
  }, [state]);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('mousedown', h);
      window.removeEventListener('keydown', k);
    };
  }, [onClose]);

  const { from, to } = editor.state.selection;
  const selText = docPlainText(editor.state.doc).slice(posToOffset(editor.state.doc, from), posToOffset(editor.state.doc, to));
  const scriptButtons = useScripts((x) => x.extensions).filter((e) => e.type === 'contextMenuButton');
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const ui = useUI.getState();
  const store = useStory.getState();

  const addTo = (target: 'memory' | 'authorsNote' | 'lore' | 'loreKey', generate?: string) => {
    store.update((s) => {
      if (target === 'memory') s.memory = s.memory ? `${s.memory}\n${selText}` : selText;
      else if (target === 'authorsNote') s.authorsNote = s.authorsNote ? `${s.authorsNote}\n${selText}` : selText;
      else {
        const name = selText.trim().slice(0, 40);
        const e =
          target === 'lore'
            ? newLoreEntry({ displayName: name, text: selText }, s.contextSettings.loreDefaults)
            : newLoreEntry({ displayName: name, keys: [selText.trim()] }, s.contextSettings.loreDefaults);
        s.lorebook = { ...s.lorebook, entries: [...s.lorebook.entries, e] };
        setTimeout(() => ui.open('lorebook', { entryId: e.id, generate }));
      }
    });
  };
  const addKeyTo = (entryId: string) => {
    store.update((s) => {
      s.lorebook = { ...s.lorebook, entries: s.lorebook.entries.map((e) => (e.id === entryId && !e.keys.includes(selText.trim()) ? { ...e, keys: [...e.keys, selText.trim()] } : e)) };
    });
    ui.toast(t('Key added.'), 'success');
  };
  const entries = store.current?.lorebook.entries ?? [];

  return createPortal(
    <div ref={ref} className="context-menu fade-in" style={{ left: pos.x, top: pos.y }} role="menu">
      <Item
        label={t('Cut')}
        shortcut={`${mod}+X`}
        disabled={!state.hasSelection}
        onClick={run(() => {
          void navigator.clipboard.writeText(selText);
          editor.chain().focus().deleteSelection().run();
        })}
      />
      <Item label={t('Copy')} shortcut={`${mod}+C`} disabled={!state.hasSelection} onClick={run(() => void navigator.clipboard.writeText(selText))} />
      <Item
        label={t('Paste')}
        shortcut={`${mod}+V`}
        onClick={run(async () => {
          try {
            const text = await navigator.clipboard.readText();
            editor.chain().focus().insertContent(text).run();
          } catch {
            ui.toast(t('Clipboard access denied. Use Ctrl+V instead.'), 'error');
          }
        })}
      />
      <Item
        label={t('Special Character')}
        sub={SPECIAL_CHARACTERS.map((c) => (
          <Item key={c.label} glyph={c.display ?? c.char} label={`(${t(c.label)})`} desc={c.desc && t(c.desc)} onClick={run(() => editor.chain().focus().insertContent(c.char).run())} />
        ))}
      />
      <div className="sep" />
      <Item label={t('Find')} shortcut={`${mod}+F`} onClick={run(() => ui.set({ findOpen: true }))} />
      <Item
        label={t('Add to…')}
        disabled={!state.hasSelection}
        sub={
          <>
            <Item label={t('Memory')} onClick={run(() => addTo('memory'))} />
            <Item label={t("Author's Note")} onClick={run(() => addTo('authorsNote'))} />
            <Item label={t('New Lore Entry as Text')} onClick={run(() => addTo('lore'))} />
            <Item label={t('New Lore Entry as Key')} onClick={run(() => addTo('loreKey'))} />
            <Item
              label={t('Key of Existing Entry')}
              disabled={!entries.length}
              sub={
                <div className="submenu-scroll">
                  {entries.map((e) => (
                    <Item key={e.id} label={e.displayName || t('Unnamed Entry')} onClick={run(() => addKeyTo(e.id))} />
                  ))}
                </div>
              }
            />
            <Item label={t('Chat as Excerpt')} onClick={run(() => chatAsExcerpt(selText))} />
          </>
        }
      />
      <Item
        label={t('Generate Lore...')}
        disabled={!state.hasSelection}
        sub={
          <>
            {LORE_GEN_TYPES.map((type) => (
              <Item key={type} label={t('Generate {type} Lore', { type: t(type) })} onClick={run(() => addTo('loreKey', type))} />
            ))}
          </>
        }
      />
      <Item label={t('Generate Inline')} shortcut={`${mod}+⇧+⏎`} onClick={run(() => void store.generateInline())} />
      <Item label={t("Writer's Toolbox")} onClick={run(() => ui.open('toolbox', { text: selText, from: posToOffset(editor.state.doc, from), to: posToOffset(editor.state.doc, to) }))} />
      {scriptButtons.length > 0 && (
        <Item
          label={t('User Scripts')}
          sub={
            <div className="submenu-scroll">
              {scriptButtons.map((b) => (
                <Item
                  key={b.key}
                  label={b.label ?? b.id}
                  desc={b.scriptName}
                  onClick={run(() => void invoke(b.scriptKey, b.onClick, { text: selText, from: posToOffset(editor.state.doc, from), to: posToOffset(editor.state.doc, to) }))}
                />
              ))}
            </div>
          }
        />
      )}
      <div className="sep" />
      <Item label={t('Tokenize')} disabled={!state.hasSelection} onClick={run(() => ui.open('tokenize', { text: selText }))} />
      <Item label={t('Screenshot')} disabled={!state.hasSelection} onClick={run(() => ui.open('screenshot', { from: posToOffset(editor.state.doc, from), to: posToOffset(editor.state.doc, to) }))} />
      <Item
        label={t('Speak with TTS')}
        sub={
          <>
            <Item label={t('Speak')} onClick={run(() => speak(selText || docPlainText(editor.state.doc).slice(-2000)))} />
            <Item label={t('Stop Speaking')} onClick={run(stopSpeaking)} />
            {useSettings.getState().ttsSource === 'endpoint' && (
              <Item
                label={t('Download Spoken')}
                onClick={run(() => void downloadSpeech(selText || docPlainText(editor.state.doc).slice(-2000), 'story').catch((e) => ui.toast((e as Error).message, 'error')))}
              />
            )}
          </>
        }
      />
      <div className="hint">{t('Hint: Ctrl + Right-Click to open the regular browser context menu.')}</div>
    </div>,
    document.body,
  );
}
