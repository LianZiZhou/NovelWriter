import { useEffect, useMemo, useRef, useState } from 'react';
import { DiceFive, X } from '@phosphor-icons/react';
import { toBlob, toJpeg, toPng } from 'html-to-image';
import { Logo } from '../../components/Logo.tsx';
import { QUOTE_RE } from '../editor/pm.ts';
import {
  applyChange,
  buildToolboxRequest,
  TOOLBOX_STRENGTHS,
  commit,
  docText,
  pathTo,
  backendCaps,
  slice,
  storyPlaceholders,
  placeholderUses,
  applyPlaceholders,
  storyStats,
  tokenIds,
  tokenize,
  type Change,
  type SamplerId,
  type ToolboxMode,
} from '@novelwriter/core';
import { generateText } from '../../api.ts';
import { canonical, download, safeFileName, useStory } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { useSettings } from '../../store/settings.ts';
import { t } from '../../i18n.ts';
import { Modal, ModalHeader, SegmentedControl, Select, SliderSetting, Tabs, Toggle } from '../../components/ui.tsx';
import { SAMPLER_INFO } from '../right/GenerationTab.tsx';
import { matchHotkey } from '../../hotkeys.ts';

export function ConfirmModal({ title, message, confirmLabel, danger, resolve }: { title: string; message?: string; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void }) {
  const done = (v: boolean) => resolve(v);
  return (
    <Modal onClose={() => done(false)} width={440} label={title}>
      <ModalHeader title={title} onClose={() => done(false)} />
      {message && <p style={{ marginTop: 0 }}>{message}</p>}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
        <button type="button" className="btn" onClick={() => done(false)}>
          {t('Cancel')}
        </button>
        <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => done(true)} autoFocus>
          {confirmLabel ?? t('Confirm')}
        </button>
      </div>
    </Modal>
  );
}

