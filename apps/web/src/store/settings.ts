import { create } from 'zustand';
import type { ModelRef } from '@novelwriter/core';
import { api } from '../api.ts';
import { BUILTIN_THEMES, type Theme } from '../theme/themes.ts';
import { applyTheme } from '../theme/applyTheme.ts';
import { setLang, type Lang } from '../i18n.ts';
import { HOTKEYS_VERSION } from '../hotkeys.ts';

export interface Settings {
  language: Lang;
  themeName: string;
  customThemes: Theme[];
  customCss: string;
  uiScale: number;
  editorFontSize: number;
  lineSpacing: number;
  /** em, like the original (was px before; migrated on load). */
  paragraphSpacing: number;
  paragraphIndent: number;
  buttonScale: number;
  /** Percent of 1200px. */
  maxLineWidth: number;
  gestureControls: boolean;
  swapContextMenu: boolean;
  contextViewerColors: boolean;
  editorLoreKeys: boolean;
  showStoryTitle: boolean;
  showEditorToolbar: boolean;
  autoFormat: boolean;
  keyboardDisplaces: boolean;
  showIdenticon: boolean;
  showMinibar: boolean;
  /** Characters around the caret always kept rendered; 0 = never skip rendering ("No Unloading"). */
  paragraphVisibilityRange: number;
  /** Ask supporting models for token probabilities. */
  tokenProbabilities: boolean;
  /** Show them in the editor (click a token to pick an alternative). */
  editorTokenProbabilities: boolean;
  /** Alternatives requested per token. */
  logprobsCount: number;
  /** Inline generation also sees the text after the cursor. */
  bidirectionalInline: boolean;
  ttsSpeakHypebot: boolean;
  ttsTestText: string;
  ttsSavedVoices: SavedVoice[];
  loreGenModel: ModelRef | null;
  loreGenPresetId: string;
  changelogSeen: string;
  streamResponses: boolean;
  streamDelay: number;
  continueToSentenceEnd: boolean;
  preamble: boolean;
  /** Upper bound on context tokens for every story (0 = no cap beyond the preset and model). */
  maxContextCap: number;
  /** Show the System Prompt / Prefill button in the Advanced tab. */
  showSystemPromptSettings: boolean;
  defaultBias: boolean;
  hypebotMode: 'off' | 'automatic' | 'permanent';
  hypebotChance: number;
  hypebotAvatar: string;
  hypebotDelay: number;
  highlightSpeech: boolean;
  highlightSpeechInverted: boolean;
  showTips: boolean;
  /** Lorebook shown as a side panel instead of a modal. */
  loreDocked: boolean;
  /** Name shown on screenshots. */
  penName: string;
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
  /** Read the player's own inputs (input box / adventure actions) aloud. */
  ttsSpeakInputs: boolean;
  /** Browser voices, or an OpenAI-compatible speech endpoint configured on the server. */
  ttsSource: 'browser' | 'endpoint';
  ttsEndpointVoice: string;
  /** HypeBot's own voice (browser voice URI / "saved:<id>", or endpoint voice name); '' = the story voice. */
  ttsHypebotVoice: string;
  /** Endpoint audio is fetched sentence by sentence so playback starts sooner. */
  ttsStreamed: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  rightTab: 'story' | 'advanced' | 'generation' | 'chat';
  librarySort: 'recent' | 'alpha' | 'created';
  librarySortAsc: boolean;
  favoritesOnly: boolean;
  compactView: boolean;
  shelvesOnTop: boolean;
  favoritesOnTop: boolean;
  userScriptsAccepted: boolean | null;
  dismissedTips: string[];
  hotkeys: Record<string, string>;
  hotkeysVersion: number;
}

export interface SavedVoice {
  id: string;
  name: string;
  voice: string;
  rate: number;
  pitch: number;
}

