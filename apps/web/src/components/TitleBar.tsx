import { useEffect, useState } from 'react';
import { CopySimple, List, Minus, Square, X } from '@phosphor-icons/react';
import { useStory } from '../store/story.ts';
import { t } from '../i18n.ts';
import { Logo } from './Logo.tsx';

/** The desktop app's preload bridge (apps/desktop/src/preload.ts); absent in the browser. */
export const desktop = typeof window !== 'undefined' ? window.novelwriterDesktop : undefined;

const INITIAL: DesktopWindowState = { maximized: false, fullscreen: false, focused: true };

/**
 * Title bar of the desktop app. The whole bar drags the window; buttons opt out. On macOS the
 * native traffic lights sit inset on the left; on Windows and Linux the window is frameless and
 * the app menu and window buttons are drawn here.
 */
export function TitleBar() {
  const [state, setState] = useState(INITIAL);
  const title = useStory((s) => s.current?.title);

  useEffect(() => {
    if (!desktop) return;
    void desktop.getState().then((s) => s && setState(s));
    return desktop.onState(setState);
  }, []);

  // The window title (taskbar, window switcher) follows the open story.
  useEffect(() => {
    document.title = title?.trim() ? `${title.trim()} — NovelWriter` : 'NovelWriter';
  }, [title]);

  if (!desktop || state.fullscreen) return null;
  const mac = desktop.platform === 'darwin';

  return (
    <header className={`titlebar ${mac ? 'mac' : 'framed'} ${state.focused ? '' : 'blurred'}`}>
      {!mac && (
        <button
          type="button"
          className="titlebar-btn menu"
          aria-label={t('Application menu')}
          title={t('Application menu')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            desktop?.showMenu(r.left, r.bottom);
          }}
        >
          <List size={16} weight="bold" />
        </button>
      )}
      <div className="titlebar-title">
        <Logo size={14} />
        <span className="titlebar-app">NovelWriter</span>
        {title?.trim() && (
          <>
            <span className="titlebar-sep" aria-hidden="true">/</span>
            <span className="titlebar-story">{title.trim()}</span>
          </>
        )}
      </div>
      {!mac && (
        <div className="titlebar-controls">
          <button type="button" className="titlebar-btn" aria-label={t('Minimize')} title={t('Minimize')} onClick={() => desktop?.minimize()}>
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="titlebar-btn"
            aria-label={state.maximized ? t('Restore') : t('Maximize')}
            title={state.maximized ? t('Restore') : t('Maximize')}
            onClick={() => {
              desktop?.toggleMaximize();
              // Some Linux window managers apply maximize late or never report it; ask again.
              setTimeout(() => void desktop?.getState().then((s) => s && setState(s)), 300);
            }}
          >
            {state.maximized ? <CopySimple size={13} style={{ transform: 'scaleX(-1)' }} /> : <Square size={12} />}
          </button>
          <button type="button" className="titlebar-btn close" aria-label={t('Close')} title={t('Close')} onClick={() => desktop?.close()}>
            <X size={15} />
          </button>
        </div>
      )}
    </header>
  );
}
