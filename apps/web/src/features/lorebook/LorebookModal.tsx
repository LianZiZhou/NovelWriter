import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Book,
  CaretDown,
  CaretUp,
  Check,
  CheckSquare,
  Copy,
  DownloadSimple,
  Eye,
  EyeSlash,
  Funnel,
  Image as ImageIcon,
  Lightbulb,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  SidebarSimple,
  Question,
  Trash,
  UploadSimple,
  Warning,
  X,
} from '@phosphor-icons/react';
import {
  activateLorebook,
  countTokens,
  docText,
  embedPngLorebook,
  exportLorebook,
  isRegexKey,
  compileRegexKey,
  newLoreCategory,
  newLoreEntry,
  searchLore,
  uid,
  type LoreCategory,
  type LoreEntry,
  type Lorebook,
  MAX_SEARCH_RANGE,
} from '@novelwriter/core';
import { download, safeFileName, useStory } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { EnterInput, Modal, Select, Tabs, ToggleRow } from '../../components/ui.tsx';
import { ContextConfigEditor } from './ContextConfigEditor.tsx';
import { ConditionsEditor } from './ConditionsEditor.tsx';
import { LoreGenerator } from './LoreGenerator.tsx';
import { PhraseBiasEditor } from '../right/PhraseBiasEditor.tsx';
import { hasHook, runScriptHook, useScripts } from '../scripts/host.ts';
import { ScriptPanels } from '../scripts/ScriptUI.tsx';

type Selection = { kind: 'entry'; id: string } | { kind: 'category'; id: string } | null;

