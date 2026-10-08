import { create } from 'zustand';

export type ModalName =
  | 'lorebook'
  | 'settings'
  | 'contextViewer'
  | 'contextSettings'
  | 'ephemeral'
  | 'systemPrompt'
  | 'stats'
  | 'storyInfo'
  | 'toolbox'
  | 'tokenize'
  | 'screenshot'
  | 'placeholders'
  | 'login'
  | 'palette'
  | 'historyTree'
  | 'modelPicker'
  | 'samplers'
  | 'scripts'
  | 'confirm';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

interface UIState {
  modal: ModalName | null;
  modalProps: Record<string, unknown>;
  toasts: Toast[];
  /** Mobile drawers. */
  mobileLeft: boolean;
  mobileRight: boolean;
  findOpen: boolean;
  open: (m: ModalName, props?: Record<string, unknown>) => void;
  close: () => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  set: (p: Partial<UIState>) => void;
  confirm: (opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
}

let nextToast = 1;

export const useUI = create<UIState>((set, get) => ({
  modal: null,
  modalProps: {},
  toasts: [],
  mobileLeft: false,
  mobileRight: false,
  findOpen: false,
  open: (modal, modalProps = {}) => set({ modal, modalProps }),
  close: () => set({ modal: null, modalProps: {} }),
  toast(text, kind = 'info') {
    const id = nextToast++;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  set: (p) => set(p),
  confirm(opts) {
    return new Promise<boolean>((resolve) => {
      set({ modal: 'confirm', modalProps: { ...opts, resolve } });
    });
  },
}));
