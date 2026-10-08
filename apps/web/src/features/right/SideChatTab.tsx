import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { ArrowUp, BookOpen, ChatCircleText, Plus, Quotes, Stop, TextAa, Trash, X } from '@phosphor-icons/react';
import { buildSideChatRequest, docText, uid, type SideChat, type SideChatMessage } from '@novelwriter/core';
import { generateText } from '../../api.ts';
import { useStory, useStoryMeta } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Select } from '../../components/ui.tsx';

type Excerpt = NonNullable<SideChatMessage['excerpt']>;

/** Excerpt waiting to be sent with the next chat message (set from the editor's context menu). */
export const useChatDraft = create<{ excerpt: Excerpt | null; set: (e: Excerpt | null) => void }>((set) => ({ excerpt: null, set: (excerpt) => set({ excerpt }) }));

/** Open the Side Chat with an excerpt attached ("Chat as Excerpt"). */
export function chatAsExcerpt(text: string, label = t('Selection')) {
  useChatDraft.getState().set({ label, text });
  useSettings.getState().set({ rightTab: 'chat', rightOpen: true });
  useUI.getState().set({ mobileRight: true });
}

const RECENT_CHARS = 3000;
const recentStory = () => docText(useStory.getState().current?.doc ?? []).slice(-RECENT_CHARS).trim();

