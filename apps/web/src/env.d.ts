declare const __APP_VERSION__: string;

/** Window state reported by the desktop app (apps/desktop/src/util.ts WindowControlsState). */
interface DesktopWindowState {
  maximized: boolean;
  fullscreen: boolean;
  focused: boolean;
}

/** Exposed by the desktop app's preload (apps/desktop/src/util.ts DesktopBridge). */
interface Window {
  novelwriterDesktop?: {
    platform: string;
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    showMenu(x: number, y: number): void;
    getState(): Promise<DesktopWindowState | undefined>;
    onState(cb: (state: DesktopWindowState) => void): () => void;
  };
}
