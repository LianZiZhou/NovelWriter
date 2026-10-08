import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, ArrowUUpLeft, ArrowUUpRight, Book, CaretRight, ChatCircle, DiceFive, Sword, TextAlignLeft, TreeStructure, X } from '@phosphor-icons/react';
import { canRedo, canUndo, docText, retryOptions, type AdventureInputMode, type HistoryNode } from '@novelwriter/core';
import { useStory } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { StoryEditor } from './StoryEditor.tsx';
import { Hypebot } from '../hypebot/Hypebot.tsx';

const TIPS: [string, string][] = [
  ['Context Management', 'Because the AI only has so much Context it can see, remember not to give it too many details at once. Lean on the Lorebook for details that only matter sometimes.'],
  ['Up to Date', 'Models know recent events, popular fiction and even celebrities. Specifics may need further prompting, so add them to Memory or the Lorebook.'],
  ['Lorebook Import', 'You can easily import Lorebooks by using the Import File button or dragging a .lorebook, .json or .png file onto the window.'],
  ['Shelves', 'Stories can be stored within Shelves in the Story Library in the left sidebar. Use the Pencil icon on a story to move it to a shelf.'],
  ['Generate Inline', 'If you want to generate text to fill in a specific part of the story you can right click and select "Generate Inline", or press Ctrl+Shift+Enter.'],
  ['Retry', 'Not happy with a generation? Press Retry (Alt+R) for a new one. Earlier generations stay available in the branch menu next to Redo.'],
  ["Author's Note", "The Author's Note is inserted near the end of the context, so a few short sentences there strongly steer the style and direction of the story."],
  ['Command Palette', 'Press Ctrl+K to open the command palette and reach any action quickly.'],
];

function TipBar() {
  const showTips = useSettings((s) => s.showTips);
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % TIPS.length), 45000);
    return () => clearInterval(id);
  }, []);
  if (!showTips || hidden) return null;
  const [title, body] = TIPS[idx];
  return (
    <div className="tip-bar">
      <span className="tip-text" title={t(body)}>
        <b>{t(title)}:</b> {t(body)}
      </span>
      <button type="button" className="icon-btn" onClick={() => setHidden(true)} aria-label={t('Close')}>
        <X size={14} weight="bold" style={{ opacity: 0.6 }} />
      </button>
    </div>
  );
}

function BranchPopover({ options, onClose }: { options: HistoryNode[]; onClose: () => void }) {
  const story = useStory((s) => s.current)!;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [onClose]);
  const cur = story.history.current;
  return (
    <div ref={ref} className="popover fade-in" style={{ bottom: 58, right: 0, width: 420, maxHeight: 360, overflowY: 'auto', padding: 6 }}>
      <div className="row between" style={{ padding: '6px 8px' }}>
        <span className="sub-heading">{t('Retry options')}</span>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            onClose();
            useUI.getState().open('historyTree');
          }}
        >
          <TreeStructure size={14} /> {t('History Tree')}
        </button>
      </div>
      {options.length === 0 && <div className="muted" style={{ padding: 8, fontSize: 14 }}>—</div>}
      {options.map((n, i) => {
        const text = n.changes.map((c) => c.inserted.map((s) => s.text).join('')).join('');
        return (
          <button
            type="button"
            key={n.id}
            className="select-option"
            style={{ background: n.id === cur ? 'var(--bg3)' : undefined, borderBottom: '1px solid var(--bg2)' }}
            onClick={() => {
              useStory.getState().jump(n.id);
              onClose();
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.6 }}>#{i + 1} · {new Date(n.time).toLocaleTimeString()}</div>
            <div style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{text.trim() || '—'}</div>
          </button>
        );
      })}
    </div>
  );
}

function AdventureBar({ mode, setMode, text, setText, onSend }: { mode: AdventureInputMode; setMode: (m: AdventureInputMode) => void; text: string; setText: (v: string) => void; onSend: () => void }) {
  const order: AdventureInputMode[] = ['do', 'say', 'story'];
  const icon = mode === 'do' ? <Sword size={16} /> : mode === 'say' ? <ChatCircle size={16} /> : <TextAlignLeft size={16} />;
  const label = mode === 'do' ? t('Do') : mode === 'say' ? t('Say') : t('Story');
  const ph = mode === 'do' ? t('What do you do?') : mode === 'say' ? t('What do you say?') : t('What happens next?');
  return (
    <div className="adventure-bar">
      <button type="button" className="mode-btn" onClick={() => setMode(order[(order.indexOf(mode) + 1) % 3])} aria-label={`Input mode: ${label}`}>
        {icon} {label}
      </button>
      <input
        value={text}
        placeholder={ph}
        aria-label={ph}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
      />
    </div>
  );
}

