import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, DiceFive, X } from '@phosphor-icons/react';
import { toPng } from 'html-to-image';
import {
  applyChange,
  buildToolboxRequest,
  commit,
  docText,
  pathTo,
  slice,
  storyPlaceholders,
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
import { Modal, ModalHeader, Select, SliderSetting, Tabs, Toggle } from '../../components/ui.tsx';
import { SAMPLER_INFO } from '../right/GenerationTab.tsx';
import { matchHotkey } from '../../hotkeys.ts';

export function ConfirmModal({ onClose, title, message, confirmLabel, danger, resolve }: { onClose: () => void; title: string; message?: string; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void }) {
  const done = (v: boolean) => {
    resolve(v);
    onClose();
  };
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
  const [more, setMore] = useState(false);
  const st = useMemo(() => storyStats(story), [story]);
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--bg1)' }}>
      <span>{t(k)}</span>
      <b>{v}</b>
    </div>
  );
  return (
    <Modal onClose={onClose} width={560} label={t('Story Stats')}>
      <ModalHeader title={t('Story Stats')} onClose={onClose} />
      <div className="modal-body">
        <Row k="Story Step" v={st.steps} />
        <Row k="History Nodes" v={st.historyNodes} />
        <Row k="AI Generations" v={st.aiGenerations} />
        <Row k="Dead Ends" v={st.deadEnds} />
        <Row k="Characters" v={st.characters} />
        {(['prompt', 'ai', 'edit', 'user'] as const).map((o) => (
          <Row key={o} k={`  ${o}`} v={<span className={`o-${o}`}>{st.charactersByOrigin[o] ?? 0}</span>} />
        ))}
        {more ? (
          <>
            <Row k="Words" v={st.words} />
            <Row k="Paragraphs" v={st.paragraphs} />
            <Row k="Sentences" v={st.sentences} />
            <div className="sub-heading" style={{ marginTop: 14 }}>{t('Most Used Words')}</div>
            <div className="chips" style={{ marginTop: 8 }}>
              {st.mostUsedWords.map(([w, n]) => (
                <span key={w} className="key-chip">
                  {w} <b>{n}</b>
                </span>
              ))}
            </div>
          </>
        ) : (
          <button type="button" className="btn block" style={{ marginTop: 14 }} onClick={() => setMore(true)}>
            {t('Generate Additional Stats')}
          </button>
        )}
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

export function ToolboxModal({ onClose, text, from, to }: { onClose: () => void; text: string; from: number; to: number }) {
  const [mode, setMode] = useState<ToolboxMode>('rewrite');
  const [concept, setConcept] = useState('');
  const [strength, setStrength] = useState(5);
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const run = async () => {
    const store = useStory.getState();
    const s = store.current;
    const model = store.resolveModel();
    if (!s || !model) return;
    setBusy(true);
    setResult('');
    abort.current = new AbortController();
    try {
      const req = buildToolboxRequest(s, text, mode, { concept, strength, instruction });
      const out = await generateText({ model, ...req, maxTokens: Math.max(200, Math.ceil(text.length / 2)), params: { temperature: 0.8 } }, abort.current.signal, setResult);
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
    const change: Change = insertBelow
      ? { pos: to, removed: [], inserted: [{ text: `\n${result}`, origin: 'ai' }] }
      : { pos: from, removed: slice(s.doc, from, to), inserted: [{ text: result, origin: 'ai' }] };
    const doc = canonical(applyChange(s.doc, change));
    store.update((st) => {
      st.history = commit(st.history, 'ai', [change]).history;
      st.doc = doc;
    });
    store.editor?.setDoc(doc, from);
    onClose();
  };
  return (
    <Modal onClose={onClose} width={820} label={t("Writer's Toolbox")}>
      <ModalHeader title={t("Writer's Toolbox")} onClose={onClose} />
      <Tabs
        value={mode}
        onChange={setMode}
        tabs={(['rewrite', 'transform', 'expand', 'condense', 'custom'] as const).map((m) => ({ value: m, label: t(m[0].toUpperCase() + m.slice(1)) }))}
      />
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16 }}>
        <div className="ctx-text" style={{ minHeight: 60, maxHeight: 160 }}>{text}</div>
        {mode === 'transform' && (
          <div className="row" style={{ gap: 14, alignItems: 'flex-end' }}>
            <label className="number-field grow">
              <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Concept')}</span>
              <input className="input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="holiday spirit" />
            </label>
            <div style={{ width: 240 }}>
              <SliderSetting small title={t('Strength')} value={strength} min={1} max={10} step={1} onChange={setStrength} />
            </div>
          </div>
        )}
        {mode === 'custom' && (
          <label className="number-field">
            <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Instruction')}</span>
            <input className="input" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t('e.g. Make it more ominous and add rain')} />
          </label>
        )}
        <button type="button" className="btn primary" disabled={busy || (mode === 'custom' && !instruction) || (mode === 'transform' && !concept)} onClick={() => void run()}>
          {busy ? <span className="spinner" /> : null} {t('Generate')}
        </button>
        {result && (
          <>
            <textarea className="textarea" style={{ minHeight: 160 }} value={result} onChange={(e) => setResult(e.target.value)} />
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn" onClick={() => apply(true)}>
                {t('Insert Below')}
              </button>
              <button type="button" className="btn primary" onClick={() => apply(false)}>
                {t('Replace')}
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

export function ScreenshotModal({ onClose, from, to }: { onClose: () => void; from?: number; to?: number }) {
  const story = useStory((s) => s.current)!;
  const ref = useRef<HTMLDivElement>(null);
  const [showTitle, setShowTitle] = useState(true);
  const [colors, setColors] = useState(true);
  const [width, setWidth] = useState(640);
  const [fontSize, setFontSize] = useState(16);
  const spans = from !== undefined && to !== undefined && to > from ? slice(story.doc, from, to) : slice(story.doc, Math.max(0, docText(story.doc).length - 1500), docText(story.doc).length);
  const save = async () => {
    if (!ref.current) return;
    const url = await toPng(ref.current, { pixelRatio: 2 });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(story.title)}.png`;
    a.click();
  };
  return (
    <Modal onClose={onClose} width={Math.max(760, width + 120)} label={t('Screenshot')}>
      <ModalHeader title={t('Screenshot Designer')} onClose={onClose}>
        <button type="button" className="btn primary" onClick={() => void save()}>
          {t('Download')}
        </button>
      </ModalHeader>
      <div className="row" style={{ gap: 18, flexWrap: 'wrap', marginBottom: 14 }}>
        <label className="row" style={{ fontSize: 14 }}>
          <Toggle on={showTitle} onChange={setShowTitle} /> {t('Title')}
        </label>
        <label className="row" style={{ fontSize: 14 }}>
          <Toggle on={colors} onChange={setColors} /> {t('Text colors')}
        </label>
        <div style={{ width: 200 }}>
          <SliderSetting small title={t('Width')} value={width} min={360} max={1000} step={10} onChange={setWidth} />
        </div>
        <div style={{ width: 200 }}>
          <SliderSetting small title={t('Text Size')} value={fontSize} min={12} max={24} step={1} onChange={setFontSize} />
        </div>
      </div>
      <div className="modal-body" style={{ display: 'flex', justifyContent: 'center' }}>
        <div ref={ref} style={{ width, background: 'var(--bg2)', padding: 28, border: '1px solid var(--bg3)' }}>
          {showTitle && <h2 style={{ color: 'var(--text-headings)', marginBottom: 14 }}>{story.title}</h2>}
          <div style={{ fontSize, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
            {spans.map((s, i) => (
              <span key={i} className={colors ? `o-${s.origin}` : undefined}>
                {s.text}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 18, fontSize: 12, opacity: 0.5, textAlign: 'right' }}>NovelWriter</div>
        </div>
      </div>
    </Modal>
  );
}

export function PlaceholdersModal({ onClose }: { onClose: () => void }) {
  const story = useStory((s) => s.current)!;
  const store = useStory.getState();
  const placeholders = useMemo(() => storyPlaceholders(story), [story]);
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
        {placeholders.map((p) => (
          <label key={p.key} className="number-field">
            <span style={{ fontWeight: 600 }}>{p.description || p.key}</span>
            {p.longDescription && <span className="desc">{p.longDescription}</span>}
            <input className="input" value={values[p.key] ?? ''} onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} />
          </label>
        ))}
        <button type="submit" className="btn primary">
          {t('Start')}
        </button>
      </form>
    </Modal>
  );
}

export function SamplersModal({ onClose }: { onClose: () => void }) {
  const story = useStory((s) => s.current)!;
  const store = useStory.getState();
  const order = story.params.order;
  const setOrder = (o: typeof order) => store.update((s) => void (s.params = { ...s.params, order: o }));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const o = [...order];
    [o[i], o[j]] = [o[j], o[i]];
    setOrder(o);
  };
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <Modal onClose={onClose} width={520} label={t('Change Samplers')}>
      <ModalHeader title={t('Change Samplers')} onClose={onClose} />
      <div className="desc" style={{ marginBottom: 12 }}>{t('Samplers apply from top to bottom. Drag or use the arrows to reorder; toggle to enable.')}</div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {order.map((s, i) => (
          <div
            key={s.id}
            className="provider-row"
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag === null || drag === i) return;
              const o = [...order];
              const [m] = o.splice(drag, 1);
              o.splice(i, 0, m);
              setOrder(o);
              setDrag(null);
            }}
            style={{ cursor: 'grab' }}
          >
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{t(SAMPLER_INFO[s.id as SamplerId].label)}</div>
              <div className="desc" style={{ fontSize: 12 }}>{t(SAMPLER_INFO[s.id as SamplerId].help)}</div>
            </div>
            <button type="button" className="icon-btn" aria-label="Up" onClick={() => move(i, -1)}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className="icon-btn" aria-label="Down" onClick={() => move(i, 1)}>
              <ArrowDown size={16} />
            </button>
            <Toggle on={s.enabled} onChange={(v) => setOrder(order.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} label={s.id} />
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
