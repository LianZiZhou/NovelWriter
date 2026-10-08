import { useMemo, useRef, useState } from 'react';
import {
  Books,
  CaretLeft,
  Copy,
  DownloadSimple,
  Funnel,
  GearSix,
  Heart,
  MagnifyingGlass,
  Paperclip,
  PencilSimple,
  Plus,
  Trash,
  UploadSimple,
  UserCircle,
  ArrowLeft,
} from '@phosphor-icons/react';
import { uid, type StoryMeta } from '@novelwriter/core';
import { useStory } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { timeAgo, Select } from '../../components/ui.tsx';
import { Logo } from '../../components/Logo.tsx';

function StoryCard({ meta, active }: { meta: StoryMeta; active: boolean }) {
  const store = useStory.getState();
  const ui = useUI.getState();
  return (
    <div className={`story-card ${active ? 'active' : ''}`} onClick={() => void store.openStory(meta.id)} data-story-id={meta.id}>
      <div className="card-body">
        <div className="card-title">
          <span className="name">{meta.title || t('New Story')}</span>
          <span className="card-icons" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="icon-btn"
              aria-label={t('Edit Story Information')}
              title={t('Edit Story Information')}
              onClick={async () => {
                await store.openStory(meta.id);
                ui.open('storyInfo');
              }}
            >
              <PencilSimple size={17} weight="fill" />
            </button>
            <button
              type="button"
              className={`icon-btn ${meta.favorite ? 'fav-on' : ''}`}
              aria-label={t('Favorite')}
              aria-pressed={meta.favorite}
              onClick={() => void store.setFavorite(meta.id, !meta.favorite)}
              style={meta.favorite ? { color: 'var(--text-headings)' } : undefined}
            >
              <Heart size={18} weight={meta.favorite ? 'fill' : 'regular'} />
            </button>
          </span>
        </div>
        <div className="card-preview">{meta.preview || meta.description || ' '}</div>
      </div>
      {active && (
        <div className="card-foot" onClick={(e) => e.stopPropagation()}>
          <span className="time">
            {timeAgo(meta.updatedAt)}
            <Paperclip size={14} />
          </span>
          <button type="button" className="fbtn" aria-label={t('Duplicate Story')} title={t('Duplicate Story')} onClick={() => void store.duplicateStory(meta.id)}>
            <Copy size={16} />
          </button>
          <button type="button" className="fbtn" aria-label={t('Download Story')} title={t('Download Story')} onClick={() => void store.downloadStory(meta.id)}>
            <DownloadSimple size={16} />
          </button>
          <button
            type="button"
            className="fbtn"
            aria-label={t('Delete Story')}
            title={t('Delete Story')}
            onClick={async () => {
              if (await ui.confirm({ title: t('Delete Story'), message: t('Delete "{name}"? This cannot be undone.', { name: meta.title }), confirmLabel: t('Delete'), danger: true })) {
                await store.deleteStory(meta.id);
              }
            }}
          >
            <Trash size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export function LeftSidebar({ onCollapse, mobileOpen }: { onCollapse: () => void; mobileOpen: boolean }) {
  const library = useStory((s) => s.library);
  const shelves = useStory((s) => s.shelves);
  const activeShelf = useStory((s) => s.activeShelf);
  const currentId = useStory((s) => s.current?.id);
  const sort = useSettings((s) => s.librarySort);
  const favOnly = useSettings((s) => s.favoritesOnly);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const store = useStory.getState();
  const ui = useUI.getState();

  const list = useMemo(() => {
    let l = library.filter((m) => (activeShelf ? m.shelf === activeShelf : !m.shelf || !shelves.some((s) => s.id === m.shelf)));
    if (favOnly) l = l.filter((m) => m.favorite);
    if (q.trim()) {
      const s = q.toLowerCase();
      l = library.filter((m) => `${m.title} ${m.preview} ${m.description} ${m.tags.join(' ')}`.toLowerCase().includes(s));
    }
    const sorted = [...l];
    if (sort === 'alpha') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'created') sorted.sort((a, b) => b.createdAt - a.createdAt);
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted;
  }, [library, sort, favOnly, q, activeShelf, shelves]);

  const shelf = shelves.find((s) => s.id === activeShelf);

  return (
    <aside className={`left-sidebar ${mobileOpen ? 'mobile-open' : ''}`} aria-label={t('Your Stories')}>
      <div className="left-header">
        <div className="brand">
          <Logo size={18} />
          NovelWriter
        </div>
        <button type="button" className="hbtn" aria-label={t('AI Providers')} title={t('AI Providers')} onClick={() => ui.open('settings', { tab: 'providers' })}>
          <UserCircle size={22} weight="fill" />
        </button>
        <button type="button" className="hbtn" aria-label={t('Open Settings')} title={t('Open Settings')} onClick={() => ui.open('settings')}>
          <GearSix size={20} weight="fill" />
        </button>
        <button type="button" className="hbtn" aria-label={t('Close left sidebar')} title={t('Close left sidebar')} onClick={onCollapse}>
          <CaretLeft size={18} weight="fill" />
        </button>
      </div>
      <div className="lib-head">
        {shelf ? (
          <button type="button" className="row title" style={{ gap: 8, fontWeight: 400 }} onClick={() => useStory.setState({ activeShelf: null })}>
            <ArrowLeft size={16} /> {shelf.title}
          </button>
        ) : (
          <span className="title">{t('Your Stories')}</span>
        )}
        <div className="tools">
          <button type="button" className="icon-btn" aria-label={t('Sort by')} title={t('Sort by')} onClick={() => setFilterOpen(!filterOpen)}>
            <Funnel size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label={t('Search stories')} title={t('Search stories')} onClick={() => setSearchOpen(!searchOpen)}>
            <MagnifyingGlass size={20} weight="bold" />
          </button>
        </div>
      </div>
      {filterOpen && (
        <div className="lib-search" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Select
            value={sort}
            ariaLabel={t('Sort by')}
            onChange={(v) => useSettings.getState().set({ librarySort: v })}
            options={[
              { value: 'recent', label: t('Most Recent') },
              { value: 'alpha', label: t('Alphabetical') },
              { value: 'created', label: t('Created') },
            ]}
          />
          <label className="row" style={{ fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={favOnly} onChange={(e) => useSettings.getState().set({ favoritesOnly: e.target.checked })} />
            {t('Show favorites only')}
          </label>
        </div>
      )}
      {searchOpen && (
        <div className="lib-search">
          <input autoFocus className="input" placeholder={t('Search stories')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Search stories')} />
        </div>
      )}
      <div className="story-list">
        {!activeShelf &&
          !q &&
          shelves.map((s) => (
            <div key={s.id} className="story-card shelf-card" onClick={() => useStory.setState({ activeShelf: s.id })}>
              <div className="card-body">
                <div className="card-title">
                  <span className="name row" style={{ gap: 8 }}>
                    <Books size={18} /> {s.title}
                  </span>
                  <span className="card-icons" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('Delete Shelf')}
                      onClick={async () => {
                        if (await ui.confirm({ title: t('Delete Shelf'), message: t('Stories on this shelf will be moved back to the library.'), danger: true, confirmLabel: t('Delete') })) {
                          store.saveShelves(shelves.filter((x) => x.id !== s.id));
                        }
                      }}
                    >
                      <Trash size={16} />
                    </button>
                  </span>
                </div>
                <div className="card-preview">
                  {library.filter((m) => m.shelf === s.id).length} {t('Stories')}
                </div>
              </div>
            </div>
          ))}
        {list.map((m) => (
          <StoryCard key={m.id} meta={m} active={m.id === currentId} />
        ))}
        {list.length === 0 && <div className="muted" style={{ padding: 20, fontSize: 14 }}>{t('No stories yet.')}</div>}
      </div>
      <div className="lib-bottom">
        <button type="button" className="lib-new" aria-label="create a new story" onClick={() => useStory.setState({ current: null })}>
          <Plus size={16} weight="bold" /> {t('New Story')}
        </button>
        <div className="row2">
          <button
            type="button"
            className="shelf-btn"
            onClick={() => {
              const title = prompt(t('Shelf'), t('New Shelf'));
              if (title) store.saveShelves([...shelves, { id: uid(), title, description: '', createdAt: Date.now() }]);
            }}
          >
            <Books size={18} /> {t('New Shelf')}
          </button>
          <button type="button" className="import-btn" onClick={() => fileRef.current?.click()}>
            <UploadSimple size={16} /> {t('Import File')}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept=".story,.scenario,.lorebook,.json,.txt,.png,.bias,.preset,.naitheme"
          onChange={(e) => {
            if (e.target.files) void store.importFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </aside>
  );
}