export function EditorPane() {
  const story = useStory((s) => s.current)!;
  const generating = useStory((s) => s.generating);
  const task = useStory((s) => s.task);
  const inputBox = useSettings((s) => s.inputBox);
  const [branchOpen, setBranchOpen] = useState(false);
  const [input, setInput] = useState('');
  const [advMode, setAdvMode] = useState<AdventureInputMode>('do');
  const store = useStory.getState();
  const h = story.history;
  const options = retryOptions(h);
  const cur = h.nodes[h.current];
  const redoCount = cur.children.length;
  const adventure = story.mode === 'adventure';
  const isEmpty = docText(story.doc).length === 0;

  const doSend = () => {
    if (generating) return store.stop();
    void store.send(input.trim() ? { text: input, mode: advMode } : undefined);
    setInput('');
  };

  return (
    <>
      <div className="editor-scroll">
        <div className="editor-column">
          <div className="editor-title-row">
            <input
              className="editor-title"
              value={story.title}
              aria-label={t('Title')}
              onChange={(e) => store.update((s) => void (s.title = e.target.value))}
            />
            <button type="button" className="title-btn" onClick={() => void store.generateTitle()} aria-label={t('Generate a random title for the story')} title={t('Generate a random title for the story')} disabled={task === 'title'}>
              {task === 'title' ? <span className="spinner" /> : <DiceFive size={20} weight="fill" />}
            </button>
          </div>
          <StoryEditor />
        </div>
      </div>
      <Hypebot />
      <div className="bottom-area">
        <div className="bottom-inner">
          <TipBar />
          <div className="control-row">
            {adventure ? (
              <AdventureBar mode={advMode} setMode={setAdvMode} text={input} setText={setInput} onSend={doSend} />
            ) : (
              <div className="control-bar">
                <button type="button" className="ctrl-btn" aria-label={t('Lorebook')} title={t('Lorebook')} onClick={() => useUI.getState().open('lorebook')}>
                  <Book size={20} weight="fill" />
                </button>
                {inputBox ? (
                  <input
                    className="input-box"
                    value={input}
                    placeholder={isEmpty ? t('Enter your prompt here...') : t('What happens next?')}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        doSend();
                      }
                    }}
                  />
                ) : (
                  <div className="grow" />
                )}
                <button type="button" className="ctrl-btn" aria-label={t('Undo')} title={`${t('Undo')} (Ctrl+Z)`} disabled={!canUndo(h) || generating} onClick={() => store.undo()}>
                  <ArrowUUpLeft size={20} weight="bold" />
                </button>
                <button type="button" className="ctrl-btn" aria-label={t('Redo')} title={`${t('Redo')} (Ctrl+Y)`} disabled={!canRedo(h) || generating} onClick={() => store.redo()}>
                  <ArrowUUpRight size={20} weight="bold" />
                </button>
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className={`branch-count ${options.length > 1 || redoCount > 0 ? 'has' : ''}`}
                    aria-label={t('History')}
                    title={t('History')}
                    onClick={() => setBranchOpen(!branchOpen)}
                  >
                    {cur.type === 'ai' ? options.length : redoCount}
                  </button>
                  {branchOpen && <BranchPopover options={cur.type === 'ai' ? options : cur.children.map((c) => h.nodes[c])} onClose={() => setBranchOpen(false)} />}
                </div>
                <button type="button" className="ctrl-btn" aria-label={t('Retry')} title={`${t('Retry')} (Alt+R)`} disabled={generating || (cur.type !== 'ai' && isEmpty)} onClick={() => void store.retry()}>
                  <ArrowClockwise size={20} weight="bold" />
                </button>
              </div>
            )}
            {adventure && (
              <div className="control-bar" style={{ flex: 'none', width: 'auto' }}>
                <button type="button" className="ctrl-btn" aria-label={t('Undo')} disabled={!canUndo(h) || generating} onClick={() => store.undo()}>
                  <ArrowUUpLeft size={20} weight="bold" />
                </button>
                <button type="button" className="ctrl-btn" aria-label={t('Redo')} disabled={!canRedo(h) || generating} onClick={() => store.redo()}>
                  <ArrowUUpRight size={20} weight="bold" />
                </button>
                <button type="button" className="ctrl-btn" aria-label={t('Retry')} disabled={generating} onClick={() => void store.retry()}>
                  <ArrowClockwise size={20} weight="bold" />
                </button>
              </div>
            )}
            <button type="button" className={`send-btn ${generating && task === 'story' ? 'stop' : ''}`} aria-label={generating ? t('Stop') : t('Send')} onClick={doSend}>
              {generating && task === 'story' ? (
                <>
                  <span className="spinner" /> {t('Stop')}
                </>
              ) : (
                <>
                  {t('Send')} <CaretRight size={18} weight="fill" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
