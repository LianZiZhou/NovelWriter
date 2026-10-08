import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, ArrowUUpLeft, ArrowUUpRight, Book, CaretRight, ChatCircle, DiceFive, PersonSimpleRun, Plus, TextAlignLeft, TreeStructure, X } from '@phosphor-icons/react';
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

/** Redo list: replaces the tip bar above the controls, one row per branch you can step into. */
function RedoStrip({ options, onClose }: { options: HistoryNode[]; onClose: () => void }) {
  const story = useStory((s) => s.current)!;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.branch-count') && onClose();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('mousedown', h);
      window.removeEventListener('keydown', k);
    };
  }, [onClose]);
  const cur = story.history.current;
  return (
    <div ref={ref} className="redo-strip fade-in" role="listbox" aria-label={t('Redo options')}>
      {options.map((n) => {
        const text = n.changes.map((c) => c.inserted.map((s) => s.text).join('')).join('').trim();
        const line = text.split('\n').find((l) => l.trim()) ?? '';
        return (
          <button
            type="button"
            role="option"
            aria-selected={n.id === cur}
            key={n.id}
            className={`redo-row ${n.id === cur ? 'current' : ''}`}
            title={text}
            onClick={() => {
              useStory.getState().jump(n.id);
              onClose();
            }}
          >
            <Plus size={14} weight="bold" />
            <span className="redo-text">{line || '—'}</span>
          </button>
        );
      })}
      {options.length === 0 && <div className="redo-row muted">{t('Nothing to redo.')}</div>}
      <button
        type="button"
        className="redo-tree"
        aria-label={t('History Tree')}
        title={t('History Tree')}
        onClick={() => {
          onClose();
          useUI.getState().open('historyTree');
        }}
      >
        <TreeStructure size={16} />
      </button>
    </div>
  );
}

const ADV_MODES: { id: AdventureInputMode; label: string; placeholder: string }[] = [
  { id: 'do', label: 'DO', placeholder: 'What do you want to do?' },
  { id: 'say', label: 'SAY', placeholder: 'What do you want to say?' },
  { id: 'story', label: 'STORY', placeholder: 'What happens next?' },
];

/** Two-row adventure input: mode icon + text field on top, DO/SAY/STORY tabs and controls below. */
function AdventureBar({ mode, setMode, text, setText, onSend, controls }: { mode: AdventureInputMode; setMode: (m: AdventureInputMode) => void; text: string; setText: (v: string) => void; onSend: () => void; controls: React.ReactNode }) {
  const icon = mode === 'do' ? <PersonSimpleRun size={18} weight="bold" /> : mode === 'say' ? <ChatCircle size={18} weight="fill" /> : <TextAlignLeft size={18} weight="bold" />;
  const ph = t(ADV_MODES.find((m) => m.id === mode)!.placeholder);
  return (
    <div className="adventure-bar">
      <div className="adv-input-row">
        <span className="adv-mode-icon" aria-hidden="true">{icon}</span>
        <input
          value={text}
          placeholder={ph}
          aria-label={ph}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            } else if (e.key === 'Tab' && !e.shiftKey && !text) {
              e.preventDefault();
              const i = ADV_MODES.findIndex((m) => m.id === mode);
              setMode(ADV_MODES[(i + 1) % ADV_MODES.length].id);
            }
          }}
        />
      </div>
      <div className="adv-controls">
        <div className="adv-modes" role="tablist">
          {ADV_MODES.map((m) => (
            <button type="button" role="tab" key={m.id} aria-selected={mode === m.id} className={mode === m.id ? 'active' : ''} aria-label={`Switch to ${m.label} mode`} onClick={() => setMode(m.id)}>
              {t(m.label)}
            </button>
          ))}
        </div>
        <span className="adv-sep" />
        <button type="button" className="ctrl-btn" aria-label={t('Lorebook')} title={t('Lorebook')} onClick={() => useUI.getState().open('lorebook')}>
          <Book size={18} weight="fill" />
        </button>
        <div className="grow" />
        {controls}
      </div>
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
  // Children of the current step are what Redo can reach; on an AI step the siblings are the retries.
  const branchOptions = redoCount > 0 ? cur.children.map((c) => h.nodes[c]) : cur.type === 'ai' ? options : [];

  const doSend = () => {
    if (generating) return store.stop();
    void store.send(input.trim() ? { text: input, mode: advMode } : undefined);
    setInput('');
  };

  const controls = (
    <>
      <button type="button" className="ctrl-btn" aria-label={t('Undo')} title={`${t('Undo')} (Ctrl+Z)`} disabled={!canUndo(h) || generating} onClick={() => store.undo()}>
        <ArrowUUpLeft size={20} weight="bold" />
      </button>
      <button type="button" className="ctrl-btn" aria-label={t('Redo')} title={`${t('Redo')} (Ctrl+Y)`} disabled={!canRedo(h) || generating} onClick={() => store.redo()}>
        <ArrowUUpRight size={20} weight="bold" />
      </button>
      <button type="button" className={`branch-count ${options.length > 1 || redoCount > 0 ? 'has' : ''}`} aria-label={t('History')} title={t('History')} onClick={() => setBranchOpen(!branchOpen)}>
        {redoCount > 0 && <span className="redo-marker" aria-hidden="true" />}
        {cur.type === 'ai' ? options.length : redoCount}
      </button>
      <button type="button" className="ctrl-btn" aria-label={t('Retry')} title={`${t('Retry')} (Alt+R)`} disabled={generating || (cur.type !== 'ai' && isEmpty)} onClick={() => void store.retry()}>
        <ArrowClockwise size={20} weight="bold" />
      </button>
    </>
  );

  return (
    <>
      <div className={`editor-scroll ${adventure ? 'adventure' : ''}`}>
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
          {branchOpen ? <RedoStrip options={branchOptions} onClose={() => setBranchOpen(false)} /> : <TipBar />}
          <div className={`control-row ${adventure ? 'adventure' : ''}`}>
            {adventure ? (
              <AdventureBar mode={advMode} setMode={setAdvMode} text={input} setText={setInput} onSend={doSend} controls={controls} />
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
                {controls}
              </div>
            )}
            <button type="button" className={`send-btn ${generating && task === 'story' ? 'stop' : ''}`} aria-label={generating ? t('Stop') : t('Send')} onClick={doSend}>
              {generating && task === 'story' ? (
                <>
                  <span className="spinner" /> {!adventure && t('Stop')}
                </>
              ) : (
                <>
                  {!adventure && t('Send')} <CaretRight size={18} weight={adventure ? 'bold' : 'fill'} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
