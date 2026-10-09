import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowArcLeft,
  ArrowCounterClockwise,
  ArrowUp,
  CheckCircle,
  Circle,
  CircleNotch,
  FilmSlate,
  GearSix,
  Pause,
  Play,
  Plus,
  Question,
  Stop,
  Trash,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { ACTION_CATEGORIES, BOOK_PHASES, BOOK_BUDGET, DEFAULT_BUDGET, DEFAULT_TRUST, type ActionCategory, type DirectorRun, type LogEntry, type RunMode, type TrustLevel } from '@novelwriter/core';
import { useStory, useStoryMeta } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';
import { checkpointLabel, directorModel, runsOf, useDirector, type Pending } from '../../store/director.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Collapsible, NumberField, SegmentedControl, Select, timeAgo } from '../../components/ui.tsx';
import { ModelSelect } from '../right/ModelSelect.tsx';

const TOOL_LABELS: Record<string, string> = {
  story_overview: 'Looked at the story',
  read_story: 'Read the story',
  get_context_report: 'Checked the context',
  search_lore: 'Searched the lorebook',
  critique: 'Critique',
  write_passage: 'Wrote a passage',
  rewrite_range: 'Rewrote text',
  insert_text: 'Inserted text',
  start_chapter: 'Started a chapter',
  set_story_info: 'Set story info',
  update_memory: 'Updated memory',
  set_authors_note: "Set the Author's Note",
  upsert_lore_entry: 'Lorebook entry',
  delete_lore_entry: 'Deleted a lorebook entry',
  summarize: 'Updated the summary',
  update_outline: 'Set the outline',
  update_plan: 'Updated the plan',
  set_chapter_status: 'Chapter status',
  set_phase: 'Next phase',
  ask_user: 'Asked you',
  finish: 'Finished',
};

const CATEGORY_LABELS: Record<ActionCategory, string> = {
  prose: 'Write passages',
  rewrite: 'Rewrite or insert text',
  memory: 'Memory and summary',
  authorsNote: "Author's Note",
  lore: 'Create or edit lorebook entries',
  loreDelete: 'Delete lorebook entries',
  outline: 'Outline',
  structure: 'Chapter headings and story info',
};

const STATUS_LABELS: Record<DirectorRun['status'], string> = {
  running: 'Running',
  paused: 'Paused',
  waiting: 'Waiting for you',
  done: 'Finished',
  stopped: 'Stopped',
  error: 'Error',
};

const EXAMPLES: Record<RunMode, string[]> = {
  loop: ['Write the next scene: the protagonist arrives in town and meets someone who knows their secret.', 'Finish this chapter, then tidy up the lorebook and memory.', 'Keep the story going for about 5000 characters, raising the tension.'],
  book: ['A cosy mystery novella: a retired lighthouse keeper solves a disappearance in a fishing village. About 8 chapters.', 'A xianxia novel about a disciple who can see the threads of fate. Start with the first three chapters.'],
};

export function DirectorTab() {
  const story = useStoryMeta()!;
  const runs = runsOf(story);
  const activeRunId = useDirector((s) => s.activeRunId);
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [settings, setSettings] = useState(false);
  const run = composing ? null : (runs.find((r) => r.id === (activeRunId ?? selected)) ?? runs[0] ?? null);

  useEffect(() => {
    if (activeRunId) {
      setComposing(false);
      setSelected(activeRunId);
    }
  }, [activeRunId]);

  return (
    <div className="director">
      <div className="director-head">
        <FilmSlate size={18} weight="fill" />
        {runs.length > 0 && !composing ? (
          <Select
            value={run?.id ?? ''}
            ariaLabel={t('Director runs')}
            onChange={(id) => setSelected(id)}
            options={runs.map((r) => ({ value: r.id, label: r.goal.slice(0, 60), description: `${t(STATUS_LABELS[r.status])} · ${timeAgo(r.updatedAt)}` }))}
          />
        ) : (
          <span className="grow director-title">{t('Director')}</span>
        )}
        <button type="button" className="icon-btn" aria-label={t('New Run')} title={t('New Run')} disabled={!!activeRunId} onClick={() => setComposing(true)}>
          <Plus size={18} weight="bold" />
        </button>
        <button type="button" className={`icon-btn ${settings ? 'on' : ''}`} aria-label={t('Director Settings')} title={t('Director Settings')} aria-pressed={settings} onClick={() => setSettings(!settings)}>
          <GearSix size={18} />
        </button>
      </div>
      <div className="director-body">
        {settings && <DirectorSettings />}
        {run ? <RunView run={run} /> : <NewRun onStarted={() => setComposing(false)} onCancel={runs.length ? () => setComposing(false) : undefined} />}
      </div>
      {run && <Controls run={run} onNew={() => setComposing(true)} />}
    </div>
  );
}

