import { useMemo, useRef, useState } from 'react';
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
  Plus,
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
} from '@novelwriter/core';
import { download, safeFileName, useStory } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { EnterInput, Modal, Select, Tabs, ToggleRow } from '../../components/ui.tsx';
import { ContextConfigEditor } from './ContextConfigEditor.tsx';
import { ConditionsEditor } from './ConditionsEditor.tsx';
import { LoreGenerator } from './LoreGenerator.tsx';
import { PhraseBiasEditor } from '../right/PhraseBiasEditor.tsx';

type Selection = { kind: 'entry'; id: string } | { kind: 'category'; id: string } | null;

export function LorebookModal({ onClose, entryId, generate }: { onClose: () => void; entryId?: string; generate?: string }) {
  const story = useStory((s) => s.current)!;
  const store = useStory.getState();
  const ui = useUI.getState();
  const lb = story.lorebook;
  const [sel, setSel] = useState<Selection>(entryId ? { kind: 'entry', id: entryId } : lb.entries[0] ? { kind: 'entry', id: lb.entries[0].id } : null);
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

  const exportSelection = (ids?: Set<string>) => {
    const sub: Lorebook = ids ? { ...lb, entries: lb.entries.filter((e) => ids.has(e.id)) } : lb;
    download(`${safeFileName(story.title)}.lorebook`, exportLorebook(sub));
  };

  const renderEntry = (e: LoreEntry) => (
    <div
      key={e.id}
      className={`lore-item ${sel?.kind === 'entry' && sel.id === e.id ? 'active' : ''} ${e.enabled ? '' : 'disabled'}`}
      onClick={() => (multi ? setMulti(toggleSet(multi, e.id)) : setSel({ kind: 'entry', id: e.id }))}
    >
      <div className="row" style={{ gap: 8 }}>
        {multi && <span className={`checkbox ${multi.has(e.id) ? 'on' : ''}`} style={{ width: 18, height: 18 }}>{multi.has(e.id) && <Check size={12} weight="bold" />}</span>}
        <div className="name grow">{e.displayName || t('Unnamed')}</div>
        {activeIds.has(e.id) && <span title={t('Active in current context')} style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--text-headings)', flex: 'none' }} />}
      </div>
      {e.forceActivation ? (
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
    <Modal onClose={onClose} width={1136} className="lore-modal" label={t('Lorebook')}>
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
                const out = embedPngLorebook(new Uint8Array(await f.arrayBuffer()), lb);
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
            <button type="button" className="icon-btn" aria-label="Start Multiselect Operation" title={t('Select')} onClick={() => setMulti(multi ? null : new Set())}>
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
            <input autoFocus className="input" placeholder={t('Search for an entry')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        {multi && (
          <div className="lib-search row" style={{ gap: 6 }}>
            <span className="grow" style={{ fontSize: 13 }}>{multi.size} {t('selected')}</span>
            <button type="button" className="btn small" onClick={() => setMulti(new Set(entries.map((e) => e.id)))}>
              {t('All')}
            </button>
            <button type="button" className="btn small" disabled={!multi.size} onClick={() => exportSelection(multi)}>
              {t('Export')}
            </button>
            <button
              type="button"
              className="btn small danger"
              disabled={!multi.size}
              onClick={async () => {
                if (await ui.confirm({ title: t('Delete'), message: t('Delete {n} entries?', { n: multi.size }), danger: true, confirmLabel: t('Delete') })) {
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
                    <span style={{ fontWeight: 600, opacity: c.enabled ? 1 : 0.5 }}>{c.name}</span>
                    <span className="row" style={{ gap: 12 }} onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="icon-btn" aria-label={t('Add')} onClick={() => addEntry(c.id)}>
                        <Plus size={18} weight="bold" />
                      </button>
                      <button type="button" className="icon-btn" aria-label={c.open ? t('Collapse') : t('Expand')} onClick={() => updateCat(c.id, { open: !c.open })}>
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
                            if (await ui.confirm({ title: t('Delete Category'), message: t('Entries in this category will be kept without a category.'), danger: true, confirmLabel: t('Delete') })) {
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
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div className="empty-state" style={{ minHeight: 300 }}>{t('Select or create an entry.')}</div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}>
              <X size={22} weight="bold" />
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function toggleSet(s: Set<string>, id: string): Set<string> {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}

function EntryEditor({ entry, categories, update, onClose, active, generate }: { entry: LoreEntry; categories: LoreCategory[]; update: (p: Partial<LoreEntry>) => void; onClose: () => void; active: boolean; generate?: string }) {
  const [tab, setTab] = useState<'entry' | 'placement' | 'bias' | 'conditions'>('entry');
  const [genOpen, setGenOpen] = useState(!!generate);
  const story = useStory((s) => s.current)!;
  const recent = docText(story.doc).slice(-entry.searchRange);
  return (
    <>
      <div className="lore-head">
        <input className="lore-name" value={entry.displayName} onChange={(e) => update({ displayName: e.target.value })} aria-label={t('Entry name')} />
        <button type="button" className="title-btn" style={{ height: 36 }} aria-label={entry.hidden ? t('Show') : t('Hide')} title={t('Hidden')} onClick={() => update({ hidden: !entry.hidden })}>
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
        ]}
      />
      <div className="lore-body">
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
                <button type="button" className={`btn ${entry.forceActivation ? 'primary' : 'dark'}`} style={{ border: '1px solid var(--bg1)', fontWeight: 700 }} onClick={() => update({ forceActivation: !entry.forceActivation })} aria-pressed={entry.forceActivation}>
                  {entry.forceActivation ? <Check size={12} weight="bold" /> : <X size={12} weight="bold" />} {t('Always On')}
                </button>
              </div>
              <div className="keys-box" style={{ marginTop: 10 }}>
                <EnterInput placeholder={t('Type a key here and hit enter to save it')} ariaLabel="save key" onSubmit={(v) => update({ keys: [...entry.keys, v.trim()] })} />
                <div className="chips" style={entry.keys.length ? undefined : { justifyContent: 'center', alignItems: 'center' }}>
                  {entry.keys.length === 0 && <b>{t('No Keys set.')}</b>}
                  {entry.keys.map((k, i) => {
                    const regex = isRegexKey(k);
                    const invalid = regex && !compileRegexKey(k);
                    let hit = false;
                    try {
                      const re = compileRegexKey(k);
                      hit = re ? re.test(recent) : k.split('&').every((part) => recent.toLowerCase().includes(part.trim().toLowerCase()));
                    } catch {
                      /* ignore */
                    }
                    return (
                      <span key={i} className={`key-chip ${regex ? 'regex' : ''} ${hit && active ? 'active' : ''}`} title={invalid ? t('Invalid regex') : hit ? t('Found in recent story') : ''} style={invalid ? { outline: '1px solid var(--warning)' } : undefined}>
                        {k}
                        <button type="button" aria-label={t('Remove')} onClick={() => update({ keys: entry.keys.filter((_, j) => j !== i) })}>
                          <X size={12} />
                        </button>
                      </span>
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
                <input className="input" type="number" min={0} max={10000} value={entry.searchRange} onChange={(e) => update({ searchRange: Math.min(10000, Math.max(0, Number(e.target.value))) })} />
              </label>
            </div>
            <ToggleRow title={t('Key-Relative Insertion')} desc={t('Inserts the entry relative to the last matching key. Positive positions go after the key, negative before it.')} on={entry.keyRelative} onChange={(v) => update({ keyRelative: v })} />
            <ToggleRow title={t('Cascading Activation')} desc={t("Lets this entry's keys be found in Memory, Author's Note and other active entries.")} on={entry.nonStoryActivatable} onChange={(v) => update({ nonStoryActivatable: v })} />
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

function CategoryEditor({ cat, update, onClose }: { cat: LoreCategory; update: (p: Partial<LoreCategory>) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'settings' | 'defaults' | 'subcontext' | 'bias'>('settings');
  const store = useStory.getState();
  return (
    <>
      <div className="lore-head">
        <input className="lore-name" value={cat.name} onChange={(e) => update({ name: e.target.value })} aria-label={t('Category name')} />
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
          { value: 'subcontext', label: t('Subcontext') },
          { value: 'bias', label: t('Phrase Bias') },
        ]}
      />
      <div className="lore-body">
        {tab === 'settings' && (
          <div>
            <div className="heading">{t('Lorebook Entry Header')}</div>
            <div style={{ margin: '4px 0 12px' }}>{t('The text entered here will be automatically placed above any entry in this category.')}</div>
            <input className="input" style={{ height: 42 }} placeholder={t('Enter default entry header...')} value={cat.entryHeader} onChange={(e) => update({ entryHeader: e.target.value })} />
          </div>
        )}
        {tab === 'defaults' && (
          <>
            <ToggleRow title={t('Use Category Defaults')} desc={t('New entries in this category start with these placement settings.')} on={cat.useCategoryDefaults} onChange={(v) => update({ useCategoryDefaults: v })} />
            <ContextConfigEditor
              value={{ ...store.current!.contextSettings.loreDefaults, ...(cat.categoryDefaults.contextConfig ?? {}) }}
              onChange={(c) => update({ categoryDefaults: { ...cat.categoryDefaults, contextConfig: c } })}
            />
            <button
              type="button"
              className="btn"
              onClick={() =>
                store.update((s) => {
                  s.lorebook = { ...s.lorebook, entries: s.lorebook.entries.map((e) => (e.category === cat.id && cat.categoryDefaults.contextConfig ? { ...e, contextConfig: { ...cat.categoryDefaults.contextConfig } } : e)) };
                })
              }
            >
              {t('Apply defaults to all entries in this category')}
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
