// Electron main process: starts the NovelWriter server in-process and shows it in a window.
import { app, BrowserWindow, Menu, dialog, ipcMain, screen, session, shell, type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, type RunningServer } from './server.ts';
import { MIN_SIZE, WINDOW_CHANNELS, isAppUrl, isExternalHttpUrl, menuPoint, parseJsonObject, restoreBounds, type WindowControlsState, type WindowState } from './util.ts';

const REPO_URL = 'https://github.com/LianZiZhou/NovelWriter';

let server: RunningServer | undefined;
let mainWindow: BrowserWindow | undefined;
let quitting = false;
let appOrigin = '';

const userData = () => app.getPath('userData');
const dataDir = () => resolve(process.env.NOVELWRITER_DATA || join(userData(), 'data'));
// Unpackaged, this file runs as apps/desktop/dist/main.mjs; packaged, electron-builder
// copies the web UI and the icon into the resources folder.
const fromBundle = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
/** The built web UI. */
const staticDir = () => (app.isPackaged ? join(process.resourcesPath, 'web') : fromBundle('../../web/dist'));
const iconPath = () => (app.isPackaged ? join(process.resourcesPath, 'icon.png') : fromBundle('../build/icon.png'));

// ------------------------------------------------------------------ small JSON state files in userData
function readState<T extends object>(name: string): Partial<T> {
  try {
    return parseJsonObject(readFileSync(join(userData(), name), 'utf8')) as Partial<T>;
  } catch {
    return {};
  }
}
function writeState(name: string, value: unknown): void {
  try {
    mkdirSync(userData(), { recursive: true });
    writeFileSync(join(userData(), name), JSON.stringify(value, null, 2));
  } catch {
    // Not fatal: the next launch just uses defaults.
  }
}

// ------------------------------------------------------------------ links
function openExternal(url: string): void {
  if (isExternalHttpUrl(url)) void shell.openExternal(url);
}

// ------------------------------------------------------------------ title bar
// The page draws its own title bar (apps/web/src/components/TitleBar.tsx). macOS keeps the
// native traffic lights inset into it; Windows and Linux get a frameless window whose
// buttons are drawn by the page and call back here through the preload bridge.
const TITLE_BAR_HEIGHT = 38;

function windowControlsState(win: BrowserWindow): WindowControlsState {
  return { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), focused: win.isFocused() };
}

/** The window behind an IPC call, only when the call comes from the app's own page. */
function trustedWindow(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | undefined {
  const url = event.senderFrame?.url ?? '';
  if (!appOrigin || !isAppUrl(url, appOrigin)) return undefined;
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

function registerWindowControls(): void {
  ipcMain.on(WINDOW_CHANNELS.minimize, (e) => trustedWindow(e)?.minimize());
  ipcMain.on(WINDOW_CHANNELS.toggleMaximize, (e) => {
    const win = trustedWindow(e);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(WINDOW_CHANNELS.close, (e) => trustedWindow(e)?.close());
  ipcMain.on(WINDOW_CHANNELS.showMenu, (e, x: unknown, y: unknown) => {
    const win = trustedWindow(e);
    if (!win) return;
    const [width, height] = win.getContentSize();
    Menu.getApplicationMenu()?.popup({ window: win, ...menuPoint(x, y, width, height) });
  });
  ipcMain.handle(WINDOW_CHANNELS.getState, (e) => {
    const win = trustedWindow(e);
    return win ? windowControlsState(win) : undefined;
  });
}

// ------------------------------------------------------------------ window
function createWindow(origin: string): BrowserWindow {
  const saved = readState<WindowState>('window-state.json');
  const bounds = restoreBounds(saved, screen.getAllDisplays().map((d) => d.workArea));
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: 'NovelWriter',
    backgroundColor: '#1d1e2c',
    icon: process.platform === 'linux' ? iconPath() : undefined,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: (TITLE_BAR_HEIGHT - 16) / 2 } }
      : { frame: false }),
    webPreferences: {
      preload: fromBundle('./preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });
  if (saved.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  const save = () => {
    if (win.isDestroyed()) return;
    writeState('window-state.json', { bounds: win.getNormalBounds(), maximized: win.isMaximized() } satisfies WindowState);
  };
  win.on('close', save);
  const sendState = () => {
    if (!win.isDestroyed()) win.webContents.send(WINDOW_CHANNELS.state, windowControlsState(win));
  };
  win.on('maximize', sendState);
  win.on('unmaximize', sendState);
  win.on('enter-full-screen', sendState);
  win.on('leave-full-screen', sendState);
  win.on('focus', sendState);
  win.on('blur', sendState);
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
  });

  // New windows (target=_blank, window.open, OAuth login and device-code links)
  // go to the system browser; only http(s) URLs are passed on.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  // The window itself never leaves the app's own server.
  const guard = (event: Electron.Event, url: string) => {
    if (isAppUrl(url, origin)) return;
    event.preventDefault();
    openExternal(url);
  };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || quitting) return;
    void dialog
      .showMessageBox(win, { type: 'error', message: 'The NovelWriter window stopped unexpectedly.', detail: details.reason, buttons: ['Reload', 'Quit'] })
      .then(({ response }) => (response === 0 ? win.reload() : app.quit()));
  });

  void win.loadURL(`${origin}/`);
  return win;
}

// ------------------------------------------------------------------ menu
function buildMenu(): Menu {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'NovelWriter on GitHub', click: () => openExternal(REPO_URL) },
        { label: 'Report an Issue', click: () => openExternal(`${REPO_URL}/issues`) },
        { type: 'separator' },
        { label: 'Open Data Folder', click: () => void shell.openPath(dataDir()) },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'about' as const }]),
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

// ------------------------------------------------------------------ lifecycle
async function start(): Promise<void> {
  mkdirSync(dataDir(), { recursive: true });
  const prefs = readState<{ port: number }>('server.json');
  server = await startServer({
    dataDir: dataDir(),
    staticDir: staticDir(),
    preferredPort: prefs.port,
    logger: Boolean(process.env.NOVELWRITER_DEBUG),
  });
  // Reuse the port next time so the page origin (and its localStorage) stays the same.
  if (prefs.port !== server.port) writeState('server.json', { port: server.port });

  const { origin, authorization } = server;
  appOrigin = origin;
  const ses = session.defaultSession;
  // Every request to our server (including the login WebSocket) carries the per-launch password.
  ses.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`, `ws://127.0.0.1:${server.port}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, Authorization: authorization } });
  });
  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(isAppUrl(wc.getURL(), origin) && allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => requestingOrigin === origin && allowed.has(permission));

  Menu.setApplicationMenu(buildMenu());
  registerWindowControls();
  mainWindow = createWindow(origin);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('io.github.lianzizhou.novelwriter');
  app.setAboutPanelOptions({ applicationName: 'NovelWriter', applicationVersion: app.getVersion(), website: REPO_URL });

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  // Nothing else may create windows or webviews.
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (!mainWindow && server) mainWindow = createWindow(server.origin);
  });

  // Close the server (and with it any pending login callback servers) before exiting.
  app.on('before-quit', (event) => {
    quitting = true;
    if (!server) return;
    const s = server;
    server = undefined;
    event.preventDefault();
    const timeout = new Promise((r) => setTimeout(r, 3000));
    void Promise.race([s.close().catch(() => {}), timeout]).finally(() => app.quit());
  });

  app
    .whenReady()
    .then(start)
    .catch((e: unknown) => {
      dialog.showErrorBox('NovelWriter could not start', e instanceof Error ? (e.stack ?? e.message) : String(e));
      app.exit(1);
    });
}
