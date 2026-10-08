// Preload for the app window (sandboxed). It exposes only what the custom title bar needs:
// the platform, window state, and the window buttons. The main process checks that each
// call comes from the app's own page.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { WINDOW_CHANNELS, type DesktopBridge, type WindowControlsState } from './util.ts';

const bridge: DesktopBridge = {
  platform: process.platform,
  minimize: () => ipcRenderer.send(WINDOW_CHANNELS.minimize),
  toggleMaximize: () => ipcRenderer.send(WINDOW_CHANNELS.toggleMaximize),
  close: () => ipcRenderer.send(WINDOW_CHANNELS.close),
  showMenu: (x, y) => ipcRenderer.send(WINDOW_CHANNELS.showMenu, Math.round(x), Math.round(y)),
  getState: () => ipcRenderer.invoke(WINDOW_CHANNELS.getState) as Promise<WindowControlsState>,
  onState: (cb) => {
    const listener = (_e: IpcRendererEvent, s: WindowControlsState) => cb(s);
    ipcRenderer.on(WINDOW_CHANNELS.state, listener);
    return () => void ipcRenderer.removeListener(WINDOW_CHANNELS.state, listener);
  },
};

contextBridge.exposeInMainWorld('novelwriterDesktop', bridge);
