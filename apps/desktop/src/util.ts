// Pure helpers for the main process (no Electron imports, so they can be unit tested).

/** True for http(s) URLs, the only kind handed to the system browser. */
export function isExternalHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** True when `raw` points at the app's own server (same scheme, host and port). */
export function isAppUrl(raw: string, appOrigin: string): boolean {
  try {
    return new URL(raw).origin === appOrigin;
  } catch {
    return false;
  }
}

/** IPC channels between the preload's title-bar bridge and the main process. */
export const WINDOW_CHANNELS = {
  minimize: 'nw-window:minimize',
  toggleMaximize: 'nw-window:toggle-maximize',
  close: 'nw-window:close',
  showMenu: 'nw-window:show-menu',
  getState: 'nw-window:get-state',
  state: 'nw-window:state',
} as const;

export interface WindowControlsState {
  maximized: boolean;
  fullscreen: boolean;
  focused: boolean;
}

/** What the page sees as `window.novelwriterDesktop` (mirrored in apps/web/src/env.d.ts). */
export interface DesktopBridge {
  platform: string;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  /** Pop up the application menu at a point in the window (CSS pixels). */
  showMenu(x: number, y: number): void;
  getState(): Promise<WindowControlsState>;
  /** Subscribe to window state changes; returns an unsubscribe function. */
  onState(cb: (state: WindowControlsState) => void): () => void;
}

/** Clamp a menu position sent by the page to the window's content area. */
export function menuPoint(x: unknown, y: unknown, width: number, height: number): { x: number; y: number } {
  const clamp = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(0, Math.round(v)), max) : 0);
  return { x: clamp(x, width), y: clamp(y, height) };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds?: Rect;
  maximized?: boolean;
}

export const DEFAULT_SIZE = { width: 1440, height: 900 };
export const MIN_SIZE = { width: 800, height: 560 };

/**
 * Validate a saved window state against the current displays. The saved
 * bounds are kept only when at least a 100x50 strip of the title area lies on
 * some display's work area; otherwise only the size is reused (clamped to the
 * minimum) and the window is centred by Electron.
 */
export function restoreBounds(saved: WindowState | undefined, workAreas: Rect[]): Partial<Rect> & { width: number; height: number } {
  const b = saved?.bounds;
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return { ...DEFAULT_SIZE };
  const width = Math.max(MIN_SIZE.width, Math.round(b.width));
  const height = Math.max(MIN_SIZE.height, Math.round(b.height));
  const visible = workAreas.some((a) => {
    const overlapX = Math.min(b.x + width, a.x + a.width) - Math.max(b.x, a.x);
    const overlapY = Math.min(b.y + 50, a.y + a.height) - Math.max(b.y, a.y);
    return overlapX >= 100 && overlapY >= 50;
  });
  return visible ? { x: Math.round(b.x), y: Math.round(b.y), width, height } : { width, height };
}

/** Parse a small JSON state file, tolerating missing or corrupt contents. */
export function parseJsonObject(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