function NewRun({ onStarted, onCancel }: { onStarted: () => void; onCancel?: () => void }) {
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<RunMode>('loop');
  const base = mode === 'book' ? BOOK_BUDGET : DEFAULT_BUDGET;
  const [passages, setPassages] = useState<number | null>(null);
  const [chars, setChars] = useState<number | null>(null);
  const empty = !docTextLength();
  const start = () => {
    if (!goal.trim()) return;
    onStarted();
    void useDirector.getState().start(goal, mode, { ...(passages ? { maxPassages: passages } : {}), ...(chars ? { maxChars: chars } : {}) });
  };
  return (
    <div className="panel-section director-new">
      <div className="desc">
        {t('Tell the Director what you want. It plans, has the writing model write passage by passage, and keeps memory, the lorebook and the author\'s note up to date on its own. You can pause, step in or undo at any time.')}
      </div>
      <SegmentedControl
        value={mode}
        onChange={setMode}
        options={[
          { value: 'loop', label: t('Writing Session') },
          { value: 'book', label: t('Whole Book') },
        ]}
      />
      <div className="desc">{mode === 'book' ? t('From one idea to a book: premise, world, characters, outline, then chapter after chapter, and a final review.') : t('Continue this story toward a goal: a scene, a chapter, a length.')}</div>
      <textarea
        className="director-goal"
        value={goal}
        rows={4}
        placeholder={mode === 'book' ? t('Your idea for the book…') : t('What should happen next?')}
        aria-label={t('Goal')}
        onChange={(e) => setGoal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start();
        }}
      />
      <div className="director-examples">
        {EXAMPLES[mode].map((x) => (
          <button key={x} type="button" className="director-chip" onClick={() => setGoal(t(x))}>
            {t(x)}
          </button>
        ))}
      </div>
      {mode === 'book' && !empty && <div className="warning-text">{t('This story already has text. A whole-book run builds on it; start a new story for a fresh book.')}</div>}
      <Collapsible title={t('Budget')} defaultOpen={false}>
        <NumberField label={t('Passages at most')} value={passages ?? base.maxPassages} min={1} max={2000} onChange={setPassages} />
        <NumberField label={t('New characters at most')} value={chars ?? base.maxChars} min={500} max={5000000} step={1000} onChange={setChars} />
      </Collapsible>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            {t('Cancel')}
          </button>
        )}
        <button type="button" className="btn primary director-start" disabled={!goal.trim()} onClick={start}>
          <Play size={16} weight="fill" /> {t('Start')}
        </button>
      </div>
    </div>
  );
}

const docTextLength = () => (useStory.getState().current?.doc ?? []).reduce((n, s) => n + s.text.length, 0);

