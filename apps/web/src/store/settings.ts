import { create } from 'zustand';
import type { ModelRef } from '@novelwriter/core';
import { api } from '../api.ts';
import { BUILTIN_THEMES, type Theme } from '../theme/themes.ts';
import { applyTheme } from '../theme/applyTheme.ts';
import { setLang, type Lang } from '../i18n.ts';

export interface Settings {
  language: Lang;
  themeName: string;
  customThemes: Theme[];
  customCss: string;
  uiScale: number;
  editorFontSize: number;
  lineSpacing: number;
  paragraphSpacing: number;
  editorWidth: number;
  streamResponses: boolean;
  streamDelay: number;
  continueToSentenceEnd: boolean;
  preamble: boolean;
  defaultBias: boolean;
  hypebotMode: 'off' | 'automatic' | 'permanent';
  hypebotChance: number;
  hypebotAvatar: string;
  hypebotDelay: number;
  highlightSpeech: boolean;
  highlightSpeechInverted: boolean;
  showTips: boolean;
  inputBox: boolean;
  editorSpellcheck: boolean;
  defaultModel: ModelRef | null;
  defaultPresetId: string;
  defaultMode: 'storyteller' | 'adventure';
  ttsVoice: string;
  ttsRate: number;
  ttsPitch: number;
  ttsVolume: number;
  ttsSpeakOutputs: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  rightTab: 'story' | 'advanced' | 'generation';
  librarySort: 'recent' | 'alpha' | 'created';
  favoritesOnly: boolean;
  dismissedTips: string[];
  hotkeys: Record<string, string>;
}

export const DEFAULT_HOTKEYS: Record<string, string> = {
  send: 'Mod-Enter',
  inline: 'Mod-Shift-Enter',
  retry: 'Alt-r',
  undo: 'Mod-z',
  redo: 'Mod-y',
  stop: 'Escape',
  lorebook: 'Mod-Shift-l',
  palette: 'Mod-k',
  toggleLeft: 'Mod-Shift-ArrowLeft',
  toggleRight: 'Mod-Shift-ArrowRight',
  newStory: 'Mod-Shift-n',
  settings: 'Mod-,',
};

export const DEFAULT_SETTINGS: Settings = {
  language: navigator.language?.startsWith('zh') ? 'zh' : 'en',
  themeName: 'NovelAI Dark',
  customThemes: [],
  customCss: '',
  uiScale: 1,
  editorFontSize: 18,
  lineSpacing: 1.8,
  paragraphSpacing: 9,
  editorWidth: 780,
  streamResponses: true,
  streamDelay: 0,
  continueToSentenceEnd: true,
  preamble: true,
  defaultBias: true,
  hypebotMode: 'off',
  hypebotChance: 5,
  hypebotAvatar: 'auto',
  hypebotDelay: 0,
  highlightSpeech: false,
  highlightSpeechInverted: false,
  showTips: true,
  inputBox: false,
  editorSpellcheck: false,
  defaultModel: null,
  defaultPresetId: 'default',
  defaultMode: 'storyteller',
  ttsVoice: '',
  ttsRate: 1,
  ttsPitch: 1,
  ttsVolume: 1,
  ttsSpeakOutputs: false,
  leftOpen: true,
  rightOpen: true,
  rightTab: 'story',
  librarySort: 'recent',
  favoritesOnly: false,
  dismissedTips: [],
  hotkeys: DEFAULT_HOTKEYS,
};

interface SettingsState extends Settings {
  loaded: boolean;
  load: () => Promise<void>;
  set: (patch: Partial<Settings>) => void;
  theme: () => Theme;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function applyVisual(s: Settings): void {
  const all = [...BUILTIN_THEMES, ...s.customThemes];
  const theme = all.find((t) => t.name === s.themeName) ?? BUILTIN_THEMES[0];
  applyTheme(theme, s.customCss);
  const r = document.documentElement.style;
  r.setProperty('--ui-scale', String(s.uiScale));
  r.setProperty('--editor-font-size', `${s.editorFontSize}px`);
  r.setProperty('--editor-line-height', String(s.lineSpacing));
  r.setProperty('--paragraph-spacing', `${s.paragraphSpacing}px`);
  r.setProperty('--editor-width', `${s.editorWidth}px`);
  setLang(s.language);
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    let saved: Partial<Settings> = {};
    try {
      saved = (await api.getSettings()) as Partial<Settings>;
    } catch {
      /* server unreachable: keep defaults */
    }
    const merged = { ...DEFAULT_SETTINGS, ...saved, hotkeys: { ...DEFAULT_HOTKEYS, ...(saved.hotkeys ?? {}) } };
    applyVisual(merged);
    set({ ...merged, loaded: true });
  },
  set(patch) {
    set(patch);
    const s = get();
    applyVisual(s);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { loaded: _l, load: _a, set: _b, theme: _c, ...data } = get();
      void api.saveSettings(data).catch(() => {});
    }, 400);
  },
  theme() {
    const s = get();
    return [...BUILTIN_THEMES, ...s.customThemes].find((t) => t.name === s.themeName) ?? BUILTIN_THEMES[0];
  },
}));