export function LorebookModal({ onClose, entryId, generate }: { onClose: () => void; entryId?: string; generate?: string }) {
  const story = useStory((s) => s.current)!;
  const store = useStory.getState();
  const ui = useUI.getState();
  const lb = story.lorebook;
  const [sel, setSel] = useState<Selection>(entryId ? { kind: 'entry', id: entryId } : null);
  const docked = useSettings((s) => s.loreDocked);
  // Scripts hear which entry is open (onLorebookEntrySelected).
  useEffect(() => {
    if (sel?.kind === 'entry' && hasHook('onLorebookEntrySelected')) void runScriptHook('onLorebookEntrySelected', { entryId: sel.id });
  }, [sel?.kind === 'entry' ? sel.id : null]);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sort, setSort] = useState<'default' | 'alpha' | 'recent'>('default');
  const [sortOpen, setSortOpen] = useState(false);
  const [multi, setMulti] = useState<Set<string> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pngRef = useRef<HTMLInputElement>(null);

  const setLb = (fn: (l: Lorebook) => Lorebook) => store.update((s) => void (s.lorebook = fn(s.lorebook)));
  const updateEntry = (id: string, patch: Partial<LoreEntry>) =>
    setLb((l) => ({ ...l, entries: l.entries.map((e) => (e.id === id ? { ...e, ...patch, lastUpdatedAt: Date.now() } : e)) }));
  const updateCat = (id: string, patch: Partial<LoreCategory>) => setLb((l) => ({ ...l, categories: l.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const activations = useMemo(
    () => activateLorebook({ lorebook: lb, storyText: docText(story.doc), memoryText: story.memory, authorsNoteText: story.authorsNote, currentStep: story.step, model: story.model?.id ?? '', mode: story.mode, random: () => 1 }),
    [lb, story.doc, story.memory, story.authorsNote, story.step, story.model, story.mode],
  );
  const activeIds = new Set(activations.filter((a) => a.active).map((a) => a.entry.id));

  const entries = useMemo(() => {
    let l = search ? searchLore(lb.entries, search) : lb.entries;
    if (sort === 'alpha') l = [...l].sort((a, b) => a.displayName.localeCompare(b.displayName));
    if (sort === 'recent') l = [...l].sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
    return l;
  }, [lb.entries, search, sort]);

  const addEntry = (category: string | null = null) => {
    const cat = lb.categories.find((c) => c.id === category);
    const defaults = cat?.useCategoryDefaults ? cat.categoryDefaults : {};
    const e = newLoreEntry({ ...defaults, category, id: uid(), displayName: t('New Lorebook Entry') }, story.contextSettings.loreDefaults);
    setLb((l) => ({ ...l, entries: [...l.entries, e] }));
    setSel({ kind: 'entry', id: e.id });
  };
  const addCategory = () => {
    const c = newLoreCategory({ name: t('New Category') });
    setLb((l) => ({ ...l, categories: [...l.categories, c] }));
    setSel({ kind: 'category', id: c.id });
  };
  const deleteEntries = (ids: string[]) => {
    setLb((l) => ({ ...l, entries: l.entries.filter((e) => !ids.includes(e.id)) }));
    if (sel?.kind === 'entry' && ids.includes(sel.id)) setSel(null);
  };

  const subset = (ids?: Set<string>): Lorebook => (ids ? { ...lb, entries: lb.entries.filter((e) => ids.has(e.id)) } : lb);
  const exportSelection = (ids?: Set<string>) => download(`${safeFileName(story.title)}.lorebook`, exportLorebook(subset(ids)));
  const pngTarget = useRef<Set<string> | undefined>(undefined);

  const renderEntry = (e: LoreEntry) => (
    <div
      key={e.id}
      className={`lore-item ${sel?.kind === 'entry' && sel.id === e.id ? 'active' : ''} ${e.enabled ? '' : 'disabled'}`}
      onClick={() => (multi ? setMulti(toggleSet(multi, e.id)) : setSel({ kind: 'entry', id: e.id }))}
    >
      <div className="row" style={{ gap: 8 }}>
        {multi && <span className={`checkbox ${multi.has(e.id) ? 'on' : ''}`} style={{ width: 18, height: 18 }}>{multi.has(e.id) && <Check size={12} weight="bold" />}</span>}
        <div className="name grow">{e.displayName || t('Unnamed Entry')}</div>
        {e.hidden && (
          <span title={t('Hidden Entry')} aria-label={t('Hidden Entry')} style={{ display: 'inline-flex', opacity: 0.7 }}>
            <EyeSlash size={14} />
          </span>
        )}
        {activeIds.has(e.id) && <span title={t('Active in current context')} style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--text-headings)', flex: 'none' }} />}
      </div>
      {e.hidden ? (
        <div className="keys">{t('Hidden Entry')}</div>
      ) : e.forceActivation ? (
        <div className="keys">{t('Always On')}</div>
      ) : e.keys.length ? (
        <div className="keys">{e.keys.join(', ')}</div>
      ) : (
        <div className="warn">
          <Warning size={14} weight="fill" /> {t('Entry has no keys.')}
        </div>
      )}
      {sel?.kind === 'entry' && sel.id === e.id && !multi && (
        <div className="item-actions" onClick={(ev) => ev.stopPropagation()}>
          <button type="button" aria-label={`Delete Lorebook Entry "${e.displayName}"`} onClick={() => deleteEntries([e.id])}>
            <Trash size={16} />
          </button>
          <button
            type="button"
            aria-label={t('Duplicate Entry')}
            onClick={() => {
              const copy = { ...structuredClone(e), id: uid(), displayName: `${e.displayName} (copy)` };
              setLb((l) => ({ ...l, entries: [...l.entries, copy] }));
              setSel({ kind: 'entry', id: copy.id });
            }}
          >
            <Copy size={16} />
          </button>
        </div>
      )}
    </div>
  );

  const uncategorized = entries.filter((e) => !e.category || !lb.categories.some((c) => c.id === e.category));
  const selEntry = sel?.kind === 'entry' ? lb.entries.find((e) => e.id === sel.id) : undefined;
  const selCat = sel?.kind === 'category' ? lb.categories.find((c) => c.id === sel.id) : undefined;

  return (
    <Modal onClose={onClose} width={docked ? 760 : 1136} className={`lore-modal ${docked ? 'docked' : ''}`} label={t('Lorebook')} docked={docked}>
      <div className="lore-side">
        <div className="lore-title">
          <span className="heading">
            <Book size={18} weight="fill" /> {t('Lorebook')}
          </span>
          <span className="row" style={{ gap: 10 }}>
            <button type="button" className="square-btn" aria-label={t('Import')} title={t('Import')} onClick={() => fileRef.current?.click()}>
              <UploadSimple size={16} />
            </button>
            <button type="button" className="square-btn" aria-label={t('Export')} title={t('Export')} onClick={() => exportSelection()}>
              <DownloadSimple size={16} />
            </button>
            <button type="button" className="square-btn" aria-label={t('Embed Lorebook in PNG')} title={t('Embed Lorebook in PNG')} onClick={() => pngRef.current?.click()}>
              <ImageIcon size={16} />
            </button>
            <button
              type="button"
              className={`square-btn ${docked ? 'active' : ''}`}
              aria-label={docked ? t('Undock Lorebook') : t('Dock Lorebook')}
              title={docked ? t('Undock Lorebook') : t('Dock Lorebook as a side panel')}
              aria-pressed={docked}
              onClick={() => useSettings.getState().set({ loreDocked: !docked })}
            >
              <SidebarSimple size={16} />
            </button>
          </span>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept=".lorebook,.json,.png"
            onChange={(e) => {
              if (e.target.files) void store.importFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={pngRef}
            type="file"
            hidden
            accept="image/png"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const out = embedPngLorebook(new Uint8Array(await f.arrayBuffer()), subset(pngTarget.current));
                pngTarget.current = undefined;
                download(`${safeFileName(story.title)}.png`, out.slice().buffer, 'image/png');
              } catch (err) {
                ui.toast((err as Error).message, 'error');
              }
            }}
          />
        </div>
        <div className="lib-head" style={{ borderBottomColor: 'var(--bg2)' }}>
          <span className="title">{t('Entries')}</span>
          <div className="tools">
            <button type="button" className="icon-btn" aria-label={t('Select')} onClick={() => setMulti(multi ? null : new Set())}>
              <CheckSquare size={20} />
            </button>
            <button type="button" className="icon-btn" aria-label={t('Sort by')} onClick={() => setSortOpen(!sortOpen)}>
              <Funnel size={20} />
            </button>
            <button type="button" className="icon-btn" aria-label={t('Search')} onClick={() => setSearchOpen(!searchOpen)}>
              <MagnifyingGlass size={20} weight="bold" />
            </button>
          </div>
        </div>
        {sortOpen && (
          <div className="lib-search">
            <Select
              value={sort}
              onChange={setSort}
              options={[
                { value: 'default', label: t('Default order') },
                { value: 'alpha', label: t('Alphabetical') },
                { value: 'recent', label: t('Most Recent') },
              ]}
            />
          </div>
        )}
        {searchOpen && (
          <div className="lib-search">
            <input autoFocus className="input" placeholder={t('Search Lorebook Entries')} aria-label={t('Search Lorebook Entries')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        {multi && (
          <div className="lib-search row" style={{ gap: 6 }}>
            <span className="grow" style={{ fontSize: 13 }}>{multi.size} {t('selected')}</span>
            <button type="button" className="btn small" onClick={() => setMulti(new Set(entries.map((e) => e.id)))}>
              {t('All')}
            </button>
            <button type="button" className="btn small" disabled={!multi.size} onClick={() => exportSelection(multi)} title={t('Export Selected')}>
              {t('Export Selected')}
            </button>
            <button
              type="button"
              className="btn small"
              disabled={!multi.size}
              title={t('Export Selected to PNG')}
              onClick={() => {
                pngTarget.current = new Set(multi);
                pngRef.current?.click();
              }}
            >
              {t('PNG')}
            </button>
            <button
              type="button"
              className="btn small danger"
              disabled={!multi.size}
              onClick={async () => {
                if (await ui.confirm({ title: t('Delete Selected?'), message: t('Delete {n} entries?', { n: multi.size }), danger: true, confirmLabel: t('Delete') })) {
                  deleteEntries([...multi]);
                  setMulti(new Set());
                }
              }}
            >
              {t('Delete')}
            </button>
          </div>
        )}
        <div className="lore-list">
          {uncategorized.map(renderEntry)}
          {lb.categories.map((c) => {
            const children = entries.filter((e) => e.category === c.id);
            return (
              <div key={c.id} className="lore-cat">
                <div className={`cat-head ${sel?.kind === 'category' && sel.id === c.id ? 'active' : ''}`} style={sel?.kind === 'category' && sel.id === c.id ? { background: 'var(--bg2)' } : undefined} onClick={() => setSel({ kind: 'category', id: c.id })}>
                  <div className="row between">
                    <span style={{ fontWeight: 600, opacity: c.enabled ? 1 : 0.5 }}>{c.name || t('Unnamed Category')}</span>
                    <span className="row" style={{ gap: 12 }} onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="icon-btn" aria-label={t('Add Entry to Category')} title={t('Add Entry to Category')} onClick={() => addEntry(c.id)}>
                        <Plus size={18} weight="bold" />
                      </button>
                      <button type="button" className="icon-btn" aria-label={c.open ? t('Minimize') : t('Expand')} title={c.open ? t('Minimize') : t('Expand')} onClick={() => updateCat(c.id, { open: !c.open })}>
                        {c.open ? <CaretUp size={16} weight="fill" /> : <CaretDown size={16} weight="fill" />}
                      </button>
                    </span>
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>{t('{n} entries', { n: children.length })}</div>
                  {sel?.kind === 'category' && sel.id === c.id && (
                    <div className="lore-item" style={{ padding: 0, border: 0, marginTop: 8 }}>
                      <div className="item-actions" style={{ marginTop: 0 }} onClick={(ev) => ev.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={t('Delete')}
                          onClick={async () => {
                            if (await ui.confirm({ title: t('Delete Category?'), message: t('Entries in this category will be kept without a category. To delete them too, use Delete Containing Entries in the category settings first.'), danger: true, confirmLabel: t('Delete') })) {
                              setLb((l) => ({ ...l, categories: l.categories.filter((x) => x.id !== c.id), entries: l.entries.map((e) => (e.category === c.id ? { ...e, category: null } : e)) }));
                              setSel(null);
                            }
                          }}
                        >
                          <Trash size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {c.open && <div className="cat-children">{children.map(renderEntry)}</div>}
              </div>
            );
          })}
          {lb.entries.length === 0 && lb.categories.length === 0 && <div className="muted" style={{ padding: 20, fontSize: 14 }}>{t('No entries yet. Add one below.')}</div>}
          {search && entries.length === 0 && <div className="muted" style={{ padding: 20, fontSize: 14 }}>{t('No entries match your search.')}</div>}
        </div>
        <div className="lore-bottom">
          <button type="button" className="btn" style={{ background: 'var(--bg3)' }} onClick={() => addEntry(null)}>
            <Plus size={16} weight="bold" /> {t('Entry')}
          </button>
          <button type="button" className="btn dark" style={{ border: '1px solid var(--bg2)' }} onClick={addCategory}>
            <Plus size={16} weight="bold" /> {t('Category')}
          </button>
        </div>
      </div>
      <div className="lore-main">
        {selEntry ? (
          <EntryEditor key={selEntry.id} entry={selEntry} categories={lb.categories} update={(p) => updateEntry(selEntry.id, p)} onClose={onClose} active={activeIds.has(selEntry.id)} generate={selEntry.id === entryId ? generate : undefined} />
        ) : selCat ? (
          <CategoryEditor key={selCat.id} cat={selCat} update={(p) => updateCat(selCat.id, p)} onClose={onClose} />
        ) : (
          <LoreWelcome orderByKey={lb.settings.orderByKeyLocations} setOrderByKey={(v) => setLb((l) => ({ ...l, settings: { ...l.settings, orderByKeyLocations: v } }))} total={lb.entries.length} active={activeIds.size} categories={lb.categories.length} onClose={onClose} onAddEntry={() => addEntry(null)} onAddCategory={addCategory} onImport={() => fileRef.current?.click()} />
        )}
      </div>
    </Modal>
  );
}

function LoreWelcome({ orderByKey, setOrderByKey, total, active, categories, onClose, onAddEntry, onAddCategory, onImport }: { orderByKey: boolean; setOrderByKey: (v: boolean) => void; total: number; active: number; categories: number; onClose: () => void; onAddEntry: () => void; onAddCategory: () => void; onImport: () => void }) {
  return (
    <div className="lore-welcome">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <h2 className="lore-welcome-title">
          <Book size={26} weight="fill" /> {t('Welcome to the Lorebook')}
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}>
          <X size={22} weight="bold" />
        </button>
      </div>
      <p>{t('The Lorebook is where you keep the details of your world: characters, places, factions, objects and ideas. Each entry has Activation Keys; when a key appears in the recent story, the entry is added to the context so the AI remembers it.')}</p>
      <ul>
        <li>{t('Keep entries short and factual. Start with the name of the subject.')}</li>
        <li>{t('Use several keys for names and nicknames. Keys are case-insensitive; /regex/ and A & B keys are supported.')}</li>
        <li>{t('Group entries in categories to share settings, headers and subcontexts.')}</li>
        <li>{t('Always On entries are always in the context; use them sparingly.')}</li>
      </ul>
      <div className="lore-welcome-stats">
        <span>
          <b>{total}</b> {t('entries')}
        </span>
        <span>
          <b>{active}</b> {t('active now')}
        </span>
        <span>
          <b>{categories}</b> {t('categories')}
        </span>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn primary" onClick={onAddEntry}>
          <Plus size={14} weight="bold" /> {t('New Entry')}
        </button>
        <button type="button" className="btn" onClick={onAddCategory}>
          <Plus size={14} weight="bold" /> {t('New Category')}
        </button>
        <button type="button" className="btn" onClick={onImport}>
          <UploadSimple size={14} /> {t('Import')}
        </button>
      </div>
      <div className="desc">{t('Select an entry on the left to edit it. You can also import SillyTavern, Agnai and AI Dungeon lorebooks.')}</div>
      <div className="heading">{t('Lorebook Settings')}</div>
      <ToggleRow
        title={t('Order by Key Location')}
        desc={orderByKey ? t('Entries with the same priority are inserted in the order their keys appear in the story.') : t('Entries with the same priority are inserted in lorebook order.')}
        on={orderByKey}
        onChange={setOrderByKey}
      />
    </div>
  );
}

function KeyChip({ k, hit, onChange, onRemove }: { k: string; hit: boolean; onChange: (v: string) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(k);
  const regex = isRegexKey(k);
  const invalid = regex && !compileRegexKey(k);
  if (editing) {
    return (
      <span className={`key-chip editing ${regex ? 'regex' : ''}`}>
        <input
          autoFocus
          value={draft}
          aria-label={t('Edit key')}
          title={t('Press Enter to save edit')}
          size={Math.max(4, draft.length)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (draft.trim()) onChange(draft.trim());
              setEditing(false);
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(k);
              setEditing(false);
            }
          }}
        />
      </span>
    );
  }
  return (
    <span className={`key-chip ${regex ? 'regex' : ''} ${hit ? 'active' : ''}`} title={invalid ? t('Invalid regex') : hit ? t('Found in recent story') : t('Click a key to edit it.')} style={invalid ? { outline: '1px solid var(--warning)' } : undefined}>
      <button type="button" className="key-text" onClick={() => (setDraft(k), setEditing(true))} aria-label={`${t('Edit key')} ${k}`}>
        {k}
      </button>
      <button type="button" aria-label={t('Remove')} onClick={onRemove}>
        <X size={12} />
      </button>
    </span>
  );
}

function toggleSet(s: Set<string>, id: string): Set<string> {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}

function EntryEditor({ entry, categories, update, onClose, active, generate }: { entry: LoreEntry; categories: LoreCategory[]; update: (p: Partial<LoreEntry>) => void; onClose: () => void; active: boolean; generate?: string }) {
  const [tab, setTab] = useState<'entry' | 'placement' | 'bias' | 'conditions' | 'script'>('entry');
  const scriptPanels = useScripts((x) => x.extensions).some((e) => e.type === 'lorebookPanel');
  const [genOpen, setGenOpen] = useState(!!generate);
  const story = useStory((s) => s.current)!;
  const recent = entry.searchRange > 0 ? docText(story.doc).slice(-entry.searchRange) : '';
  const [revealed, setRevealed] = useState(false);
  if (entry.hidden && !revealed) {
    return (
      <>
        <div className="lore-head">
          <span className="lore-name" style={{ opacity: 0.6 }}>{t('Hidden Entry')}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}>
            <X size={24} weight="bold" />
          </button>
        </div>
        <div className="lore-hidden">
          <EyeSlash size={40} weight="thin" />
          <p>{t("This lorebook entry is hidden. Its contents are kept out of sight so they don't spoil the story; the entry still works as usual.")}</p>
          <button type="button" className="btn" onClick={() => setRevealed(true)}>
            <Eye size={14} /> {t('Reveal Entry')}
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="lore-head">
        <input className="lore-name" value={entry.displayName} placeholder={t('Unnamed Entry')} onChange={(e) => update({ displayName: e.target.value })} aria-label={t('Entry name')} />
        <button type="button" className="title-btn" style={{ height: 36 }} aria-label={entry.hidden ? t('Unhide Entry') : t('Hide Entry')} title={entry.hidden ? t('Hidden Entry: its text is concealed in the Lorebook until revealed.') : t('Hide Entry')} onClick={() => {
            if (!entry.hidden) setRevealed(true);
            update({ hidden: !entry.hidden });
          }}>
          {entry.hidden ? <EyeSlash size={18} /> : <Eye size={18} />}
        </button>
        <button type="button" className={`enabled-btn ${entry.enabled ? '' : 'off'}`} onClick={() => update({ enabled: !entry.enabled })} aria-pressed={entry.enabled}>
          {entry.enabled ? <Check size={14} weight="bold" /> : <X size={14} weight="bold" />} {entry.enabled ? t('Enabled') : t('Disabled')}
        </button>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}>
          <X size={24} weight="bold" />
        </button>
      </div>
      <Tabs
        className="lore-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'entry', label: t('Entry') },
          { value: 'conditions', label: t('Advanced Conditions') },
          { value: 'placement', label: t('Placement') },
          { value: 'bias', label: t('Phrase Bias') },
          ...(scriptPanels ? [{ value: 'script' as const, label: t('Script') }] : []),
        ]}
      />
      <div className="lore-body">
        {tab === 'script' && <ScriptPanels type="lorebookPanel" />}
        {tab === 'entry' && (
          <>
            <div>
              <div className="row between">
                <span className="heading">{t('Entry Text')}</span>
                <span className="row" style={{ gap: 6, position: 'relative' }}>
                  <button type="button" className="link-btn" style={{ fontWeight: 600 }} onClick={() => setGenOpen(!genOpen)}>
                    <Lightbulb size={18} /> {t('Generator')} {genOpen ? <CaretUp size={12} weight="fill" /> : <CaretDown size={12} weight="fill" />}
                  </button>
                  <span title={t('Generate entry text with the AI.')} style={{ opacity: 0.6, display: 'inline-flex' }}>
                    <Question size={14} />
                  </span>
                </span>
              </div>
              <div className="desc" style={{ margin: '4px 0 10px', opacity: 1 }}>{t('The following text will be referenced when the Keys are activated.')}</div>
              {genOpen && <LoreGenerator entry={entry} onResult={(text) => update({ text })} autoType={generate} />}
              <div className="field-box">
                <textarea
                  value={entry.text}
                  placeholder={t('Type information about the entry here.')}
                  onChange={(e) => update({ text: e.target.value })}
                  style={{ minHeight: 195, fontSize: 15 }}
                  aria-label={t('Entry Text')}
                />
                <span className="tokens">
                  {countTokens(entry.text)} {t('Tokens')}
                </span>
              </div>
            </div>
            <div>
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="heading">{t('Activation Keys')}</span>
                    <span title={t('Keys are case-insensitive. Wrap in /slashes/ for regex. Use A & B to require both.')} style={{ opacity: 0.6, display: 'inline-flex' }}>
                      <Question size={14} />
                    </span>
                  </div>
                  <div className="desc" style={{ marginTop: 4, opacity: 1 }}>{t('Activates the entry when found within the recent story.')}</div>
                </div>
                <button type="button" title={t('Always On entries are always included in the context, regardless of keys.')} className={`btn ${entry.forceActivation ? 'primary' : 'dark'}`} style={{ border: '1px solid var(--bg1)', fontWeight: 700 }} onClick={() => update({ forceActivation: !entry.forceActivation })} aria-pressed={entry.forceActivation}>
                  {entry.forceActivation ? <Check size={12} weight="bold" /> : <X size={12} weight="bold" />} {t('Always On')}
                </button>
              </div>
              <div className="keys-box" style={{ marginTop: 10 }}>
                <EnterInput placeholder={t('Type a key here and hit enter to save it')} ariaLabel="save key" onSubmit={(v) => update({ keys: [...entry.keys, v.trim()] })} />
                <div className="chips" style={entry.keys.length ? undefined : { justifyContent: 'center', alignItems: 'center' }}>
                  {entry.keys.length === 0 && <b>{t('No Keys set.')}</b>}
                  {entry.keys.map((k, i) => {
                    let hit = false;
                    try {
                      const re = compileRegexKey(k);
                      hit = re ? re.test(recent) : k.split('&').every((part) => recent.toLowerCase().includes(part.trim().toLowerCase()));
                    } catch {
                      /* ignore */
                    }
                    return (
                      <KeyChip
                        key={`${i}:${k}`}
                        k={k}
                        hit={hit && active}
                        onChange={(v) => update({ keys: entry.keys.map((x, j) => (j === i ? v : x)) })}
                        onRemove={() => update({ keys: entry.keys.filter((_, j) => j !== i) })}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
            <div style={{ maxWidth: 302 }}>
              <div className="heading" style={{ marginBottom: 8 }}>{t('Category')}</div>
              <Select
                value={entry.category ?? '__none'}
                onChange={(v) => update({ category: v === '__none' ? null : v })}
                options={[{ value: '__none', label: t('No Category') }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </div>
          </>
        )}
        {tab === 'placement' && (
          <>
            <div className="placement-grid">
              <label className="number-field">
                <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Search Range')}</span>
                <input className="input" type="number" min={0} max={MAX_SEARCH_RANGE} value={entry.searchRange} onChange={(e) => update({ searchRange: Math.min(MAX_SEARCH_RANGE, Math.max(0, Number(e.target.value))) })} />
                <span className="desc">{t('Characters from the end of the story searched for keys (up to 50,000). 0 turns story key search off.')}</span>
              </label>
            </div>
            <ToggleRow title={t('Key-Relative Insertion')} desc={t('Inserts the entry relative to the last matching key. Positive positions go after the key, negative before it.')} on={entry.keyRelative} onChange={(v) => update({ keyRelative: v })} />
            <ToggleRow title={t('Cascading Activation')} desc={t("Lets this entry's keys be found in Memory, Author's Note and other active entries.")} on={entry.nonStoryActivatable} onChange={(v) => update({ nonStoryActivatable: v })} />
            <ToggleRow title={t('Prevent Further Cascading')} desc={t("This entry's text never activates other entries.")} on={!!entry.preventRecursion} onChange={(v) => update({ preventRecursion: v || undefined })} />
            <ToggleRow title={t('Match Case')} desc={t('Keys only match with the same upper and lower case.')} on={!!entry.caseSensitive} onChange={(v) => update({ caseSensitive: v || undefined })} />
            <ToggleRow title={t('Whole Words Only')} desc={t('Keys only match whole words, not parts of longer words. Ignored for Chinese, Japanese and Korean keys.')} on={!!entry.wholeWords} onChange={(v) => update({ wholeWords: v || undefined })} />
            <div className="heading" style={{ marginTop: 8 }}>{t('Timing & Chance')}</div>
            <div className="placement-grid">
              <LoreNumber label={t('Probability (%)')} desc={t('Chance the entry activates when its keys match.')} value={entry.probability ?? 100} min={0} max={100} def={100} onChange={(v) => update({ probability: v })} />
              <LoreNumber label={t('Sticky')} desc={t('Stays active for this many generations after it activates.')} value={entry.sticky ?? 0} min={0} max={1000} def={0} onChange={(v) => update({ sticky: v })} />
              <LoreNumber label={t('Cooldown')} desc={t("Can't activate again for this many generations after it was active.")} value={entry.cooldown ?? 0} min={0} max={1000} def={0} onChange={(v) => update({ cooldown: v })} />
              <LoreNumber label={t('Delay')} desc={t("Can't activate before the story has this many generations.")} value={entry.delay ?? 0} min={0} max={100000} def={0} onChange={(v) => update({ delay: v })} />
            </div>
            <div className="heading" style={{ marginTop: 8 }}>{t('Inclusion Group')}</div>
            <div className="placement-grid">
              <label className="number-field">
                <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Group')}</span>
                <input className="input" value={entry.group ?? ''} placeholder={t('None')} onChange={(e) => update({ group: e.target.value || undefined })} />
                <span className="desc">{t('When several entries of a group activate, only one is kept. Separate several groups with commas.')}</span>
              </label>
              <LoreNumber label={t('Group Weight')} desc={t('Relative chance of being the entry kept.')} value={entry.groupWeight ?? 100} min={0} max={10000} def={100} onChange={(v) => update({ groupWeight: v })} />
            </div>
            {entry.group?.trim() && <ToggleRow title={t('Prioritize in Group')} desc={t('Keep the entry with the highest Insertion Order instead of a weighted random pick.')} on={!!entry.groupPrioritize} onChange={(v) => update({ groupPrioritize: v || undefined })} />}
            <ContextConfigEditor value={entry.contextConfig} onChange={(c) => update({ contextConfig: c })} />
          </>
        )}
        {tab === 'bias' && (
          <>
            <div className="desc" style={{ opacity: 1 }}>{t('Biases apply while this entry is active (or inactive, if set).')}</div>
            <PhraseBiasEditor groups={entry.loreBiasGroups} onChange={(g) => update({ loreBiasGroups: g })} showWhenInactive />
          </>
        )}
        {tab === 'conditions' && <ConditionsEditor conditions={entry.conditions} onChange={(c) => update({ conditions: c })} />}
      </div>
    </>
  );
}

/** A number field for an optional lore setting; the default value clears it. */
function LoreNumber({ label, desc, value, min, max, def, onChange }: { label: string; desc: string; value: number; min: number; max: number; def: number; onChange: (v: number | undefined) => void }) {
  return (
    <label className="number-field">
      <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = Math.min(max, Math.max(min, Math.round(Number(e.target.value) || 0)));
          onChange(v === def ? undefined : v);
        }}
      />
      <span className="desc">{desc}</span>
    </label>
  );
}

function CategoryEditor({ cat, update, onClose }: { cat: LoreCategory; update: (p: Partial<LoreCategory>) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'settings' | 'defaults' | 'subcontext' | 'bias'>('settings');
  const store = useStory.getState();
  const count = useStory((s) => s.current?.lorebook.entries.filter((e) => e.category === cat.id).length ?? 0);
  const defaults = cat.categoryDefaults;
  const setDefaults = (p: Partial<LoreEntry>) => update({ categoryDefaults: { ...defaults, ...p } });
  return (
    <>
      <div className="lore-head">
        <input className="lore-name" value={cat.name} placeholder={t('Unnamed Category')} onChange={(e) => update({ name: e.target.value })} aria-label={t('Category name')} />
        <button type="button" className={`enabled-btn ${cat.enabled ? '' : 'off'}`} onClick={() => update({ enabled: !cat.enabled })}>
          {cat.enabled ? <Check size={14} weight="bold" /> : <X size={14} weight="bold" />} {cat.enabled ? t('Enabled') : t('Disabled')}
        </button>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}>
          <X size={24} weight="bold" />
        </button>
      </div>
      <Tabs
        className="lore-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'settings', label: t('Settings') },
          { value: 'defaults', label: t('Defaults') },
          { value: 'subcontext', label: t('Subcontext Settings') },
          { value: 'bias', label: t('Phrase Bias') },
        ]}
      />
      <div className="lore-body">
        {tab === 'settings' && (
          <>
            <ToggleRow title={t('Enable Lorebook Category')} desc={cat.enabled ? t('Entries in this category can activate.') : t('No entry in this category will activate.')} on={cat.enabled} onChange={(v) => update({ enabled: v })} />
            <div>
              <div className="heading">{t('Lorebook Entry Header')}</div>
              <div style={{ margin: '4px 0 12px' }}>{t('The text entered here will be automatically placed above any entry in this category.')}</div>
              <input className="input" style={{ height: 42 }} placeholder={t('Enter default entry header...')} value={cat.entryHeader} onChange={(e) => update({ entryHeader: e.target.value })} />
            </div>
            <div>
              <div className="heading">{t('Delete Containing Entries')}</div>
              <div style={{ margin: '4px 0 12px' }}>{t('Deletes every entry in this category ({n}). The category itself stays.', { n: count })}</div>
              <button
                type="button"
                className="btn danger"
                disabled={!count}
                onClick={async () => {
                  if (await useUI.getState().confirm({ title: t('Delete Containing Entries?'), message: t('Delete {n} entries?', { n: count }), danger: true, confirmLabel: t('Delete') }))
                    store.update((s) => void (s.lorebook = { ...s.lorebook, entries: s.lorebook.entries.filter((e) => e.category !== cat.id) }));
                }}
              >
                <Trash size={14} /> {t('Delete Containing Entries')}
              </button>
            </div>
          </>
        )}
        {tab === 'defaults' && (
          <>
            <ToggleRow title={t('Use Category Defaults')} desc={t('New entries in this category start with these settings.')} on={cat.useCategoryDefaults} onChange={(v) => update({ useCategoryDefaults: v })} />
            <div className="heading">{t('Default Entry Settings')}</div>
            <label className="number-field" style={{ maxWidth: 240 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Search Range')}</span>
              <input
                className="input"
                type="number"
                min={0}
                max={MAX_SEARCH_RANGE}
                value={defaults.searchRange ?? 1000}
                onChange={(e) => setDefaults({ searchRange: Math.min(MAX_SEARCH_RANGE, Math.max(0, Number(e.target.value))) })}
              />
            </label>
            <ToggleRow title={t('Always On')} on={!!defaults.forceActivation} onChange={(v) => setDefaults({ forceActivation: v })} />
            <ToggleRow title={t('Key-Relative Insertion')} on={!!defaults.keyRelative} onChange={(v) => setDefaults({ keyRelative: v })} />
            <ToggleRow title={t('Cascading Activation')} on={!!defaults.nonStoryActivatable} onChange={(v) => setDefaults({ nonStoryActivatable: v })} />
            <div className="heading">{t('Default Placement Settings')}</div>
            <ContextConfigEditor value={{ ...store.current!.contextSettings.loreDefaults, ...(defaults.contextConfig ?? {}) }} onChange={(c) => setDefaults({ contextConfig: c })} />
            <button
              type="button"
              className="btn"
              disabled={!count}
              onClick={async () => {
                if (!(await useUI.getState().confirm({ title: t('Update All Entries?'), message: t('Apply these default settings to the {n} entries in this category?', { n: count }), confirmLabel: t('Update') }))) return;
                const { searchRange, forceActivation, keyRelative, nonStoryActivatable, contextConfig } = defaults;
                const patch: Partial<LoreEntry> = Object.fromEntries(Object.entries({ searchRange, forceActivation, keyRelative, nonStoryActivatable }).filter(([, v]) => v !== undefined));
                store.update((s) => {
                  s.lorebook = {
                    ...s.lorebook,
                    entries: s.lorebook.entries.map((e) => (e.category === cat.id ? { ...e, ...patch, ...(contextConfig ? { contextConfig: { ...contextConfig } } : {}), lastUpdatedAt: Date.now() } : e)),
                  };
                });
              }}
            >
              {t('Update All Entries')}
            </button>
          </>
        )}
        {tab === 'subcontext' && (
          <>
            <ToggleRow title={t('Create Subcontext')} desc={t('Groups the active entries of this category and inserts them together using the settings below.')} on={cat.createSubcontext} onChange={(v) => update({ createSubcontext: v })} />
            <ContextConfigEditor value={cat.subcontextSettings} onChange={(c) => update({ subcontextSettings: c })} />
          </>
        )}
        {tab === 'bias' && <PhraseBiasEditor groups={cat.categoryBiasGroups} onChange={(g) => update({ categoryBiasGroups: g })} showWhenInactive />}
      </div>
    </>
  );
}