function DirectorSettings() {
  const story = useStoryMeta()!;
  const pick = useSettings((s) => s.directorModel);
  const appTrust = useSettings((s) => s.directorTrust);
  const [scope, setScope] = useState<'app' | 'story'>(story.director?.trust && Object.keys(story.director.trust).length ? 'story' : 'app');
  const storyTrust = story.director?.trust ?? {};
  const levelFor = (c: ActionCategory): TrustLevel => (scope === 'story' ? storyTrust[c] : undefined) ?? appTrust[c] ?? DEFAULT_TRUST[c];
  const setLevel = (c: ActionCategory, v: TrustLevel) => {
    if (scope === 'app') useSettings.getState().set({ directorTrust: { ...appTrust, [c]: v } });
    else useStory.getState().update((s) => void (s.director = { runs: s.director?.runs ?? [], trust: { ...s.director?.trust, [c]: v } }));
  };
  const resolved = directorModel();
  return (
    <div className="panel-section director-settings">
      <span className="heading">{t('Director Model')}</span>
      <div className="desc">{t('Plans and steers the run. A strong model with tool calling works best; passages are still written by the story\'s own model.')}</div>
      <ModelSelect value={pick ?? resolved} onChange={(m) => useSettings.getState().set({ directorModel: m })} />
      {pick && (
        <button type="button" className="link-btn" onClick={() => useSettings.getState().set({ directorModel: null })}>
          {t('Use the story\'s model')}
        </button>
      )}
      <span className="heading" style={{ marginTop: 16 }}>
        {t('What the Director may do')}
      </span>
      <div className="desc">{t('Automatic changes can always be undone from the activity list.')}</div>
      <SegmentedControl
        value={scope}
        onChange={setScope}
        options={[
          { value: 'app', label: t('All Stories') },
          { value: 'story', label: t('This Story') },
        ]}
      />
      <div className="director-trust">
        {ACTION_CATEGORIES.map((c) => (
          <div key={c} className="director-trust-row">
            <span>{t(CATEGORY_LABELS[c])}</span>
            <Select<TrustLevel>
              value={levelFor(c)}
              ariaLabel={t(CATEGORY_LABELS[c])}
              onChange={(v) => setLevel(c, v)}
              options={[
                { value: 'auto', label: t('Automatic') },
                { value: 'confirm', label: t('Ask First') },
                { value: 'deny', label: t('Never') },
              ]}
            />
          </div>
        ))}
      </div>
      {scope === 'story' && Object.keys(storyTrust).length > 0 && (
        <button type="button" className="link-btn" onClick={() => useStory.getState().update((s) => void (s.director = { runs: s.director?.runs ?? [], trust: {} }))}>
          {t('Use the settings for all stories')}
        </button>
      )}
    </div>
  );
}