export function SideChatTab() {
  const story = useStoryMeta()!;
  const store = useStory.getState();
  const excerpt = useChatDraft((s) => s.excerpt);
  const setExcerpt = useChatDraft((s) => s.set);
  const [activeId, setActiveId] = useState<string | null>(story.chats[0]?.id ?? null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const chat = story.chats.find((c) => c.id === activeId) ?? story.chats[0] ?? null;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat?.messages.length, streaming]);
  useEffect(() => () => abort.current?.abort(), []);

  const newChat = (): string => {
    const id = uid();
    store.update((s) => void s.chats.unshift({ id, title: t('New Chat'), createdAt: Date.now(), messages: [] }));
    setActiveId(id);
    return id;
  };
  const editChat = (id: string, fn: (c: SideChat) => void) => store.update((s) => {
    const c = s.chats.find((x) => x.id === id);
    if (c) fn(c);
  });

  const send = async (text: string, ex: Excerpt | null) => {
    const model = store.resolveModel();
    if (!model) return useUI.getState().toast(t('Select an AI Model'), 'error');
    if (!text.trim() && !ex) return;
    const id = chat?.id ?? newChat();
    const msg: SideChatMessage = { role: 'user', content: text.trim(), ...(ex ? { excerpt: ex } : {}) };
    editChat(id, (c) => {
      c.messages.push(msg);
      if (c.messages.length === 1) c.title = (text.trim() || ex?.label || t('New Chat')).slice(0, 40);
    });
    setInput('');
    setExcerpt(null);
    const current = useStory.getState().current!;
    const req = buildSideChatRequest(current, current.chats.find((c) => c.id === id)!);
    abort.current = new AbortController();
    setStreaming('');
    try {
      const reply = await generateText({ model, ...req, maxTokens: 800, params: { temperature: 0.8 } }, abort.current.signal, (all) => setStreaming(all));
      editChat(id, (c) => void c.messages.push({ role: 'assistant', content: reply.trim() }));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') useUI.getState().toast((e as Error).message, 'error');
      else setStreaming((partial) => {
        if (partial) editChat(id, (c) => void c.messages.push({ role: 'assistant', content: partial.trim() }));
        return null;
      });
    } finally {
      setStreaming(null);
      abort.current = null;
    }
  };

  const addExcerpt = (kind: 'recent' | 'selection' | 'lore', loreId?: string) => {
    setMenu(false);
    if (kind === 'recent') return setExcerpt({ label: t('Recent Story'), text: recentStory() });
    if (kind === 'selection') {
      const sel = store.editor?.getSelection();
      if (!sel?.text) return useUI.getState().toast(t('Select some text in the story first.'));
      return setExcerpt({ label: t('Selection'), text: sel.text });
    }
    const e = story.lorebook.entries.find((x) => x.id === loreId);
    if (e) setExcerpt({ label: `${t('Lorebook')}: ${e.displayName || t('Unnamed Entry')}`, text: e.text });
  };

  return (
    <div className="side-chat">
      <div className="side-chat-head">
        {story.chats.length > 0 ? (
          <Select
            value={chat?.id ?? ''}
            onChange={setActiveId}
            ariaLabel={t('Chats')}
            options={story.chats.map((c) => ({ value: c.id, label: c.title }))}
          />
        ) : (
          <span className="grow side-chat-title">{t('Side Chat')}</span>
        )}
        <button type="button" className="icon-btn" aria-label={t('New Chat')} title={t('New Chat')} onClick={newChat}>
          <Plus size={18} weight="bold" />
        </button>
        {chat && (
          <button
            type="button"
            className="icon-btn"
            aria-label={t('Delete Chat')}
            title={t('Delete Chat')}
            onClick={async () => {
              if (!(await useUI.getState().confirm({ title: t('Delete Chat?'), message: chat.title, confirmLabel: t('Delete'), danger: true }))) return;
              store.update((s) => void (s.chats = s.chats.filter((c) => c.id !== chat.id)));
              setActiveId(null);
            }}
          >
            <Trash size={18} />
          </button>
        )}
      </div>
      <div className="side-chat-list" ref={listRef} aria-live="polite">
        {!chat?.messages.length && streaming === null && (
          <div className="side-chat-empty">
            <ChatCircleText size={40} weight="thin" />
            <p>{t('Chat with the AI about your story: ask questions, brainstorm, or get feedback. Nothing here is added to the story.')}</p>
            <button type="button" className="btn" onClick={() => void send(t('What do you think of the story so far? What could happen next?'), { label: t('Recent Story'), text: recentStory() })} disabled={!recentStory()}>
              {t('Chat About the Recent Story')}
            </button>
          </div>
        )}
        {chat?.messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.excerpt && (
              <blockquote className="chat-excerpt">
                <span className="chat-excerpt-label">{m.excerpt.label}</span>
                {m.excerpt.text.length > 400 ? `…${m.excerpt.text.slice(-400)}` : m.excerpt.text}
              </blockquote>
            )}
            {m.content && <div className="chat-text">{m.content}</div>}
          </div>
        ))}
        {streaming !== null && (
          <div className="chat-msg assistant">
            <div className="chat-text">{streaming || <span className="spinner" />}</div>
          </div>
        )}
      </div>
      <div className="side-chat-input">
        {excerpt && (
          <div className="chat-draft-excerpt">
            <Quotes size={14} weight="fill" />
            <span className="grow">{excerpt.label}: {excerpt.text.slice(0, 80)}{excerpt.text.length > 80 ? '…' : ''}</span>
            <button type="button" className="icon-btn" aria-label={t('Remove Excerpt')} onClick={() => setExcerpt(null)}>
              <X size={14} />
            </button>
          </div>
        )}
        <textarea
          value={input}
          placeholder={t('Message')}
          aria-label={t('Chat message')}
          rows={3}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && streaming === null) {
              e.preventDefault();
              void send(input, excerpt);
            }
          }}
        />
        <div className="row between side-chat-actions">
          <div className="excerpt-menu">
            <button type="button" className="btn small" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              <Quotes size={14} /> {t('Add Excerpt')}
            </button>
            {menu && (
              <div className="excerpt-pop" role="menu">
                <button type="button" className="item" role="menuitem" onClick={() => addExcerpt('recent')}>
                  <BookOpen size={14} /> {t('Recent Story')}
                </button>
                <button type="button" className="item" role="menuitem" onClick={() => addExcerpt('selection')}>
                  <TextAa size={14} /> {t('Selection')}
                </button>
                {story.lorebook.entries.slice(0, 30).map((e) => (
                  <button type="button" className="item" role="menuitem" key={e.id} onClick={() => addExcerpt('lore', e.id)}>
                    {t('Lorebook')}: {e.displayName || t('Unnamed Entry')}
                  </button>
                ))}
              </div>
            )}
          </div>
          {streaming !== null ? (
            <button type="button" className="btn small" aria-label={t('Stop')} onClick={() => abort.current?.abort()}>
              <Stop size={14} weight="fill" />
            </button>
          ) : (
            <button type="button" className="btn small primary" aria-label={t('Send')} onClick={() => void send(input, excerpt)} disabled={!input.trim() && !excerpt}>
              <ArrowUp size={14} weight="bold" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
