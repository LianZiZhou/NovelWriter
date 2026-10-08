import { useEffect, useState } from 'react';
import { CaretLeft, CaretRight, GearSix, House, Plus } from '@phosphor-icons/react';
import { useStory } from './store/story.ts';
import { useSettings, DEFAULT_SETTINGS } from './store/settings.ts';
import { useUI } from './store/ui.ts';
import { t } from './i18n.ts';
import { matchHotkey } from './hotkeys.ts';
import { stopSpeaking } from './features/tts/tts.ts';
import { LeftSidebar } from './features/library/LeftSidebar.tsx';
import { RightSidebar } from './features/right/RightSidebar.tsx';
import { EditorPane } from './features/editor/EditorPane.tsx';
import { NewStoryPage } from './features/newstory/NewStoryPage.tsx';
import { Dashboard } from './features/home/Dashboard.tsx';
import { LorebookModal } from './features/lorebook/LorebookModal.tsx';
import { SettingsModal } from './features/settings/SettingsModal.tsx';
import { ContextSettingsModal, ContextViewerModal, EphemeralModal, TextFieldModal } from './features/modals/ContextModals.tsx';
import {
  ConfirmModal,
  HistoryTreeModal,
  PaletteModal,
  PlaceholdersModal,
  SamplersModal,
  ScreenshotModal,
  StatsModal,
  StoryInfoModal,
  TokenizeModal,
  ToolboxModal,
} from './features/modals/MiscModals.tsx';
import { Logo } from './components/Logo.tsx';
import { ScriptsModal } from './features/scripts/ScriptsModal.tsx';
import { TokenProbsModal } from './features/tokenprobs/TokenProbs.tsx';

function ModalHost() {
  const modal = useUI((s) => s.modal);
  const p = useUI((s) => s.modalProps) as Record<string, never>;
  const close = useUI((s) => s.close);
  const hasStory = useStory((s) => !!s.current);
  if (!modal) return null;
  const needsStory = !['settings', 'palette', 'tokenize'].includes(modal);
  if (needsStory && !hasStory) return null;
  switch (modal) {
    case 'lorebook':
      return <LorebookModal onClose={close} entryId={p.entryId} generate={p.generate} />;
    case 'settings':
      return <SettingsModal onClose={close} initialTab={p.tab} />;
    case 'contextViewer':
      return <ContextViewerModal onClose={close} which={p.which ?? 'current'} />;
    case 'contextSettings':
      return <ContextSettingsModal onClose={close} />;
    case 'ephemeral':
      return <EphemeralModal onClose={close} />;
    case 'systemPrompt':
      return <TextFieldModal onClose={close} field={p.field ?? 'system'} />;
    case 'stats':
      return <StatsModal onClose={close} />;
    case 'storyInfo':
      return <StoryInfoModal onClose={close} />;
    case 'toolbox':
      return <ToolboxModal onClose={close} text={p.text} from={p.from} to={p.to} mode={p.mode} />;
    case 'tokenize':
      return <TokenizeModal onClose={close} text={p.text ?? ''} standalone={p.standalone} />;
    case 'screenshot':
      return <ScreenshotModal onClose={close} from={p.from} to={p.to} />;
    case 'placeholders':
      return <PlaceholdersModal onClose={close} />;
    case 'palette':
      return <PaletteModal onClose={close} />;
    case 'historyTree':
      return <HistoryTreeModal onClose={close} />;
    case 'samplers':
      return <SamplersModal onClose={close} />;
    case 'tokenProbs':
      return <TokenProbsModal onClose={close} />;
    case 'scripts':
      return <ScriptsModal onClose={close} />;
    default:
      return null;
  }
}

function ConfirmHost() {
  const c = useUI((s) => s.confirmProps);
  if (!c) return null;
  return <ConfirmModal title={c.title} message={c.message} confirmLabel={c.confirmLabel} danger={c.danger} resolve={c.resolve} />;
}

function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((tt) => (
        <div key={tt.id} className={`toast ${tt.kind} fade-in`} onClick={() => useUI.getState().dismissToast(tt.id)}>
          {tt.text}
        </div>
      ))}
    </div>
  );
}