export const DEFAULT_HOTKEYS: Record<string, string> = {
  toggleMenuBar: 'Alt-q|Mod-Shift-ArrowLeft',
  toggleInfoBar: 'Alt-e|Mod-Shift-ArrowRight',
  toggleBars: 'Alt-w',
  focusEditor: 'Alt-f',
  send: 'Mod-Enter|Alt-s',
  inline: 'Mod-Shift-Enter',
  stop: 'Escape',
  focusInput: 'Alt-g',
  redo: 'Alt-y|Mod-y|Mod-Shift-z',
  redoList: 'Alt-Shift-y',
  undo: 'Alt-z|Mod-z',
  retry: 'Alt-r',
  lorebook: 'Alt-l|Mod-Shift-l',
  contextViewer: 'Alt-k',
  userScripts: 'Alt-x',
  tokenizer: 'Alt-t',
  tokenProbs: 'Mod-Alt-t',
  editorTokenProbs: 'Alt-Shift-e',
  closeModal: 'Escape',
  toggleInputBox: 'Alt-j',
  toggleHighlighting: 'Alt-h',
  toggleSpellcheck: 'Alt-c',
  newStory: 'Alt-n|Mod-Shift-n',
  resetTheme: 'Alt-Shift-p',
  deleteStory: 'Alt-Shift-Delete',
  stopTTS: 'Alt-Shift-t',
  palette: 'Mod-k',
  settings: 'Mod-,',
  find: 'Mod-f',
  bold: 'Mod-b',
  italic: 'Mod-i',
  underline: 'Mod-u',
  strike: 'Mod-Shift-s',
};

export const DEFAULT_SETTINGS: Settings = {
  language: navigator.language?.startsWith('zh') ? 'zh' : 'en',
  themeName: 'NovelWriter Dark',
  customThemes: [],
  customCss: '',
  uiScale: 1,
  editorFontSize: 18,
  lineSpacing: 1.8,
  paragraphSpacing: 0.5,
  paragraphIndent: 10,
  buttonScale: 1,
  maxLineWidth: 100,
  gestureControls: true,
  swapContextMenu: false,
  contextViewerColors: true,
  editorLoreKeys: false,
  showStoryTitle: true,
  showEditorToolbar: true,
  autoFormat: true,
  keyboardDisplaces: true,
  showIdenticon: false,
  showMinibar: false,
  paragraphVisibilityRange: 1000,
  tokenProbabilities: false,
  editorTokenProbabilities: false,
  logprobsCount: 10,
  bidirectionalInline: true,
  ttsSpeakHypebot: false,
  ttsTestText: 'This is a test for text to speech. A little harsh, a little slow, but always on point.',
  ttsSavedVoices: [],
  loreGenModel: null,
  loreGenPresetId: 'default',
  changelogSeen: '',
  streamResponses: true,
  streamDelay: 0,
  continueToSentenceEnd: true,
  preamble: true,
  maxContextCap: 0,
  showSystemPromptSettings: true,
  defaultBias: true,
  hypebotMode: 'off',
  hypebotChance: 5,
  hypebotAvatar: 'auto',
  hypebotDelay: 0,
  highlightSpeech: false,
  highlightSpeechInverted: false,
  showTips: true,
  loreDocked: false,
  penName: '',
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
  ttsSpeakInputs: false,
  ttsSource: 'browser',
  ttsEndpointVoice: '',
  ttsHypebotVoice: '',
  ttsStreamed: true,
  leftOpen: true,
  rightOpen: true,
  rightTab: 'story',
  librarySort: 'recent',
  librarySortAsc: false,
  favoritesOnly: false,
  compactView: false,
  shelvesOnTop: true,
  favoritesOnTop: false,
  userScriptsAccepted: null,
  dismissedTips: [],
  hotkeys: DEFAULT_HOTKEYS,
  hotkeysVersion: HOTKEYS_VERSION,
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
  r.setProperty('--paragraph-spacing', `${s.paragraphSpacing}em`);
  r.setProperty('--paragraph-indent', `${s.paragraphIndent}px`);
  r.setProperty('--button-scale', String(s.buttonScale));
  r.setProperty('--editor-width', `${Math.round(s.maxLineWidth * 12)}px`);
  const vp = document.querySelector('meta[name="viewport"]');
  vp?.setAttribute('content', `width=device-width, initial-scale=1.0, viewport-fit=cover${s.keyboardDisplaces ? ', interactive-widget=resizes-content' : ', interactive-widget=overlays-content'}`);
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
    // Hotkey maps saved before the current defaults are dropped rather than merged.
    // Version 2+ maps only gain new actions later, so they are merged; version 1 maps are dropped.
    const savedHotkeys = (saved.hotkeysVersion ?? 1) >= 2 ? (saved.hotkeys ?? {}) : {};
    const merged = { ...DEFAULT_SETTINGS, ...saved, hotkeys: { ...DEFAULT_HOTKEYS, ...savedHotkeys }, hotkeysVersion: HOTKEYS_VERSION };
    // Built-in themes were renamed; keep users on the same theme.
    merged.themeName = merged.themeName.replace(/^NovelAI /, 'NovelWriter ');
    // Older settings stored paragraph spacing in px at an 18px font.
    if (merged.paragraphSpacing > 4) merged.paragraphSpacing = Math.round((merged.paragraphSpacing / 18) * 10) / 10;
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