export function StatsModal({ onClose }: { onClose: () => void }) {
  const story = useStory((s) => s.current)!;
  const [allWords, setAllWords] = useState(false);
  const st = useMemo(() => storyStats(story), [story]);
  const sx = st.structure;
  const Row = ({ k, v, dot }: { k: string; v: React.ReactNode; dot?: string }) => (
    <div className={`stat-row ${dot ? 'sub' : ''}`}>
      <span>
        {dot && <span className="stat-dot" style={{ background: dot }} />}
        {t(k)}
      </span>
      <b>{v}</b>
    </div>
  );
  const words = allWords ? st.mostUsedWords : st.mostUsedWords.slice(0, 5);
  return (
    <Modal onClose={onClose} width={660} label={t('Story Statistics')} className="stats-modal">
      <ModalHeader plain title={t('Story Statistics')} subtitle={t('Get a perspective on your writing.')} onClose={onClose} />
      <div className="modal-body stats-grid">
        <div>
          <div className="stat-group">{t('Data')}</div>
          <Row k="Sections" v={st.sections} />
          <Row k="Lorebook Entries" v={st.lorebookEntries} />
          <Row k="Ephemeral Entries" v={st.ephemeralEntries} />
          <div className="stat-group">{t('Writing')}</div>
          <Row k="Characters" v={st.characters} />
          <Row k="User" dot="var(--text-user)" v={st.charactersByOrigin.user ?? 0} />
          <Row k="AI" dot="var(--text-ai)" v={st.charactersByOrigin.ai ?? 0} />
          <Row k="Edits" dot="var(--text-edit)" v={st.charactersByOrigin.edit ?? 0} />
          <Row k="Prompt" dot="var(--text-prompt)" v={st.charactersByOrigin.prompt ?? 0} />
          <Row k="Paragraphs" v={st.paragraphs} />
          <Row k="Words" v={st.words} />
          <Row k="Sentences" v={st.sentences} />
        </div>
        <div>
          <div className="stat-group">{t('Structure')}</div>
          <Row k="Current Step" v={sx.currentStep} />
          <Row k="Furthest Step" v={sx.furthestStep} />
          <Row k="Dead Ends" v={sx.deadEnds} />
          <Row k="No Retry Streak" v={sx.noRetryStreak} />
          <Row k="Longest Abandoned Branch" v={sx.longestAbandonedBranch} />
          <Row k="Most Retries" v={sx.mostRetries} />
          <Row k="Average Retries" v={sx.averageRetries} />
          <div className="stat-group" title={t('Words of three or more letters, leaving out common ones.')}>
            {t('Most Used Words')}
          </div>
          <ol className="stat-words">
            {words.map(([w, n]) => (
              <li key={w}>
                {w} <span className="muted">({n})</span>
              </li>
            ))}
            {words.length === 0 && <li>—</li>}
          </ol>
          {st.mostUsedWords.length > 5 && (
            <button type="button" className="link-btn" onClick={() => setAllWords(!allWords)}>
              {allWords ? t('Show fewer') : t('Show more')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function StoryInfoModal({ onClose }: { onClose: () => void }) {
  const story = useStory((s) => s.current)!;
  const shelves = useStory((s) => s.shelves);
  const task = useStory((s) => s.task);
  const store = useStory.getState();
  const [tag, setTag] = useState('');
  return (
    <Modal onClose={onClose} width={590} label={t('Story Settings')} className="story-settings-modal">
      <ModalHeader title={t('Story Settings')} onClose={onClose} />
      <div className="modal-body story-settings">
        <label className="ss-label" htmlFor="ss-title">{t('Story Title')}</label>
        <div className="row" style={{ gap: 0 }}>
          <input id="ss-title" className="input grow" value={story.title} onChange={(e) => store.update((s) => void (s.title = e.target.value))} />
          <button type="button" className="ss-dice" aria-label={t('Generate a random title for the story')} disabled={task === 'title'} onClick={() => void store.generateTitle()}>
            {task === 'title' ? <span className="spinner" /> : <DiceFive size={20} weight="fill" />}
          </button>
        </div>
        {story.titleHistory.length > 0 && (
          <details className="ss-title-history">
            <summary>{t('Title Generation History')}</summary>
            <ul>
              {story.titleHistory.map((h, i) => (
                <li key={i}>
                  <button type="button" className={h === story.title ? 'active' : ''} onClick={() => store.update((s) => void (s.title = h))}>
                    {h}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <label className="ss-label" htmlFor="ss-desc">{t('Description')}</label>
        <textarea id="ss-desc" className="textarea" style={{ height: 145 }} value={story.description} onChange={(e) => store.update((s) => void (s.description = e.target.value))} />
        <div className="ss-label">{t('Shelf')}</div>
        <Select
          value={story.shelf ?? '__none'}
          onChange={(v) => store.update((s) => void (s.shelf = v === '__none' ? null : v))}
          options={[{ value: '__none', label: <i>{t('No Shelf')}</i> }, ...shelves.map((sh) => ({ value: sh.id, label: sh.title }))]}
        />
        <div className="ss-label">{t('Search Tags')}</div>
        <div className="ss-hint">{t('Type in the box below and press enter to save.')}</div>
        <div className="ss-tags">
          <input
            className="input"
            value={tag}
            placeholder={t('Type here and hit enter to save')}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tag.trim()) {
                store.update((s) => void (s.tags = [...s.tags, tag.trim()]));
                setTag('');
              }
            }}
          />
          <div className="ss-tag-box">
            <div className="ss-hint" style={{ textAlign: 'right' }}>{t('Click a tag to delete it.')}</div>
            <div className="chips">
              {story.tags.map((tg, i) => (
                <button type="button" key={i} className="key-chip" onClick={() => store.update((s) => void (s.tags = s.tags.filter((_, j) => j !== i)))}>
                  {tg}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

const TOOLBOX_MODES: { id: ToolboxMode; label: string }[] = [
  { id: 'retry', label: 'Retry' },
  { id: 'transform', label: 'Transform' },
  { id: 'expand', label: 'Expand' },
  { id: 'condense', label: 'Condense' },
  { id: 'rewriteStyle', label: 'Rewrite Style' },
  { id: 'infill', label: 'Infill' },
  { id: 'custom', label: 'Custom' },
];

/** Writer's Toolbox: rework a selection (or fill in text at the cursor) with one of NovelAI's tools. */
export function ToolboxModal({ onClose, text, from, to, mode: initialMode }: { onClose: () => void; text: string; from: number; to: number; mode?: ToolboxMode }) {
  const empty = !text.trim();
  const [mode, setMode] = useState<ToolboxMode>(initialMode ?? (empty ? 'infill' : 'rewriteStyle'));
  const [concept, setConcept] = useState('');
  const [strength, setStrength] = useState(1);
  const [instruction, setInstruction] = useState('');
  const [input, setInput] = useState(text);
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const run = async (source = input) => {
    const store = useStory.getState();
    const s = store.current;
    const model = store.resolveModel();
    if (!s || !model) return;
    setBusy(true);
    setResult('');
    abort.current = new AbortController();
    try {
      const full = docText(s.doc);
      const req = buildToolboxRequest(s, source, mode, { concept, strength, instruction, before: full.slice(0, from), after: full.slice(to) });
      const maxTokens = mode === 'infill' ? [16, 80, 300, 700][strength] : Math.max(200, Math.ceil(source.length / 2));
      const out = await generateText({ model, ...req, maxTokens, params: { temperature: 0.8 } }, abort.current.signal, setResult);
      setResult(out.trim());
    } catch (e) {
      useUI.getState().toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const apply = (insertBelow: boolean) => {
    const store = useStory.getState();
    const s = store.current;
    if (!s || !result) return;
    const full = docText(s.doc);
    // Infill joins the surrounding text with a space where needed.
    const pad = mode === 'infill' ? (from > 0 && !/\s$/.test(full.slice(0, from)) && !/^\s/.test(result) ? ' ' : '') : '';
    const change: Change = insertBelow
      ? { pos: to, removed: [], inserted: [{ text: `\n${result}`, origin: 'ai' }] }
      : { pos: from, removed: slice(s.doc, from, to), inserted: [{ text: pad + result, origin: 'ai' }] };
    const doc = canonical(applyChange(s.doc, change));
    store.update((st) => {
      st.history = commit(st.history, 'ai', [change]).history;
      st.doc = doc;
    });
    store.editor?.setDoc(doc, from);
    onClose();
  };
  const strengthKey = mode === 'transform' || mode === 'expand' || mode === 'condense' || mode === 'infill' ? mode : null;
  const modes = empty ? TOOLBOX_MODES.filter((m) => m.id === 'infill' || m.id === 'custom') : TOOLBOX_MODES.filter((m) => m.id !== 'infill');
  return (
    <Modal onClose={onClose} width={820} label={t("Writer's Toolbox")}>
      <ModalHeader title={t("Writer's Toolbox")} onClose={onClose} />
      <Tabs value={mode} onChange={(m) => (setMode(m), setResult(''))} tabs={modes.map((m) => ({ value: m.id, label: t(m.label) }))} />
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16 }}>
        {mode === 'infill' ? (
          <div className="desc">{t('Generates new text at the cursor that bridges what comes before and after it.')}</div>
        ) : (
          <div className="ctx-text" style={{ minHeight: 60, maxHeight: 160 }}>{input}</div>
        )}
        {mode === 'transform' && (
          <label className="number-field">
            <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Make the text…')}</span>
            <input className="input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder={t('e.g. ominous, funny, formal')} />
          </label>
        )}
        {strengthKey && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{mode === 'infill' ? t('Length') : t('Strength')}</div>
            <SegmentedControl value={String(strength)} onChange={(v) => setStrength(Number(v))} options={TOOLBOX_STRENGTHS[strengthKey].map((label, i) => ({ value: String(i), label: t(label) }))} />
          </div>
        )}
        {mode === 'custom' && (
          <label className="number-field">
            <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Instruction')}</span>
            <input className="input" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t('Enter a custom instruction.')} />
          </label>
        )}
        <button type="button" className="btn primary" disabled={busy || (mode === 'custom' && !instruction) || (mode === 'transform' && !concept)} onClick={() => void run()}>
          {busy ? <span className="spinner" /> : null} {t('Generate')}
        </button>
        {result && (
          <>
            <textarea className="textarea" style={{ minHeight: 160 }} value={result} onChange={(e) => setResult(e.target.value)} aria-label={t('Result')} />
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
              {mode !== 'infill' && (
                <button
                  type="button"
                  className="btn"
                  title={t('Run the tool again on this result')}
                  onClick={() => {
                    setInput(result);
                    void run(result);
                  }}
                >
                  {t('Adjust')}
                </button>
              )}
              <button type="button" className="btn" onClick={onClose}>
                {t('Cancel')}
              </button>
              {mode !== 'infill' && (
                <button type="button" className="btn" onClick={() => apply(true)}>
                  {t('Insert Below')}
                </button>
              )}
              <button type="button" className="btn primary" onClick={() => apply(false)}>
                {mode === 'infill' ? t('Insert') : t('Replace')}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function TokenizeModal({ onClose, text: initial, standalone }: { onClose: () => void; text: string; standalone?: boolean }) {
  const [text, setText] = useState(initial);
  const tokens = useMemo(() => tokenize(text), [text]);
  const ids = useMemo(() => tokenIds(text), [text]);
  const colors = ['#3c4a7a', '#5b3c7a', '#3c7a5b', '#7a5b3c', '#7a3c4a'];
  return (
    <Modal onClose={onClose} width={760} label={t('Tokenizer')}>
      <ModalHeader title={t('Tokenizer')} subtitle={t('{n} tokens · {c} characters', { n: tokens.length, c: text.length })} onClose={onClose} />
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {standalone && <textarea autoFocus className="textarea" style={{ minHeight: 120 }} placeholder={t('Type text to tokenize…')} value={text} onChange={(e) => setText(e.target.value)} />}
        <div className="ctx-text" style={{ lineHeight: 2 }}>
          {tokens.map((tk, i) => (
            <span key={i} title={String(ids[i] ?? '')} style={{ background: colors[i % colors.length], padding: '2px 0', whiteSpace: 'pre-wrap' }}>
              {tk}
            </span>
          ))}
        </div>
        <div className="desc">{t('Approximate tokenization (o200k). Each model uses its own tokenizer.')}</div>
        <code style={{ fontSize: 12, wordBreak: 'break-all', opacity: 0.8 }}>[{ids.join(', ')}]</code>
      </div>
    </Modal>
  );
}

const ORIGIN_LEGEND: { origin: string; label: string }[] = [
  { origin: 'prompt', label: 'Prompt' },
  { origin: 'ai', label: 'AI' },
  { origin: 'edit', label: 'Edited' },
  { origin: 'user', label: 'User' },
];

function speechParts(text: string): { text: string; speech: boolean }[] {
  const out: { text: string; speech: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(QUOTE_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), speech: false });
    out.push({ text: m[0], speech: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), speech: false });
  return out;
}

type ShotBackground = 'theme' | 'dark' | 'light' | 'paper';
const SHOT_BACKGROUNDS: Record<ShotBackground, { bg: string; fg?: string; border: string }> = {
  theme: { bg: 'var(--bg2)', border: 'var(--bg3)' },
  dark: { bg: '#15161b', fg: '#e8e6e3', border: '#2a2b33' },
  light: { bg: '#ffffff', fg: '#1d1d1f', border: '#dddddd' },
  paper: { bg: '#f4ecd8', fg: '#3b2f22', border: '#d8c9a6' },
};

export function ScreenshotModal({ onClose, from, to }: { onClose: () => void; from?: number; to?: number }) {
  const story = useStory((s) => s.current)!;
  const model = useStory((s) => s.modelInfo)();
  const penName = useSettings((s) => s.penName);
  const ref = useRef<HTMLDivElement>(null);
  const [opt, setOpt] = useState({ title: true, date: false, penName: !!penName, logo: true, colors: true, legend: false, model: false, speech: false });
  const [background, setBackground] = useState<ShotBackground>('theme');
  const [comment, setComment] = useState('');
  const [width, setWidth] = useState(640);
  const [fontSize, setFontSize] = useState(16);
  const [busy, setBusy] = useState(false);
  const spans = from !== undefined && to !== undefined && to > from ? slice(story.doc, from, to) : slice(story.doc, Math.max(0, docText(story.doc).length - 1500), docText(story.doc).length);
  const theme = SHOT_BACKGROUNDS[background];
  const colors = opt.colors && background === 'theme';
  const toggle = (k: keyof typeof opt) => (v: boolean) => setOpt((o) => ({ ...o, [k]: v }));
  const save = async (kind: 'png' | 'jpg' | 'clipboard') => {
    if (!ref.current) return;
    setBusy(true);
    try {
      const name = safeFileName(story.title);
      if (kind === 'clipboard') {
        const blob = await toBlob(ref.current, { pixelRatio: 2 });
        if (!blob) throw new Error('Could not render the screenshot.');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        useUI.getState().toast(t('Copied to clipboard'), 'success');
        return;
      }
      const url = kind === 'png' ? await toPng(ref.current, { pixelRatio: 2 }) : await toJpeg(ref.current, { pixelRatio: 2, quality: 0.92, backgroundColor: background === 'theme' ? getComputedStyle(ref.current).backgroundColor : theme.bg });
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.${kind}`;
      a.click();
    } catch (e) {
      useUI.getState().toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const OPTIONS: [keyof typeof opt, string][] = [
    ['title', 'Show Title'],
    ['date', 'Show Date'],
    ['penName', 'Show Pen Name'],
    ['logo', 'Show Logo'],
    ['colors', 'Color Highlighting'],
    ['legend', 'Show Legend'],
    ['model', 'Show AI Model'],
    ['speech', 'Highlight Speech'],
  ];
  return (
    <Modal onClose={onClose} width={Math.max(820, width + 120)} label={t('Screenshot')}>
      <ModalHeader title={t('Screenshot Designer')} onClose={onClose}>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn" disabled={busy} onClick={() => void save('clipboard')}>
            {t('Copy to Clipboard')}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void save('jpg')}>
            {t('Download JPG')}
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save('png')}>
            {t('Download PNG')}
          </button>
        </div>
      </ModalHeader>
      <div className="shot-options">
        {OPTIONS.map(([k, label]) => (
          <label key={k} className="row shot-option">
            <Toggle on={opt[k]} onChange={toggle(k)} label={t(label)} disabled={k === 'colors' && background !== 'theme'} /> {t(label)}
          </label>
        ))}
      </div>
      {opt.penName && !penName && (
        <div className="desc" style={{ marginBottom: 8 }}>
          {t('Set your Pen Name in Settings → Defaults.')}
        </div>
      )}
      <div className="row" style={{ gap: 18, flexWrap: 'wrap', marginBottom: 14, alignItems: 'flex-end' }}>
        <div style={{ width: 170 }}>
          <div className="sub-heading">{t('Background')}</div>
          <Select
            ariaLabel={t('Background')}
            value={background}
            onChange={setBackground}
            options={[
              { value: 'theme', label: t('Theme') },
              { value: 'dark', label: t('Dark') },
              { value: 'light', label: t('Light') },
              { value: 'paper', label: t('Paper') },
            ]}
          />
        </div>
        <div style={{ width: 180 }}>
          <SliderSetting small title={t('Width')} value={width} min={360} max={1000} step={10} onChange={setWidth} />
        </div>
        <div style={{ width: 180 }}>
          <SliderSetting small title={t('Text Size')} value={fontSize} min={12} max={24} step={1} onChange={setFontSize} />
        </div>
        <label className="grow" style={{ minWidth: 200 }}>
          <div className="sub-heading">{t('Comment')}</div>
          <input className="input" value={comment} placeholder={t('Add a comment to the screenshot')} onChange={(e) => setComment(e.target.value)} />
        </label>
      </div>
      <div className="modal-body" style={{ display: 'flex', justifyContent: 'center' }}>
        <div ref={ref} className="shot-canvas" style={{ width, background: theme.bg, color: theme.fg, padding: 28, border: `1px solid ${theme.border}` }}>
          {(opt.title || opt.date || (opt.penName && penName)) && (
            <div style={{ marginBottom: 14 }}>
              {opt.title && <h2 style={{ color: theme.fg ?? 'var(--text-headings)', margin: 0 }}>{story.title}</h2>}
              <div style={{ fontSize: 13, opacity: 0.65, marginTop: 4 }}>
                {[opt.penName && penName ? t('by {name}', { name: penName }) : '', opt.date ? new Date(story.updatedAt).toLocaleDateString() : ''].filter(Boolean).join(' · ')}
              </div>
            </div>
          )}
          <div style={{ fontSize, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
            {spans.map((s, i) =>
              opt.speech ? (
                speechParts(s.text).map((p, j) => (
                  <span key={`${i}-${j}`} className={colors ? `o-${s.origin}` : undefined} style={p.speech ? { filter: 'brightness(1.25) saturate(1.1)' } : { opacity: 0.72 }}>
                    {p.text}
                  </span>
                ))
              ) : (
                <span key={i} className={colors ? `o-${s.origin}` : undefined}>
                  {s.text}
                </span>
              ),
            )}
          </div>
          {comment && <div style={{ marginTop: 16, paddingTop: 10, borderTop: `1px solid ${theme.border}`, fontStyle: 'italic', fontSize: 14 }}>{comment}</div>}
          <div className="row between" style={{ marginTop: 18, fontSize: 12, opacity: 0.6, gap: 12, flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 10 }}>
              {opt.legend && colors &&
                ORIGIN_LEGEND.map((l) => (
                  <span key={l.origin} className={`o-${l.origin}`}>
                    ■ {t(l.label)}
                  </span>
                ))}
              {opt.model && model && <span>{model.name}</span>}
            </div>
            {opt.logo && (
              <span className="row" style={{ gap: 4 }}>
                <Logo size={14} /> NovelWriter
              </span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function PlaceholdersModal({ onClose }: { onClose: () => void }) {
  const story = useStory((s) => s.current)!;
  const store = useStory.getState();
  const placeholders = useMemo(() => storyPlaceholders(story), [story]);
  const uses = useMemo(() => placeholderUses(story), [story]);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(placeholders.map((p) => [p.key, p.defaultValue])));
  useEffect(() => {
    if (!placeholders.length) onClose();
  }, [placeholders, onClose]);
  return (
    <Modal onClose={onClose} width={560} label={t('Fill in Placeholders')}>
      <ModalHeader title={t('Fill in Placeholders')} onClose={onClose} />
      <form
        className="modal-body"
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          const filled = applyPlaceholders(story, values);
          filled.doc = canonical(filled.doc);
          filled.history = commit(
            { nodes: { root: { id: 'root', parent: null, children: [], type: 'root', changes: [], time: Date.now() } }, current: 'root' },
            'prompt',
            filled.doc.length ? [{ pos: 0, removed: [], inserted: filled.doc }] : [],
          ).history;
          store.update(() => filled);
          store.editor?.setDoc(filled.doc);
          onClose();
        }}
      >
        <div className="desc">{t('This scenario has placeholders. Fill them in to personalize it, or keep them to edit the scenario itself.')}</div>
        {placeholders.map((p) => (
          <label key={p.key} className="number-field">
            <span style={{ fontWeight: 600 }}>{p.description || p.key}</span>
            {p.longDescription && <span className="desc">{p.longDescription}</span>}
            <input className="input" value={values[p.key] ?? ''} aria-label={p.description || p.key} onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} />
            <span className="desc placeholder-uses">
              <code>{'${' + p.key + '}'}</code> {t('used in')}: {(uses.get(p.key) ?? []).map((w) => (w.includes(': ') ? `${t(w.split(': ')[0])}: ${w.split(': ').slice(1).join(': ')}` : t(w))).join(', ') || '—'}
            </span>
          </label>
        ))}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose} title={t('Start without replacing the placeholders, e.g. to edit the scenario.')}>
            {t('Keep Placeholders')}
          </button>
          <button type="submit" className="btn primary">
            {t('Fill Placeholders')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const SAMPLER_NAMES: Record<SamplerId, string> = {
  temperature: 'Temperature (Randomness)',
  top_k: 'Top-K Sampling',
  top_p: 'Nucleus Sampling',
  tfs: 'Tail-Free Sampling',
  top_a: 'Top-A Sampling',
  typical_p: 'Typical Sampling',
  min_p: 'Min-P',
  mirostat: 'Mirostat',
  unified: 'Unified Sampling',
};

/** Sampler order table: drag rows to reorder, disable/enable on the right. */
export function SamplersModal({ onClose }: { onClose: () => void }) {
  const story = useStory((s) => s.current)!;
  const info = useStory((s) => s.modelInfo)();
  const caps = backendCaps(info?.flavor ?? 'chat-only');
  const store = useStory.getState();
  const order = story.params.order;
  const setOrder = (o: typeof order) => store.update((s) => void (s.params = { ...s.params, order: o }));
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <Modal onClose={onClose} width={334} label={t('Samplers')} className="samplers-modal">
      <ModalHeader title={t('Samplers')} onClose={onClose} />
      <p className="samplers-help">{t('You can reorder samplers here.')}</p>
      <p className="samplers-help">{t('Disabled samplers will be hidden from the sidebar.')}</p>
      {caps.samplerOrder ? null : <p className="samplers-help desc">{t('This model applies samplers in its own fixed order.')}</p>}
      <div className="modal-body samplers-table" role="list">
        {order.map((s, i) => (
          <div
            key={s.id}
            role="listitem"
            className={`sampler-row ${drag === i ? 'dragging' : ''} ${caps.params.includes(s.id as SamplerId) ? '' : 'unsupported'}`}
            draggable
            title={t(SAMPLER_INFO[s.id as SamplerId].help)}
            onDragStart={() => setDrag(i)}
            onDragEnd={() => setDrag(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag === null || drag === i) return;
              const o = [...order];
              const [m] = o.splice(drag, 1);
              o.splice(i, 0, m);
              setOrder(o);
              setDrag(null);
            }}
          >
            <span className="sampler-name">
              {t(SAMPLER_NAMES[s.id as SamplerId])}
              {!s.enabled && <span className="sampler-off">({t('disabled')})</span>}
              {!caps.params.includes(s.id as SamplerId) && <span className="sampler-unsupported">{t('not used by this model')}</span>}
            </span>
            <button type="button" className="sampler-toggle" aria-label={`${s.enabled ? 'disable' : 'enable'} ${s.id}`} onClick={() => setOrder(order.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))}>
              {s.enabled ? t('disable') : t('enable')}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Visual history tree: every node, with the current path highlighted. */
export function HistoryTreeModal({ onClose }: { onClose: () => void }) {
  const story = useStory((s) => s.current)!;
  const h = story.history;
  const onPath = new Set(pathTo(h, h.current));
  const render = (id: string, depth: number): React.ReactNode[] => {
    const n = h.nodes[id];
    const text = n.changes.map((c) => c.inserted.map((s) => s.text).join('') || (c.removed.length ? `− ${c.removed.map((s) => s.text).join('')}` : '')).join(' ').replace(/\n/g, ' ⏎ ');
    const row = (
      <div
        key={id}
        className={`node ${id === h.current ? 'current' : ''} ${onPath.has(id) ? 'on-path' : ''}`}
        style={{ paddingLeft: 6 + depth * 16 }}
        onClick={() => {
          useStory.getState().jump(id);
        }}
      >
        <span className={`o-${n.type === 'root' ? 'prompt' : n.type}`}>{n.type === 'root' ? '●' : n.type === 'ai' ? '◆' : '○'}</span>
        <span style={{ opacity: 0.6 }}>{n.type}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text.slice(0, 120)}</span>
      </div>
    );
    // Collapse long linear chains for readability.
    const kids = n.children.flatMap((c) => render(c, n.children.length > 1 ? depth + 1 : depth));
    return [row, ...kids];
  };
  return (
    <Modal onClose={onClose} width={900} label={t('History Tree')}>
      <ModalHeader title={t('History Tree')} onClose={onClose} />
      <div className="desc" style={{ marginBottom: 10 }}>{t('Click any node to jump to that point. Branches are indented.')}</div>
      <div className="modal-body history-tree">{render('root', 0)}</div>
    </Modal>
  );
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function PaletteModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const store = useStory.getState();
  const ui = useUI.getState();
  const settings = useSettings.getState();
  const library = useStory((s) => s.library);
  const commands: Command[] = [
    { id: 'send', label: t('Send'), hint: 'Ctrl+Enter', run: () => void store.send() },
    { id: 'retry', label: t('Retry'), hint: 'Alt+R', run: () => void store.retry() },
    { id: 'undo', label: t('Undo'), run: () => store.undo() },
    { id: 'redo', label: t('Redo'), run: () => store.redo() },
    { id: 'lorebook', label: t('Lorebook'), run: () => ui.open('lorebook') },
    { id: 'settings', label: t('Open Settings'), run: () => ui.open('settings') },
    { id: 'providers', label: t('AI Providers'), run: () => ui.open('settings', { tab: 'providers' }) },
    { id: 'theme', label: t('Theme'), run: () => ui.open('settings', { tab: 'theme' }) },
    { id: 'ctx', label: t('Current Context'), run: () => ui.open('contextViewer', { which: 'current' }) },
    { id: 'tree', label: t('History Tree'), run: () => ui.open('historyTree') },
    { id: 'stats', label: t('View Story Stats'), run: () => ui.open('stats') },
    { id: 'title', label: t('Generate a random title for the story'), run: () => void store.generateTitle() },
    { id: 'new', label: t('New Story'), run: () => useStory.getState().showNewStory() },
    { id: 'find', label: t('Find'), run: () => ui.set({ findOpen: true }) },
    { id: 'export', label: `${t('Export Story')} — ${t('To File')}`, run: () => store.current && void store.downloadStory(store.current.id) },
    { id: 'mode', label: `${t('Story Mode')}: ${t('Storyteller')} / ${t('Text Adventure')}`, run: () => store.update((s) => void (s.mode = s.mode === 'adventure' ? 'storyteller' : 'adventure')) },
    { id: 'speech', label: t('Highlight Speech'), run: () => settings.set({ highlightSpeech: !settings.highlightSpeech }) },
    ...library.map((m) => ({ id: `open:${m.id}`, label: `${t('Open')}: ${m.title}`, run: () => void store.openStory(m.id) })),
  ];
  const filtered = q ? commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())) : commands;
  const exec = (c?: Command) => {
    if (!c) return;
    onClose();
    setTimeout(c.run, 0);
  };
  return (
    <Modal onClose={onClose} width={600} label={t('Command Palette')}>
      <input
        autoFocus
        className="input"
        style={{ fontSize: 16, padding: 14 }}
        placeholder={t('Type a command…')}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setIdx((i) => Math.min(filtered.length - 1, i + 1));
          else if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1));
          else if (e.key === 'Enter') exec(filtered[idx]);
          else if (matchHotkey(e.nativeEvent, 'Mod-k')) onClose();
        }}
      />
      <div className="palette-list" style={{ marginTop: 8 }}>
        {filtered.map((c, i) => (
          <button type="button" key={c.id} className={`palette-item ${i === idx ? 'active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => exec(c)}>
            <span>{c.label}</span>
            {c.hint && <span className="muted" style={{ fontSize: 12 }}>{c.hint}</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export { download };