function useGlobalHotkeys() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const settings = useSettings.getState();
      const hk = settings.hotkeys;
      const store = useStory.getState();
      const ui = useUI.getState();
      const inModal = ui.modal !== null;
      const target = e.target as HTMLElement;
      const inField = (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !target.closest('.control-row');
      const is = (name: string) => matchHotkey(e, hk[name]);
      const act = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (is('resetTheme')) return act(() => settings.set({ themeName: DEFAULT_SETTINGS.themeName, customCss: '' }));
      if (is('palette')) return act(() => (ui.modal === 'palette' ? ui.close() : ui.open('palette')));
      if (is('settings')) return act(() => ui.open('settings'));
      if (is('stopTTS')) return act(stopSpeaking);
      if (is('tokenizer')) return act(() => ui.open('tokenize', { standalone: true }));
      if (inModal) return;
      if (is('toggleMenuBar')) return act(() => settings.set({ leftOpen: !settings.leftOpen }));
      if (is('toggleInfoBar')) return act(() => settings.set({ rightOpen: !settings.rightOpen }));
      if (is('toggleBars')) {
        const open = !(settings.leftOpen || settings.rightOpen);
        return act(() => settings.set({ leftOpen: open, rightOpen: open }));
      }
      if (is('toggleHighlighting')) return act(() => settings.set({ highlightSpeech: !settings.highlightSpeech }));
      if (is('toggleSpellcheck')) return act(() => settings.set({ editorSpellcheck: !settings.editorSpellcheck }));
      if (is('toggleInputBox')) return act(() => settings.set({ inputBox: !settings.inputBox }));
      if (is('newStory')) return act(() => store.showNewStory());
      if (store.generating && (is('stop') || is('send'))) return act(() => store.stop());
      if (!store.current) return;
      if (is('inline')) return act(() => void store.generateInline());
      if (is('send')) return act(() => void store.send());
      if (is('retry')) return act(() => void store.retry());
      if (is('lorebook')) return act(() => ui.open('lorebook'));
      if (is('contextViewer')) return act(() => ui.open('contextViewer', { which: 'last' }));
      if (is('userScripts')) return act(() => ui.open('scripts'));
      if (is('tokenProbs')) return act(() => ui.open('tokenProbs'));
      if (is('editorTokenProbs')) return act(() => settings.set({ editorTokenProbabilities: !settings.editorTokenProbabilities }));
      if (is('focusEditor')) return act(() => (document.querySelector('.ProseMirror') as HTMLElement | null)?.focus());
      if (is('focusInput')) return act(() => (document.querySelector('.control-row input') as HTMLElement | null)?.focus());
      if (is('redoList')) return act(() => window.dispatchEvent(new Event('nw:redo-list')));
      if (is('deleteStory')) {
        const cur = store.current;
        return act(async () => {
          if (await ui.confirm({ title: t('Delete Story'), message: t('Delete "{name}"? This cannot be undone.', { name: cur.title }), confirmLabel: t('Delete'), danger: true })) await store.deleteStory(cur.id);
        });
      }
      if (!inField && is('undo')) return act(() => store.undo());
      if (!inField && is('redo')) return act(() => store.redo());
      if (is('find')) return act(() => ui.set({ findOpen: true }));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}

/** "Gesture Controls": swipe from a screen edge to open a sidebar drawer, swipe back to close it. */
function useSwipeGestures(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    const down = (e: TouchEvent) => {
      const t0 = e.touches[0];
      start = { x: t0.clientX, y: t0.clientY };
    };
    const up = (e: TouchEvent) => {
      if (!start) return;
      const t1 = e.changedTouches[0];
      const dx = t1.clientX - start.x;
      const dy = t1.clientY - start.y;
      const from = start;
      start = null;
      if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      const ui = useUI.getState();
      const edge = 32;
      if (dx > 0) {
        if (ui.mobileRight) ui.set({ mobileRight: false });
        else if (from.x < edge) ui.set({ mobileLeft: true, mobileRight: false });
      } else {
        if (ui.mobileLeft) ui.set({ mobileLeft: false });
        else if (from.x > window.innerWidth - edge && useStory.getState().current) ui.set({ mobileRight: true, mobileLeft: false });
      }
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchend', up, { passive: true });
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchend', up);
    };
  }, [enabled]);
}