function RunView({ run }: { run: DirectorRun }) {
  const active = useDirector((s) => s.activeRunId === run.id);
  const thinking = useDirector((s) => (s.activeRunId === run.id ? s.thinking : ''));
  const pending = useDirector((s) => (s.pending?.runId === run.id ? s.pending : null));
  const generating = useStory((s) => s.generating);
  const listRef = useRef<HTMLDivElement>(null);
  // Follow the activity while the run is going, unless the author scrolled up to read.
  useEffect(() => {
    const el = listRef.current?.closest('.director-body');
    if (el && active && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTo({ top: el.scrollHeight });
  }, [run.log.length, thinking, pending, active]);
  const outline = useStoryMeta()?.outline;
  const checkpointsAt = useMemo(() => new Map(run.checkpoints.map((c) => [c.logIndex, c])), [run.checkpoints]);
  const { budget: b, spent: s } = run;
  const phaseIdx = BOOK_PHASES.findIndex((p) => p.phase === run.phase);

  return (
    <div className="director-run" ref={listRef}>
      <div className="panel-section director-summary">
        <div className="director-goal-text">{run.goal}</div>
        <div className="director-status">
          <StatusBadge status={run.status} active={active} />
          <span className="desc">
            {t('{p}/{pm} passages · {c}/{cm} characters · {turns} turns', { p: s.passages, pm: b.maxPassages, c: s.chars, cm: b.maxChars, turns: s.turns })}
          </span>
        </div>
        {run.mode === 'book' && (
          <ol className="director-phases">
            {BOOK_PHASES.map((p, i) => (
              <li key={p.phase} className={i < phaseIdx ? 'done' : i === phaseIdx ? 'active' : ''}>
                {t(p.title)}
              </li>
            ))}
          </ol>
        )}
        {run.result && !active && <div className={`director-result ${run.status === 'error' ? 'warning-text' : ''}`}>{run.result}</div>}
      </div>

      {run.plan.length > 0 && (
        <div className="panel-section">
          <span className="heading">{t('Plan')}</span>
          <ul className="director-plan">
            {run.plan.map((p) => (
              <li key={p.id} className={p.status}>
                {p.status === 'done' ? <CheckCircle size={16} weight="fill" /> : p.status === 'active' ? <CircleNotch size={16} className={active ? 'spin' : ''} /> : p.status === 'skipped' ? <XCircle size={16} /> : <Circle size={16} />}
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {outline && outline.chapters.length > 0 && (
        <div className="panel-section">
          <Collapsible title={t('Outline ({n} chapters)', { n: outline.chapters.length })} defaultOpen={run.mode === 'book'}>
            <ol className="director-chapters">
              {outline.chapters.map((c) => (
                <li key={c.id} className={c.status}>
                  <span className="director-chapter-title">{c.title}</span>
                  <span className="director-chapter-status">{t(c.status === 'planned' ? 'Planned' : c.status === 'drafting' ? 'Drafting' : c.status === 'drafted' ? 'Drafted' : 'Revised')}</span>
                  <div className="desc">{c.synopsis}</div>
                </li>
              ))}
            </ol>
          </Collapsible>
        </div>
      )}

      <div className="panel-section director-feed-section">
        <span className="heading">{t('Activity')}</span>
        <div className="director-feed" aria-live="polite">
          {run.log.map((e, i) => (
            <div key={e.id}>
              {checkpointsAt.has(i) && i > 1 && <CheckpointMark run={run} id={checkpointsAt.get(i)!.id} label={checkpointsAt.get(i)!.label} disabled={active} />}
              <FeedEntry run={run} entry={e} active={active} />
            </div>
          ))}
          {active && thinking && <div className="director-entry thought live">{thinking}</div>}
          {active && !thinking && !pending && (
            <div className="director-working">
              <span className="spinner" /> {generating ? t('The writer is writing…') : t('The Director is thinking…')}
            </div>
          )}
        </div>
      </div>
      {pending && <PendingCard pending={pending} />}
    </div>
  );
}

function StatusBadge({ status, active }: { status: DirectorRun['status']; active: boolean }) {
  const pausing = useDirector((s) => s.pauseRequested);
  const label = active && pausing ? t('Pausing…') : t(STATUS_LABELS[status]);
  return <span className={`director-badge ${status}`}>{label}</span>;
}

function CheckpointMark({ run, id, label, disabled }: { run: DirectorRun; id: string; label: string; disabled: boolean }) {
  return (
    <div className="director-checkpoint">
      <span>{checkpointLabel(label)}</span>
      {!disabled && (
        <button type="button" className="link-btn" onClick={() => void useDirector.getState().rollback(run.id, id)} title={t('Undo everything the Director did from here on')}>
          <ArrowArcLeft size={13} /> {t('Roll back to here')}
        </button>
      )}
    </div>
  );
}

function FeedEntry({ run, entry: e, active }: { run: DirectorRun; entry: LogEntry; active: boolean }) {
  const [open, setOpen] = useState(false);
  if (e.kind === 'user') return <div className="director-entry user">{e.text}</div>;
  if (e.kind === 'thought') return <div className="director-entry thought">{e.text}</div>;
  if (e.kind === 'system') return <div className="director-entry system">{e.tool === 'ask_user' ? <Question size={14} /> : null}{e.text}</div>;
  if (e.kind === 'error') return <div className="director-entry error"><WarningCircle size={14} /> {e.text}</div>;
  const undoable = (e.change || e.historyNode) && !e.reverted && !active && !e.isError;
  const long = e.text.length > 160 || e.text.includes('\n');
  return (
    <div className={`director-entry tool ${e.isError ? 'failed' : ''} ${e.reverted ? 'reverted' : ''}`}>
      <div className="director-entry-head">
        <button type="button" className="director-tool-name" onClick={() => setOpen(!open)} aria-expanded={open}>
          {t(TOOL_LABELS[e.tool ?? ''] ?? e.tool ?? '')}
        </button>
        {e.reverted && <span className="director-tag">{t('Undone')}</span>}
        {undoable && (
          <button type="button" className="icon-btn director-undo" aria-label={t('Undo')} title={t('Undo')} onClick={() => void useDirector.getState().undoEntry(run.id, e.id)}>
            <ArrowCounterClockwise size={14} />
          </button>
        )}
      </div>
      {e.text && <div className={`director-entry-text ${long && !open ? 'clamped' : ''}`} onClick={() => long && setOpen(!open)}>{e.text}</div>}
      {open && e.args && Object.keys(e.args).length > 0 && <pre className="director-args">{JSON.stringify(e.args, null, 2)}</pre>}
    </div>
  );
}

function PendingCard({ pending }: { pending: Pending }) {
  const [note, setNote] = useState('');
  const respond = useDirector((s) => s.respond);
  if (pending.kind === 'ask') {
    return (
      <div className="director-pending">
        <div className="director-pending-title">
          <Question size={16} weight="fill" /> {t('The Director asks')}
        </div>
        <div className="director-pending-text">{pending.question}</div>
        {pending.options.length > 0 && (
          <div className="director-examples">
            {pending.options.map((o) => (
              <button key={o} type="button" className="director-chip" onClick={() => respond({ answer: o })}>
                {o}
              </button>
            ))}
          </div>
        )}
        <textarea rows={2} value={note} placeholder={t('Your answer…')} aria-label={t('Your answer')} onChange={(ev) => setNote(ev.target.value)} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn primary" disabled={!note.trim()} onClick={() => respond({ answer: note.trim() })}>
            {t('Answer')}
          </button>
        </div>
      </div>
    );
  }
  const { preview } = pending;
  return (
    <div className="director-pending">
      <div className="director-pending-title">
        <WarningCircle size={16} weight="fill" /> {t('Approve: {action}', { action: t(TOOL_LABELS[pending.call.name] ?? pending.call.name) })}
      </div>
      {preview.text && <div className="director-pending-text">{preview.text}</div>}
      {preview.before !== undefined && preview.before !== '' && (
        <div className="director-diff before">
          <span className="director-diff-label">{t('Before')}</span>
          {preview.before}
        </div>
      )}
      {preview.after !== undefined && (
        <div className="director-diff after">
          <span className="director-diff-label">{t('After')}</span>
          {preview.after || t('(empty)')}
        </div>
      )}
      <textarea rows={1} value={note} placeholder={t('Note for the Director (optional)')} aria-label={t('Note for the Director')} onChange={(ev) => setNote(ev.target.value)} />
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={() => respond({ approved: false, note: note.trim() || undefined })}>
          {t('Reject')}
        </button>
        <button type="button" className="btn primary" onClick={() => respond({ approved: true })}>
          {t('Approve')}
        </button>
      </div>
    </div>
  );
}

function Controls({ run, onNew }: { run: DirectorRun; onNew: () => void }) {
  const d = useDirector();
  const active = d.activeRunId === run.id;
  const busyElsewhere = !!d.activeRunId && !active;
  const [msg, setMsg] = useState('');
  const send = () => {
    if (!msg.trim()) return;
    d.interject(msg);
    if (!active && !busyElsewhere) void d.resume(run.id);
    setMsg('');
  };
  const finished = run.status === 'done' || run.status === 'stopped' || run.status === 'error';
  return (
    <div className="director-controls">
      <div className="director-input">
        <textarea
          rows={2}
          value={msg}
          disabled={busyElsewhere}
          placeholder={active ? t('Step in: tell the Director something (it reads it before its next move)') : finished ? t('Ask for more to continue this run…') : t('Add a note, then resume…')}
          aria-label={t('Message to the Director')}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="icon-btn" aria-label={t('Send')} title={t('Send')} disabled={!msg.trim() || busyElsewhere} onClick={send}>
          <ArrowUp size={18} weight="bold" />
        </button>
      </div>
      <div className="row director-buttons">
        {active ? (
          <>
            <button type="button" className="btn" disabled={d.pauseRequested} onClick={d.pause} title={t('Stop after the current step')}>
              <Pause size={16} weight="fill" /> {t('Pause')}
            </button>
            <button type="button" className="btn danger" onClick={d.stop} title={t('Stop now, cutting off a passage being written')}>
              <Stop size={16} weight="fill" /> {t('Stop')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn primary" disabled={busyElsewhere} onClick={() => void d.resume(run.id)}>
              <Play size={16} weight="fill" /> {finished ? t('Continue') : t('Resume')}
            </button>
            <button type="button" className="btn" disabled={busyElsewhere} onClick={onNew}>
              <Plus size={16} weight="bold" /> {t('New Run')}
            </button>
            <button type="button" className="icon-btn" aria-label={t('Delete Run')} title={t('Delete Run')} disabled={busyElsewhere} onClick={async () => {
                if (await useUI.getState().confirm({ title: t('Delete this run?'), message: t('Only the run\'s record is deleted; what it wrote stays in the story.'), confirmLabel: t('Delete'), danger: true })) d.deleteRun(run.id);
              }}>
              <Trash size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
