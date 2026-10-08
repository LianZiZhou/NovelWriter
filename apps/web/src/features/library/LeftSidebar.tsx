import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Books,
  CaretDown,
  CaretLeft,
  CaretUp,
  Check,
  Compass,
  Copy,
  DownloadSimple,
  Funnel,
  GearSix,
  Heart,
  House,
  Keyboard,
  MagnifyingGlass,
  Paperclip,
  PencilSimpleLine,
  Plugs,
  Plus,
  Question,
  TextAa,
  Trash,
  UploadSimple,
  UserCircle,
  X,
} from '@phosphor-icons/react';
import { exportStoryFile, uid, zipFiles, type Shelf, type StoryMeta } from '@novelwriter/core';
import { api } from '../../api.ts';
import { download, safeFileName, useStory } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { timeAgo, Modal, ModalHeader, Select, Toggle } from '../../components/ui.tsx';
import { Logo } from '../../components/Logo.tsx';
import { Identicon } from '../../components/Identicon.tsx';

const REPO_URL = 'https://github.com/LianZiZhou/NovelWriter#readme';

function StoryCard({ meta, active, compact, shelvedIn }: { meta: StoryMeta; active: boolean; compact: boolean; shelvedIn?: string }) {
  const store = useStory.getState();
  const ui = useUI.getState();
  return (
    <div
      className={`story-card ${active ? 'active' : ''}`}
      onClick={() => void store.openStory(meta.id)}
      data-story-id={meta.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-novelwriter-story', meta.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="card-body">
        <div className="card-title">
          <span className="name">{meta.title || t('New Story')}</span>
          <span className="card-icons" onClick={(e) => e.stopPropagation()}>
            {active && (
              <button
                type="button"
                className="icon-btn"
                aria-label={t('Edit Story Information')}
                title={t('Edit Story Information')}
                onClick={() => ui.open('storyInfo')}
              >
                <PencilSimpleLine size={18} weight="fill" />
              </button>
            )}
            <button
              type="button"
              className={`icon-btn fav ${meta.favorite ? 'fav-on' : ''}`}
              aria-label={t('Favorite')}
              aria-pressed={meta.favorite}
              onClick={() => void store.setFavorite(meta.id, !meta.favorite)}
            >
              <Heart size={19} weight={meta.favorite ? 'fill' : 'regular'} />
            </button>
          </span>
        </div>
        {!compact && meta.preview && <div className="card-preview">{meta.preview}</div>}
        {shelvedIn && (
          <div className="card-shelved">
            {t('Shelved in:')} <Books size={13} /> {shelvedIn}
          </div>
        )}
        {!active && (
          <div className="card-time">
            {timeAgo(meta.updatedAt)} <Paperclip size={14} />
          </div>
        )}
      </div>
      {active && (
        <div className="card-foot" onClick={(e) => e.stopPropagation()}>
          <span className="time">
            {timeAgo(meta.updatedAt)}
            <Paperclip size={15} />
          </span>
          <button type="button" className="fbtn" aria-label={t('Duplicate Story')} title={t('Duplicate Story')} onClick={() => void store.duplicateStory(meta.id)}>
            <Copy size={17} />
          </button>
          <button type="button" className="fbtn" aria-label={t('Download Story')} title={t('Download Story')} onClick={() => void store.downloadStory(meta.id)}>
            <DownloadSimple size={17} />
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
            <Trash size={17} />
          </button>
        </div>
      )}
    </div>
  );
}

function MenuTile({ icon, label, onClick, href }: { icon: React.ReactNode; label: string; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <span className="menu-tile-icon">{icon}</span>
      <span>{label}</span>
    </>
  );
  return href ? (
    <a className="menu-tile" href={href} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  ) : (
    <button type="button" className="menu-tile" onClick={onClick}>
      {inner}
    </button>
  );
}

/** Account menu: replaces the sidebar body, like the original's user menu. */
function AccountMenu({ onClose }: { onClose: () => void }) {
  const ui = useUI.getState();
  const store = useStory.getState();
  const models = useStory((s) => s.models);
  const lang = useSettings((s) => s.language);
  const identicon = useSettings((s) => s.showIdenticon);
  const connected = new Set(models.filter((m) => m.provider !== 'demo').map((m) => m.provider)).size;
  return (
    <div className="account-menu">
      <div className="account-head">
        <div className="account-avatar">{identicon ? <Identicon seed="novelwriter-author" size={40} /> : <Logo size={30} />}</div>
        <div>
          <div className="account-name">{t('Author')}</div>
          <div className="account-sub">{connected ? t('{n} AI providers connected', { n: connected }) : t('Offline demo model')}</div>
        </div>
      </div>
      <MenuTile
        icon={<House size={20} weight="fill" />}
        label={t('Dashboard')}
        onClick={() => {
          onClose();
          store.showDashboard();
        }}
      />
      <div className="menu-group">{t('Account')}</div>
      <MenuTile icon={<Plugs size={20} weight="fill" />} label={t('AI Providers')} onClick={() => ui.open('settings', { tab: 'providers' })} />
      <MenuTile
        icon={<DownloadSimple size={20} />}
        label={t('Download All Stories')}
        onClick={async () => {
          const metas = await api.listStories();
          const all = await Promise.all(metas.map((m) => api.getStory(m.id)));
          const zip = zipFiles(all.map((s) => ({ name: `${safeFileName(s.title || 'Untitled')}.story`, data: exportStoryFile(s) })));
          download(`novelwriter-stories-${new Date().toISOString().slice(0, 10)}.zip`, zip.slice().buffer, 'application/zip');
        }}
      />
      <div className="menu-group">{t('Other')}</div>
      <MenuTile
        icon={<Compass size={20} weight="fill" />}
        label={t('Explore Scenarios')}
        onClick={() => {
          onClose();
          store.showNewStory();
        }}
      />
      <MenuTile icon={<TextAa size={20} />} label={t('Tokenizer')} onClick={() => ui.open('tokenize', { text: '', standalone: true })} />
      <div className="menu-group">{t('Help')}</div>
      <MenuTile icon={<Keyboard size={20} />} label={t('Hotkeys')} onClick={() => ui.open('settings', { tab: 'hotkeys' })} />
      <MenuTile icon={<Question size={20} />} label={t('Documentation')} href={REPO_URL} />
      <div className="grow" />
      <div className="account-foot">
        <span className="account-version">Version {__APP_VERSION__}</span>
        <Select
          className="lang-select"
          value={lang}
          ariaLabel={t('Language')}
          onChange={(v) => useSettings.getState().set({ language: v })}
          options={[
            { value: 'en', label: '🇬🇧' },
            { value: 'zh', label: '🇨🇳' },
          ]}
        />
      </div>
    </div>
  );
}

function FiltersPanel() {
  const s = useSettings();
  return (
    <div className="filters-panel">
      <div className="filters-group">{t('Display')}</div>
      <div className="row between">
        <span>{t('Compact View')}</span>
        <Toggle on={s.compactView} onChange={(v) => s.set({ compactView: v })} label={t('Compact View')} />
      </div>
      <div className="filters-group">{t('Show On Top')}</div>
      <div className="chip-toggles">
        <button type="button" className={`chip-toggle ${s.shelvesOnTop ? 'on' : ''}`} onClick={() => s.set({ shelvesOnTop: !s.shelvesOnTop })}>
          {s.shelvesOnTop ? <Check size={12} weight="bold" /> : <X size={12} weight="bold" />} {t('Shelves')}
        </button>
        <button type="button" className={`chip-toggle ${s.favoritesOnTop ? 'on' : ''}`} onClick={() => s.set({ favoritesOnTop: !s.favoritesOnTop })}>
          {s.favoritesOnTop ? <Check size={12} weight="bold" /> : <X size={12} weight="bold" />} {t('Favorites')}
        </button>
      </div>
      <div className="filters-hint">{t('Click the heart on a story to mark it as a favorite.')}</div>
      <div className="filters-group">{t('Sort By')}</div>
      <div className="row" style={{ gap: 8 }}>
        <Select
          value={s.librarySort}
          ariaLabel={t('Sort by')}
          onChange={(v) => s.set({ librarySort: v })}
          options={[
            { value: 'recent', label: t('Most Recent') },
            { value: 'alpha', label: t('Alphabetical') },
            { value: 'created', label: t('Creation Date') },
          ]}
        />
        <button type="button" className="icon-btn" style={{ width: 28 }} aria-label={t('Change display order')} onClick={() => s.set({ librarySortAsc: !s.librarySortAsc })}>
          {s.librarySortAsc ? <CaretUp size={16} weight="fill" /> : <CaretDown size={16} weight="fill" />}
        </button>
      </div>
    </div>
  );
}

export function LeftSidebar({ onCollapse, mobileOpen }: { onCollapse: () => void; mobileOpen: boolean }) {
  const library = useStory((s) => s.library);
  const shelves = useStory((s) => s.shelves);
  const activeShelf = useStory((s) => s.activeShelf);
  const currentId = useStory((s) => s.current?.id);
  const sort = useSettings((s) => s.librarySort);
  const asc = useSettings((s) => s.librarySortAsc);
  const compact = useSettings((s) => s.compactView);
  const shelvesOnTop = useSettings((s) => s.shelvesOnTop);
  const favoritesOnTop = useSettings((s) => s.favoritesOnTop);
  const [panel, setPanel] = useState<'none' | 'filters' | 'account'>('none');
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const store = useStory.getState();
  const ui = useUI.getState();

  const [shelfEdit, setShelfEdit] = useState<Shelf | 'new' | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const shelfIds = useMemo(() => new Set(shelves.map((x) => x.id)), [shelves]);
  const parentOf = (sh: Shelf) => (sh.parent && shelfIds.has(sh.parent) ? sh.parent : null);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    // Inside a shelf the search covers that shelf ("Search this shelf"); at the top it covers the whole library.
    const inShelf = (m: StoryMeta) => (activeShelf ? m.shelf === activeShelf : !m.shelf || !shelfIds.has(m.shelf));
    let l = query
      ? library.filter((m) => (!activeShelf || m.shelf === activeShelf) && `${m.title} ${m.preview} ${m.description} ${m.tags.join(' ')}`.toLowerCase().includes(query))
      : library.filter(inShelf);
    l = [...l];
    const dir = asc ? -1 : 1;
    if (sort === 'alpha') l.sort((a, b) => a.title.localeCompare(b.title) * -dir);
    else if (sort === 'created') l.sort((a, b) => (b.createdAt - a.createdAt) * dir);
    else l.sort((a, b) => (b.updatedAt - a.updatedAt) * dir);
    if (favoritesOnTop) l.sort((a, b) => Number(b.favorite) - Number(a.favorite));
    return l;
  }, [library, sort, asc, favoritesOnTop, q, activeShelf, shelfIds]);

  const moveToShelf = async (storyId: string, shelfId: string | null) => {
    const meta = library.find((m) => m.id === storyId);
    if (!meta || meta.shelf === shelfId) return;
    await store.setShelf(storyId, shelfId);
    ui.toast(shelfId ? t('Moved to "{name}"', { name: shelves.find((x) => x.id === shelfId)?.title ?? '' }) : t('Moved to the library'), 'success');
  };
  const dropProps = (shelfId: string | null, key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-novelwriter-story')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((d) => (d === key ? null : d)),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData('application/x-novelwriter-story');
      setDropTarget(null);
      if (id) {
        e.preventDefault();
        void moveToShelf(id, shelfId);
      }
    },
  });
  const countIn = (id: string): number => library.filter((m) => m.shelf === id).length + shelves.filter((x) => parentOf(x) === id).reduce((n, x) => n + countIn(x.id), 0);

  const shelf = shelves.find((s) => s.id === activeShelf);
  const shelfName = (id: string | null) => shelves.find((x) => x.id === id)?.title;
  const shelfCards = !q
    ? shelves
        .filter((s) => parentOf(s) === (activeShelf ?? null))
        .map((s) => (
          <div
            key={s.id}
            className={`story-card shelf-card ${dropTarget === s.id ? 'drop-target' : ''}`}
            onClick={() => useStory.setState({ activeShelf: s.id })}
            {...dropProps(s.id, s.id)}
          >
            <div className="card-body">
              <div className="card-title">
                <span className="name row" style={{ gap: 8 }}>
                  <Books size={18} /> {s.title || t('Untitled Shelf')}
                </span>
                <span className="card-icons" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="icon-btn" aria-label={t('Shelf Settings')} title={t('Shelf Settings')} onClick={() => setShelfEdit(s)}>
                    <PencilSimpleLine size={16} weight="fill" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('Delete Shelf')}
                    title={t('Delete Shelf')}
                    onClick={async () => {
                      if (await ui.confirm({ title: t('Delete Shelf?'), message: t('Stories and shelves on this shelf will be moved up one level.'), danger: true, confirmLabel: t('Delete') })) {
                        const up = parentOf(s);
                        for (const m of library.filter((m) => m.shelf === s.id)) await store.setShelf(m.id, up);
                        store.saveShelves(shelves.filter((x) => x.id !== s.id).map((x) => (x.parent === s.id ? { ...x, parent: up } : x)));
                      }
                    }}
                  >
                    <Trash size={16} />
                  </button>
                </span>
              </div>
              {!compact && s.description && <div className="card-preview">{s.description}</div>}
              <div className="card-time">
                {countIn(s.id)} {t('Stories')}
              </div>
            </div>
          </div>
        ))
    : [];

  return (
    <aside className={`left-sidebar ${mobileOpen ? 'mobile-open' : ''}`} aria-label={t('Your Stories')}>
      <div className="left-header">
        <div className="brand">
          <Logo size={18} />
          NovelWriter
        </div>
        <button
          type="button"
          className={`hbtn ${panel === 'account' ? 'active' : ''}`}
          aria-label="Open Account Menu"
          title={t('Account')}
          onClick={() => setPanel(panel === 'account' ? 'none' : 'account')}
        >
          <UserCircle size={24} weight="fill" />
        </button>
        <button type="button" className="hbtn" aria-label={t('Open Settings')} title={t('Open Settings')} onClick={() => ui.open('settings')}>
          <GearSix size={20} weight="fill" />
        </button>
        <button type="button" className="hbtn" aria-label={t('Close left sidebar')} title={t('Close left sidebar')} onClick={onCollapse}>
          <CaretLeft size={18} weight="fill" />
        </button>
      </div>
      {panel === 'account' ? (
        <AccountMenu onClose={() => setPanel('none')} />
      ) : (
        <>
          <div className="lib-head">
            {shelf ? (
              <button
                type="button"
                className={`row title shelf-back ${dropTarget === '__up' ? 'drop-target' : ''}`}
                style={{ gap: 8, fontWeight: 400 }}
                title={t('Back to {name}', { name: shelfName(parentOf(shelf)) ?? t('Your Stories') })}
                onClick={() => useStory.setState({ activeShelf: parentOf(shelf) })}
                {...dropProps(parentOf(shelf), '__up')}
              >
                <ArrowLeft size={16} /> {shelf.title || t('Untitled Shelf')}
              </button>
            ) : (
              <span className="title">{panel === 'filters' ? t('Filters') : t('Your Stories')}</span>
            )}
            <div className="tools">
              <button
                type="button"
                className={`icon-btn ${panel === 'filters' ? 'on' : ''}`}
                aria-label="Open Sort Settings"
                title={t('Filters')}
                onClick={() => setPanel(panel === 'filters' ? 'none' : 'filters')}
              >
                <Funnel size={21} weight={panel === 'filters' ? 'fill' : 'regular'} />
              </button>
              <button type="button" className="icon-btn" aria-label={t('Search stories')} title={t('Search stories')} onClick={() => setSearchOpen(!searchOpen)}>
                <MagnifyingGlass size={20} weight="bold" />
              </button>
            </div>
          </div>
          <div className="story-list">
            {panel === 'filters' && <FiltersPanel />}
            {searchOpen && (
              <div className="lib-search">
                <input autoFocus className="input" placeholder={shelf ? t('Search this shelf') : t('Search your stories')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={shelf ? t('Search this shelf') : t('Search your stories')} />
              </div>
            )}
            {shelvesOnTop && shelfCards}
            {shelf?.description && !q && <div className="shelf-desc">{shelf.description}</div>}
            {list.map((m) => (
              <StoryCard key={m.id} meta={m} active={m.id === currentId} compact={compact} shelvedIn={q && !activeShelf && m.shelf ? shelfName(m.shelf) : undefined} />
            ))}
            {!shelvesOnTop && shelfCards}
            {list.length === 0 && shelfCards.length === 0 && (
              <div className="lib-empty">
                {q ? t("We can't find what you're looking for.") : shelf ? t('This shelf is empty.') : t('Looks like your Library is empty.')}
                {!q && shelf && <div className="desc">{t('Drag stories here, or use the pencil on a story to move it to this shelf.')}</div>}
              </div>
            )}
          </div>
        </>
      )}
      <div className="lib-bottom">
        <button type="button" className="lib-new" aria-label="create a new story" onClick={() => store.showNewStory()}>
          <Plus size={16} weight="bold" /> {t('New Story')}
        </button>
        <div className="row2">
          <button type="button" className="shelf-btn" onClick={() => setShelfEdit('new')}>
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
          accept=".story,.scenario,.lorebook,.json,.txt,.png,.bias,.preset,.gensettings,.generationset,.badwords,.module,.naitheme"
          onChange={(e) => {
            if (e.target.files) void store.importFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {shelfEdit && (
        <ShelfSettings
          shelf={shelfEdit === 'new' ? null : shelfEdit}
          shelves={shelves}
          defaultParent={activeShelf}
          onClose={() => setShelfEdit(null)}
          onSave={(sh) => {
            store.saveShelves(shelves.some((x) => x.id === sh.id) ? shelves.map((x) => (x.id === sh.id ? sh : x)) : [...shelves, sh]);
            setShelfEdit(null);
          }}
        />
      )}
    </aside>
  );
}

/** Create or edit a shelf: title, description and the shelf it sits on. */
function ShelfSettings({ shelf, shelves, defaultParent, onClose, onSave }: { shelf: Shelf | null; shelves: Shelf[]; defaultParent: string | null; onClose: () => void; onSave: (s: Shelf) => void }) {
  const [title, setTitle] = useState(shelf?.title ?? '');
  const [description, setDescription] = useState(shelf?.description ?? '');
  const [parent, setParent] = useState<string>(shelf ? (shelf.parent ?? '__root') : (defaultParent ?? '__root'));
  // A shelf can't sit on itself or on one of its own sub-shelves.
  const descendants = (id: string): string[] => shelves.filter((x) => x.parent === id).flatMap((x) => [x.id, ...descendants(x.id)]);
  const blocked = new Set(shelf ? [shelf.id, ...descendants(shelf.id)] : []);
  return (
    <Modal onClose={onClose} width={460} label={shelf ? t('Shelf Settings') : t('New Shelf')}>
      <ModalHeader title={shelf ? t('Shelf Settings') : t('New Shelf')} onClose={onClose} />
      <form
        className="modal-body"
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ id: shelf?.id ?? uid(), createdAt: shelf?.createdAt ?? Date.now(), title: title.trim() || t('New Shelf'), description, parent: parent === '__root' ? null : parent });
        }}
      >
        <label className="number-field">
          <span style={{ fontWeight: 600 }}>{t('Shelf Name')}</span>
          <input className="input" autoFocus value={title} placeholder={t('New Shelf')} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="number-field">
          <span style={{ fontWeight: 600 }}>{t('Description')}</span>
          <textarea className="textarea" style={{ height: 90 }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="number-field">
          <span style={{ fontWeight: 600 }}>{t('Inside Shelf')}</span>
          <Select
            value={parent}
            ariaLabel={t('Inside Shelf')}
            onChange={setParent}
            options={[{ value: '__root', label: t('Your Stories') }, ...shelves.filter((x) => !blocked.has(x.id)).map((x) => ({ value: x.id, label: x.title }))]}
          />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn primary">
            {shelf ? t('Save') : t('Create Shelf')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