function useFileDrop() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      setOver(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const over = (e: DragEvent) => e.dataTransfer?.types.includes('Files') && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      void useStory.getState().importFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return over;
}

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 1200);
  useEffect(() => {
    const h = () => setM(window.innerWidth < 1200);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return m;
}

/** Slim icon column shown in place of the collapsed left sidebar ("Show Minibar"). */
function Minibar({ onExpand }: { onExpand: () => void }) {
  const ui = useUI.getState();
  return (
    <nav className="minibar" aria-label={t('Minibar')}>
      <button type="button" onClick={onExpand} aria-label={t('Open left sidebar')} title={t('Open left sidebar')}>
        <Logo size={18} />
      </button>
      <button type="button" onClick={() => useStory.getState().showNewStory()} aria-label={t('New Story')} title={t('New Story')}>
        <Plus size={18} weight="bold" />
      </button>
      <button type="button" onClick={() => useStory.getState().showDashboard()} aria-label={t('Dashboard')} title={t('Dashboard')}>
        <House size={18} weight="fill" />
      </button>
      <div className="grow" />
      <button type="button" onClick={() => ui.open('settings')} aria-label={t('Open Settings')} title={t('Open Settings')}>
        <GearSix size={18} weight="fill" />
      </button>
    </nav>
  );
}

export function App() {
  // Only the story id: subscribing to the whole story would re-render the app on every keystroke.
  const storyId = useStory((s) => s.current?.id);
  const page = useStory((s) => s.page);
  const serverDown = useStory((s) => s.serverDown);
  const leftOpen = useSettings((s) => s.leftOpen);
  const rightOpen = useSettings((s) => s.rightOpen);
  const setSettings = useSettings((s) => s.set);
  const mobileLeft = useUI((s) => s.mobileLeft);
  const mobileRight = useUI((s) => s.mobileRight);
  const setUI = useUI((s) => s.set);
  const mobile = useIsMobile();
  const dropping = useFileDrop();
  const gestures = useSettings((s) => s.gestureControls);
  const minibar = useSettings((s) => s.showMinibar);
  useGlobalHotkeys();
  useSwipeGestures(mobile && gestures);

  const showLeft = mobile ? true : leftOpen;
  const showRight = !!storyId && (mobile ? true : rightOpen);
  const openLeft = () => (mobile ? setUI({ mobileLeft: true, mobileRight: false }) : setSettings({ leftOpen: true }));
  const openRight = () => (mobile ? setUI({ mobileRight: true, mobileLeft: false }) : setSettings({ rightOpen: true }));

  return (
    <div className="app" id="app">
      {!mobile && !leftOpen && minibar && <Minibar onExpand={openLeft} />}
      {showLeft && <LeftSidebar mobileOpen={mobileLeft} onCollapse={() => (mobile ? setUI({ mobileLeft: false }) : setSettings({ leftOpen: false }))} />}
      <main className="main">
        {(mobile || (!leftOpen && !minibar)) && (
          <div className="corner-controls left">
            <button type="button" className="icon-btn row" style={{ gap: 6 }} onClick={openLeft} aria-label={t('Open left sidebar')} title={t('Open left sidebar')}>
              <Logo size={18} /> <CaretRight size={16} weight="fill" />
            </button>
          </div>
        )}
        {storyId && (!rightOpen || mobile) && (
          <div className="corner-controls right">
            <button type="button" className="icon-btn" onClick={openRight} aria-label={t('Open right sidebar')} title={t('Open right sidebar')}>
              <CaretLeft size={16} weight="fill" />
            </button>
            <button type="button" className="icon-btn" onClick={() => useUI.getState().open('settings')} aria-label={t('Open Settings')}>
              <GearSix size={20} weight="fill" />
            </button>
          </div>
        )}
        {serverDown && (
          <div className="tip-bar" style={{ margin: '12px auto 0', borderColor: 'var(--warning)', maxWidth: 760, width: 'calc(100% - 40px)' }}>
            <span className="tip-text warning-text">{t('Server unreachable')} — {t('start it with "npm run dev" or "npm start".')}</span>
            <button type="button" className="btn small" onClick={() => void useStory.getState().reload()}>
              {t('Retry')}
            </button>
          </div>
        )}
        {storyId ? <EditorPane key={storyId} /> : page === 'newStory' ? <NewStoryPage /> : <Dashboard />}
      </main>
      {showRight && <RightSidebar mobileOpen={mobileRight} onCollapse={() => (mobile ? setUI({ mobileRight: false }) : setSettings({ rightOpen: false }))} />}
      {mobile && <div className={`drawer-backdrop ${mobileLeft || mobileRight ? 'show' : ''}`} onClick={() => setUI({ mobileLeft: false, mobileRight: false })} />}
      <ModalHost />
      <ConfirmHost />
      <Toasts />
      {dropping && (
        <div className="modal-backdrop" style={{ pointerEvents: 'none' }}>
          <div className="heading" style={{ fontSize: 24, color: 'var(--text-headings)' }}>{t('Drop files to import')}</div>
        </div>
      )}
    </div>
  );
}
