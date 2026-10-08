import { useEffect, useState } from 'react';
import { CaretLeft, CaretRight, GearSix } from '@phosphor-icons/react';
import { useStory } from './store/story.ts';
import { useSettings, DEFAULT_SETTINGS } from './store/settings.ts';
import { useUI } from './store/ui.ts';
import { t } from './i18n.ts';
import { matchHotkey } from './hotkeys.ts';
import { LeftSidebar } from './features/library/LeftSidebar.tsx';
import { RightSidebar } from './features/right/RightSidebar.tsx';
import { EditorPane } from './features/editor/EditorPane.tsx';
import { NewStoryPage } from './features/newstory/NewStoryPage.tsx';
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

function ModalHost() {
  const modal = useUI((s) => s.modal);
  const p = useUI((s) => s.modalProps) as Record<string, never>;
  const close = useUI((s) => s.close);
  const story = useStory((s) => s.current);
  if (!modal) return null;
  const needsStory = !['settings', 'palette', 'confirm'].includes(modal);
  if (needsStory && !story) return null;
  switch (modal) {
    case 'lorebook':
      return <LorebookModal onClose={close} entryId={p.entryId} />;
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
      return <ToolboxModal onClose={close} text={p.text} from={p.from} to={p.to} />;
    case 'tokenize':
      return <TokenizeModal onClose={close} text={p.text} />;
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
    case 'scripts':
      return <ScriptsModal onClose={close} />;
    case 'confirm':
      return <ConfirmModal onClose={close} title={p.title} message={p.message} confirmLabel={p.confirmLabel} danger={p.danger} resolve={p.resolve} />;
    default:
      return null;
  }
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
      const hk = useSettings.getState().hotkeys;
      const store = useStory.getState();
      const ui = useUI.getState();
      const inModal = ui.modal !== null;
      const target = e.target as HTMLElement;
      const inField = (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !target.closest('.control-row');
      const is = (name: string) => matchHotkey(e, hk[name]);
      if (e.altKey && e.shiftKey && e.code === 'KeyP') {
        useSettings.getState().set({ themeName: DEFAULT_SETTINGS.themeName, customCss: '' });
        return;
      }
      if (is('palette')) {
        e.preventDefault();
        if (ui.modal === 'palette') ui.close();
        else ui.open('palette');
        return;
      }
      if (is('settings')) {
        e.preventDefault();
        ui.open('settings');
        return;
      }
      if (inModal) return;
      if (is('stop') && store.generating) {
        e.preventDefault();
        store.stop();
        return;
      }
      if (!store.current) return;
      if (is('inline')) {
        e.preventDefault();
        void store.generateInline();
      } else if (is('send')) {
        e.preventDefault();
        void store.send();
      } else if (is('retry')) {
        e.preventDefault();
        void store.retry();
      } else if (is('lorebook')) {
        e.preventDefault();
        ui.open('lorebook');
      } else if (!inField && is('undo')) {
        e.preventDefault();
        store.undo();
      } else if (!inField && (is('redo') || matchHotkey(e, 'Mod-Shift-z'))) {
        e.preventDefault();
        store.redo();
      } else if (matchHotkey(e, 'Mod-f')) {
        e.preventDefault();
        ui.set({ findOpen: true });
      } else if (is('toggleLeft')) {
        e.preventDefault();
        const s = useSettings.getState();
        s.set({ leftOpen: !s.leftOpen });
      } else if (is('toggleRight')) {
        e.preventDefault();
        const s = useSettings.getState();
        s.set({ rightOpen: !s.rightOpen });
      } else if (is('newStory')) {
        e.preventDefault();
        useStory.setState({ current: null });
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
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

export function App() {
  const story = useStory((s) => s.current);
  const serverDown = useStory((s) => s.serverDown);
  const leftOpen = useSettings((s) => s.leftOpen);
  const rightOpen = useSettings((s) => s.rightOpen);
  const setSettings = useSettings((s) => s.set);
  const mobileLeft = useUI((s) => s.mobileLeft);
  const mobileRight = useUI((s) => s.mobileRight);
  const setUI = useUI((s) => s.set);
  const mobile = useIsMobile();
  const dropping = useFileDrop();
  useGlobalHotkeys();

  const showLeft = mobile ? true : leftOpen;
  const showRight = !!story && (mobile ? true : rightOpen);
  const openLeft = () => (mobile ? setUI({ mobileLeft: true, mobileRight: false }) : setSettings({ leftOpen: true }));
  const openRight = () => (mobile ? setUI({ mobileRight: true, mobileLeft: false }) : setSettings({ rightOpen: true }));

  return (
    <div className="app" id="app">
      {showLeft && <LeftSidebar mobileOpen={mobileLeft} onCollapse={() => (mobile ? setUI({ mobileLeft: false }) : setSettings({ leftOpen: false }))} />}
      <main className="main">
        {(!leftOpen || mobile) && (
          <div className="corner-controls left">
            <button type="button" className="icon-btn row" style={{ gap: 6 }} onClick={openLeft} aria-label={t('Open left sidebar')} title={t('Open left sidebar')}>
              <Logo size={18} /> <CaretRight size={16} weight="fill" />
            </button>
          </div>
        )}
        {story && (!rightOpen || mobile) && (
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
            <button type="button" className="btn small" onClick={() => void useStory.getState().init()}>
              {t('Retry')}
            </button>
          </div>
        )}
        {story ? <EditorPane key={story.id} /> : <NewStoryPage />}
      </main>
      {showRight && <RightSidebar mobileOpen={mobileRight} onCollapse={() => (mobile ? setUI({ mobileRight: false }) : setSettings({ rightOpen: false }))} />}
      {mobile && <div className={`drawer-backdrop ${mobileLeft || mobileRight ? 'show' : ''}`} onClick={() => setUI({ mobileLeft: false, mobileRight: false })} />}
      <ModalHost />
      <Toasts />
      {dropping && (
        <div className="modal-backdrop" style={{ pointerEvents: 'none' }}>
          <div className="heading" style={{ fontSize: 24, color: 'var(--text-headings)' }}>{t('Drop files to import')}</div>
        </div>
      )}
    </div>
  );
}
