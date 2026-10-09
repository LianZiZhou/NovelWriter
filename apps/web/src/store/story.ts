import { useRef } from 'react';
import { create } from 'zustand';
import {
  BUILTIN_PRESETS,
  adventureInputWith,
  amend,
  applyChange,
  backendCaps,
  stripBraces,
  docLength,
  slice,
  visibleTokenProbs,
  setNodeProbs,
  type TokenLogprob,
  type TokenProb,
  buildHypebotRequest,
  buildStoryRequest,
  buildSummaryRequest,
  countTokens,
  nextLoreState,
  requestTokenEstimate,
  stripComments,
  updateCalibration,
  type StoryRequestOptions,
  buildTitleRequest,
  cloneJson,
  commit,
  defaultParams,
  docText,
  exportStoryFile,
  flatten as flattenHistory,
  fromParagraphs,
  importFile,
  jumpTo,
  mergeLorebook,
  migrateStory,
  findEphemeralLines,
  newStory,
  paragraphs,
  postProcess,
  redo as historyRedo,
  retryOptions,
  trim as trimHistory,
  undo as historyUndo,
  uid,
  type AdventureInputMode,
  type BuiltContext,
  type Change,
  type ChatMessage,
  type HistoryNodeType,
  type ModelRef,
  type MoodModel,
  type Preset,
  type Shelf,
  type Span,
  type Story,
  type StoryMeta,
} from '@novelwriter/core';
import { api, capsOf, generateStream, generateText, type ModelInfo } from '../api.ts';
import { useSettings } from './settings.ts';
import { searchVectors, syncVectors, useEmbeddings } from './embeddings.ts';
import { useUI } from './ui.ts';
import { t } from '../i18n.ts';
import { speak } from '../features/tts/tts.ts';
import { hasHook, runScriptHook } from '../features/scripts/host.ts';

/** Implemented by the editor component so the store can drive it. Offsets are plain-text offsets. */
export interface EditorController {
  setDoc(doc: Span[], cursor?: number): void;
  replaceRange(from: number, to: number, spans: Span[]): void;
  getSelection(): { from: number; to: number; text: string };
  focus(): void;
  scrollToEnd(): void;
}

/** Canonical form: newline origins follow the editor's serialization rule. */
export function canonical(doc: Span[]): Span[] {
  return fromParagraphs(paragraphs(doc));
}

/** What a generation produced (the Director reads it back). */
export interface PassageResult {
  /** Text added to the story ('' when nothing was). */
  text: string;
  /** Where it went. */
  from: number;
  error?: string;
  aborted: boolean;
  /** History node of the generation, and the node current before it. */
  node?: string;
  nodeBefore?: string;
}

export interface PassageOptions {
  /** A direction for this passage only, shown to the writing model with the author's note. */
  directive?: string;
  /** Output length in characters for this passage. */
  maxLength?: number;
}

export interface HypebotComment {
  text: string;
  time: number;
}

interface StoryState {
  library: StoryMeta[];
  shelves: Shelf[];
  presets: Preset[];
  models: ModelInfo[];
  current: Story | null;
  loadingStory: boolean;
  generating: boolean;
  /** 'story' for normal sends, or the auxiliary task in progress. */
  task: string | null;
  lastContext: BuiltContext | null;
  /** The last request as sent: system prompt and chat messages (after user scripts). */
  lastRequest: { system: string; messages: ChatMessage[] } | null;
  /** What the next request would look like, as system prompt and messages. */
  previewRequest: () => { system: string; messages: ChatMessage[] } | null;
  hypebot: HypebotComment | null;
  editor: EditorController | null;
  serverDown: boolean;
  activeShelf: string | null;

  init: () => Promise<void>;
  reload: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  openStory: (id: string) => Promise<void>;
  closeStory: () => void;
  showNewStory: () => void;
  showDashboard: () => void;
  /** Which home page shows when no story is open. */
  page: 'dashboard' | 'newStory';
  createStory: (p?: Partial<Story>) => Promise<Story>;
  addStory: (s: Story) => Promise<void>;
  update: (fn: (s: Story) => Story | void) => void;
  deleteStory: (id: string) => Promise<void>;
  duplicateStory: (id: string) => Promise<void>;
  downloadStory: (id: string) => Promise<void>;
  setFavorite: (id: string, fav: boolean) => Promise<void>;
  /** Move a story onto a shelf (null = the library root). */
  setShelf: (id: string, shelf: string | null) => Promise<void>;
  /** Ask HypeBot for a new comment on the recent story (clicking its avatar). */
  requestHypebot: () => Promise<void>;
  importFiles: (files: FileList | File[]) => Promise<void>;
  saveShelves: (s: Shelf[]) => void;
  savePresets: (p: Preset[]) => void;
  allPresets: () => Preset[];
  setEditor: (e: EditorController | null) => void;

  /** Apply a user edit made in the editor (computed incrementally by the editor). */
  editorChanged: (change: Change) => void;
  /** Replace plain-text range [from, to) with `text` as one undoable edit (scripts, find & replace). */
  replaceText: (from: number, to: number, text: string, origin?: Span['origin']) => void;
  undo: () => void;
  redo: (childId?: string) => void;
  jump: (nodeId: string) => void;
  send: (input?: { text: string; mode?: AdventureInputMode }) => Promise<void>;
  retry: () => Promise<void>;
  /**
   * Token probabilities: replace a generated token with an alternative, drop the rest of that generation,
   * and continue generating from there when it was at the end of the story.
   */
  pickAlternative: (nodeId: string, from: number, to: number, text: string) => Promise<void>;
  generateInline: () => Promise<void>;
  /**
   * Generate one passage at the end of the story for the Director: no toasts, errors come back in the
   * result, and the running summary is brought up to date before it resolves.
   */
  generatePassage: (o?: PassageOptions) => Promise<PassageResult>;
  stop: () => void;
  /** `ask`: confirm before replacing a title the user already has. */
  generateTitle: (ask?: boolean) => Promise<void>;
  resolveModel: () => ModelRef | null;
  modelInfo: () => ModelInfo | undefined;
  previewContext: () => BuiltContext | null;
  trimStory: () => void;
  flattenStory: () => void;
  resetToPrompt: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let abort: AbortController | null = null;
/** Bumped on every navigation so slow story loads can't override a newer choice. */
let navSeq = 0;
let initPromise: Promise<void> | null = null;
let lastEditAt = 0;

/** A save is scheduled but hasn't started; flushed when the page is hidden or closed. */
let pendingSave: (() => void) | null = null;

function scheduleSave(get: () => StoryState, set: (p: Partial<StoryState>) => void) {
  clearTimeout(saveTimer);
  const save = async () => {
    pendingSave = null;
    const s = get().current;
    if (!s) return;
    try {
      const meta = await api.saveStory(s);
      set({ library: upsertMeta(get().library, meta), serverDown: false });
    } catch {
      set({ serverDown: true });
    }
  };
  pendingSave = () => {
    clearTimeout(saveTimer);
    pendingSave = null;
    const s = get().current;
    if (!s) return;
    // keepalive lets the request outlive the page, but only for small bodies (64 KB); larger ones go out normally.
    const body = JSON.stringify(s);
    void fetch(`/api/stories/${s.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body, keepalive: body.length < 60000 }).catch(() => {});
  };
  saveTimer = setTimeout(() => whenIdle(() => void save()), 600);
}

/** Send a scheduled save now instead of after the debounce (a Director run that just ended, say). */
export function flushSave(): void {
  pendingSave?.();
}

if (typeof window !== 'undefined') {
  const flush = () => pendingSave?.();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}

/** Run off the typing path: serializing a long story takes a while. */
function whenIdle(fn: () => void): void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 0);
}

function upsertMeta(list: StoryMeta[], m: StoryMeta): StoryMeta[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i < 0) return [m, ...list];
  const next = [...list];
  next[i] = m;
  return next;
}

/** Providers tried in order when no model is chosen; ambient-credential and demo providers come last. */
const PROVIDER_PREFERENCE = ['anthropic', 'openai-codex', 'openai', 'github-copilot', 'openrouter', 'google', 'xai', 'deepseek', 'mistral', 'moonshotai', 'zai'];
const MODEL_PREFERENCE = /sonnet|gpt-5(?!.*(nano|mini))|gemini-.*pro|grok-4|deepseek-(chat|v)|mistral-large|kimi|glm/i;

/** "Auto Format Text": tidy whitespace in generated text (double spaces, trailing spaces, extra blank lines). */
export function autoFormat(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/(\S) {2,}(?=\S)/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n');
}

const DOC_FIELDS = new Set(['doc', 'history', 'updatedAt', 'step']);

/**
 * The open story for panels that don't show the text: it only changes when something other than the
 * document, history or step changes, so typing doesn't re-render them. Its `doc`/`history` may be stale.
 */
export function useStoryMeta(): Story | null {
  const ref = useRef<Story | null>(null);
  return useStory((st) => {
    const c = st.current;
    const prev = ref.current;
    if (prev && c && prev.id === c.id) {
      let same = true;
      for (const k in c) {
        if (!DOC_FIELDS.has(k) && (c as unknown as Record<string, unknown>)[k] !== (prev as unknown as Record<string, unknown>)[k]) {
          same = false;
          break;
        }
      }
      if (same) return prev;
    }
    ref.current = c;
    return c;
  });
}

export function preferredModel(models: ModelInfo[]): ModelInfo | undefined {
  const rank = (p: string) => {
    if (p === 'demo') return 1000;
    if (p === 'amazon-bedrock' || p === 'google-vertex') return 900;
    const i = PROVIDER_PREFERENCE.indexOf(p);
    return i < 0 ? 500 : i;
  };
  const providers = [...new Set(models.map((m) => m.provider))].sort((a, b) => rank(a) - rank(b));
  const best = providers[0];
  if (!best) return undefined;
  const list = models.filter((m) => m.provider === best);
  return list.find((m) => MODEL_PREFERENCE.test(m.id)) ?? list[0];
}

function hasAIText(s: Story): boolean {
  return s.step > 0 || Object.values(s.history.nodes).some((n) => n.type === 'ai');
}

/** Classify a user change by the origins of the inserted spans. */
function nodeTypeFor(change: Change, s: Story): HistoryNodeType {
  if (!hasAIText(s)) return 'prompt';
  if (change.inserted.some((sp) => sp.origin === 'edit') || (change.removed.length && !change.inserted.length)) return 'edit';
  return 'user';
}

function download(name: string, data: BlobPart, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(s: string): string {
  return (s || 'story').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
}

export { download };

export const useStory = create<StoryState>((set, get) => ({
  library: [],
  shelves: [],
  presets: [],
  models: [],
  current: null,
  page: 'dashboard',
  loadingStory: false,
  generating: false,
  task: null,
  lastContext: null,
  lastRequest: null,
  hypebot: null,
  editor: null,
  serverDown: false,
  activeShelf: null,

  init() {
    initPromise ??= get().reload();
    return initPromise;
  },

  async reload() {
    const seq = ++navSeq;
    try {
      const [library, shelves, presets] = await Promise.all([api.listStories(), api.getShelves(), api.getPresets()]);
      set({ library, shelves, presets, serverDown: false });
      await get().refreshModels();
      const lastId = localStorage.getItem('nw:lastStory');
      const target = library.find((m) => m.id === lastId) ?? library[0];
      if (target && seq === navSeq) await get().openStory(target.id);
    } catch {
      set({ serverDown: true });
    }
  },

  async refreshModels() {
    try {
      const providers = await api.providers();
      const configured = new Set(providers.filter((p) => p.configured).map((p) => p.id));
      const models = (await api.models()).filter((m) => configured.has(m.provider));
      set({ models });
    } catch {
      /* ignore */
    }
  },

  async refreshLibrary() {
    try {
      set({ library: await api.listStories(), serverDown: false });
    } catch {
      set({ serverDown: true });
    }
  },

  async openStory(id) {
    if (get().current?.id === id) return;
    abort?.abort();
    const seq = ++navSeq;
    set({ loadingStory: true });
    try {
      const s = migrateStory(await api.getStory(id));
      if (seq !== navSeq) return;
      s.doc = canonical(s.doc);
      localStorage.setItem('nw:lastStory', id);
      set({ current: s, loadingStory: false, lastContext: null, hypebot: null, generating: false });
    } catch (e) {
      set({ loadingStory: false });
      useUI.getState().toast((e as Error).message, 'error');
    }
  },

  closeStory() {
    navSeq++;
    set({ current: null, page: 'dashboard' });
    localStorage.removeItem('nw:lastStory');
  },

  showNewStory() {
    navSeq++;
    abort?.abort();
    set({ current: null, loadingStory: false, page: 'newStory' });
  },

  showDashboard() {
    navSeq++;
    abort?.abort();
    set({ current: null, loadingStory: false, page: 'dashboard' });
  },

  async createStory(p = {}) {
    const settings = useSettings.getState();
    const preset = get().allPresets().find((x) => x.id === settings.defaultPresetId) ?? BUILTIN_PRESETS[0];
    const s = newStory({
      mode: settings.defaultMode,
      presetId: preset.id,
      params: cloneJson(preset.params),
      model: settings.defaultModel ?? settings.lastModel,
      shelf: get().activeShelf,
      ...p,
    });
    await get().addStory(s);
    return s;
  },

  async addStory(s) {
    navSeq++;
    s.doc = canonical(s.doc);
    set({ current: s, lastContext: null, hypebot: null, library: upsertMeta(get().library, { id: s.id, title: s.title, description: s.description, preview: docText(s.doc).slice(0, 200), tags: s.tags, favorite: s.favorite, shelf: s.shelf, mode: s.mode, createdAt: s.createdAt, updatedAt: s.updatedAt }) });
    localStorage.setItem('nw:lastStory', s.id);
    try {
      await api.saveStory(s);
    } catch {
      set({ serverDown: true });
    }
  },

  update(fn) {
    const cur = get().current;
    if (!cur) return;
    const draft = { ...cur };
    const res = fn(draft) ?? draft;
    res.updatedAt = Date.now();
    set({ current: res });
    scheduleSave(get, set);
  },

  async deleteStory(id) {
    await api.deleteStory(id).catch(() => {});
    const library = get().library.filter((m) => m.id !== id);
    set({ library });
    if (get().current?.id === id) {
      set({ current: null, page: 'dashboard' });
      if (library[0]) await get().openStory(library[0].id);
    }
  },

  async duplicateStory(id) {
    const src = get().current?.id === id ? get().current! : await api.getStory(id);
    const copy = migrateStory({ ...cloneJson(src), id: uid(), title: `${src.title} (copy)`, createdAt: Date.now(), updatedAt: Date.now() });
    await get().addStory(copy);
  },

  async downloadStory(id) {
    const s = get().current?.id === id ? get().current! : await api.getStory(id);
    download(`${safeFileName(s.title)}.story`, exportStoryFile(s));
  },

  async setFavorite(id, fav) {
    if (get().current?.id === id) {
      get().update((s) => {
        s.favorite = fav;
      });
      return;
    }
    const s = await api.getStory(id);
    s.favorite = fav;
    const meta = await api.saveStory(s);
    set({ library: upsertMeta(get().library, meta) });
  },

  async requestHypebot() {
    const text = docText(get().current?.doc ?? []);
    await maybeHypebot(set, get, text.slice(-600), true);
  },

  async setShelf(id, shelf) {
    // Update the card right away so a dragged story leaves the list at once.
    set({ library: get().library.map((m) => (m.id === id ? { ...m, shelf } : m)) });
    if (get().current?.id === id) {
      get().update((s) => {
        s.shelf = shelf;
      });
      return;
    }
    const s = await api.getStory(id);
    s.shelf = shelf;
    const meta = await api.saveStory(s);
    set({ library: upsertMeta(get().library, meta) });
  },

  async importFiles(files) {
    const ui = useUI.getState();
    for (const f of Array.from(files)) {
      try {
        const isBinary = /\.png$/i.test(f.name) || f.type === 'image/png';
        const content = isBinary ? new Uint8Array(await f.arrayBuffer()) : await f.text();
        const r = importFile(f.name, content);
        if (r.kind === 'story') {
          await get().addStory(r.story);
          if (r.needsPlaceholders) ui.open('placeholders');
          ui.toast(t('Imported "{name}"', { name: r.story.title }), 'success');
        } else if (r.kind === 'lorebook') {
          if (!get().current) await get().createStory();
          get().update((s) => {
            s.lorebook = mergeLorebook(s.lorebook, r.lorebook);
          });
          ui.toast(t('Imported {n} lorebook entries', { n: r.lorebook.entries.length }), 'success');
        } else if (r.kind === 'bias') {
          get().update((s) => {
            s.phraseBias = [...s.phraseBias, ...r.groups];
          });
          ui.toast(t('Imported phrase bias'), 'success');
        } else if (r.kind === 'preset') {
          const p: Preset = { id: uid(), name: r.preset.name, params: r.preset.params };
          get().savePresets([...get().presets, p]);
          ui.toast(t('Imported preset "{name}"', { name: p.name }), 'success');
        } else if (r.kind === 'banned') {
          if (!get().current) await get().createStory();
          get().update((s) => {
            s.bannedTokens = [...new Set([...s.bannedTokens, ...r.phrases])];
          });
          ui.toast(t('Imported {n} banned tokens', { n: r.phrases.length }), 'success');
        } else if (r.kind === 'module') {
          if (!get().current) await get().createStory();
          get().update((s) => {
            s.authorsNote = s.authorsNote ? `${s.authorsNote}\n${r.note}` : r.note;
          });
          ui.toast(t('"{name}" is a trained AI module, which can\'t run here. Its description was added to the Author\'s Note as a style hint.', { name: r.name }), 'info');
        } else if (r.kind === 'theme') {
          const th = r.theme as { name?: string };
          const st = useSettings.getState();
          const theme = { ...(r.theme as object), name: th.name ?? 'Imported Theme' } as (typeof st.customThemes)[number];
          st.set({ customThemes: [...st.customThemes.filter((x) => x.name !== theme.name), theme], themeName: theme.name });
        }
      } catch (e) {
        ui.toast(`${f.name}: ${(e as Error).message}`, 'error');
      }
    }
  },

  saveShelves(shelves) {
    set({ shelves });
    void api.saveShelves(shelves).catch(() => {});
  },

  savePresets(presets) {
    set({ presets });
    void api.savePresets(presets).catch(() => {});
  },

  allPresets() {
    return [...BUILTIN_PRESETS, ...get().presets];
  },

  setEditor(editor) {
    set({ editor });
  },

  // ------------------------------------------------------------------ editing & history

  editorChanged(change) {
    const s = get().current;
    if (!s || get().generating) return;
    const doc = applyChange(s.doc, change);
    const type = nodeTypeFor(change, s);
    const cur = s.history.nodes[s.history.current];
    const now = Date.now();
    const canAmend = cur.type === type && cur.children.length === 0 && now - lastEditAt < 2500 && cur.type !== 'ai' && cur.type !== 'root';
    lastEditAt = now;
    get().update((st) => {
      st.history = canAmend ? amend(st.history, [change]) : commit(st.history, type, [change]).history;
      st.doc = doc;
    });
  },

  replaceText(from, to, text, origin = 'edit') {
    const s = get().current;
    if (!s) return;
    const len = docText(s.doc).length;
    const a = Math.max(0, Math.min(len, from));
    const b = Math.max(a, Math.min(len, to));
    const change: Change = { pos: a, removed: slice(s.doc, a, b), inserted: text ? [{ text, origin }] : [] };
    if (!change.removed.length && !change.inserted.length) return;
    const doc = canonical(applyChange(s.doc, change));
    get().update((st) => {
      st.history = commit(st.history, origin === 'ai' ? 'ai' : 'edit', [change]).history;
      st.doc = doc;
    });
    get().editor?.setDoc(doc);
  },

  undo() {
    const s = get().current;
    if (!s || get().generating) return;
    const r = historyUndo(s.history, s.doc);
    if (!r) return;
    const doc = canonical(r.doc);
    const pos = s.history.nodes[s.history.current].changes[0]?.pos;
    get().update((st) => {
      st.history = r.history;
      st.doc = doc;
    });
    get().editor?.setDoc(doc, pos);
    if (hasHook('onHistoryNavigated')) void runScriptHook('onHistoryNavigated', { action: 'undo', nodeId: get().current?.history.current });
  },

  redo(childId) {
    const s = get().current;
    if (!s || get().generating) return;
    const r = historyRedo(s.history, s.doc, childId);
    if (!r) return;
    const doc = canonical(r.doc);
    get().update((st) => {
      st.history = r.history;
      st.doc = doc;
    });
    get().editor?.setDoc(doc);
    if (hasHook('onHistoryNavigated')) void runScriptHook('onHistoryNavigated', { action: 'redo', nodeId: get().current?.history.current });
  },

  jump(nodeId) {
    const s = get().current;
    if (!s || get().generating) return;
    const r = jumpTo(s.history, s.doc, nodeId);
    const doc = canonical(r.doc);
    get().update((st) => {
      st.history = r.history;
      st.doc = doc;
    });
    get().editor?.setDoc(doc);
    if (hasHook('onHistoryNavigated')) void runScriptHook('onHistoryNavigated', { action: 'jump', nodeId });
  },

  resolveModel() {
    const s = get().current;
    const settings = useSettings.getState();
    const models = get().models;
    // The story's own model, then the default, then the one used last; the first still connected wins.
    const picks = [s?.model, settings.defaultModel, settings.lastModel].filter((m): m is ModelRef => !!m);
    const live = picks.find((p) => models.some((m) => m.provider === p.provider && m.id === p.id));
    if (live) return live;
    if (picks.length && models.length === 0) return picks[0];
    const first = preferredModel(models);
    return first ? { provider: first.provider, id: first.id } : null;
  },

  modelInfo() {
    const ref = get().resolveModel();
    return ref ? get().models.find((m) => m.provider === ref.provider && m.id === ref.id) : undefined;
  },

  previewRequest() {
    const s = get().current;
    if (!s) return null;
    const info = get().modelInfo();
    const maxCtx = Math.min(s.params.maxContext, info?.contextWindow ?? Infinity, useSettings.getState().maxContextCap || Infinity);
    const req = buildStoryRequest(s, requestOptions(info, { maxContextTokens: maxCtx, model: info?.id, vectors: useEmbeddings.getState().hits[s.id] }));
    return { system: req.system, messages: req.messages };
  },

  previewContext() {
    const s = get().current;
    if (!s) return null;
    const info = get().modelInfo();
    const maxCtx = Math.min(s.params.maxContext, info?.contextWindow ?? Infinity, useSettings.getState().maxContextCap || Infinity);
    return buildStoryRequest(s, requestOptions(info, { maxContextTokens: maxCtx, model: info?.id, vectors: useEmbeddings.getState().hits[s.id] })).context;
  },

  async send(input) {
    let s = get().current;
    const ui = useUI.getState();
    if (!s || get().generating) return;
    const model = get().resolveModel();
    if (!model) {
      ui.toast(t('No AI model is configured. Open Settings → AI Providers to sign in, or use the offline Demo model.'), 'error');
      ui.open('settings', { tab: 'providers' });
      return;
    }

    // Player/user input from the input box or adventure bar is appended first.
    if (input && input.text.trim()) {
      const hooked = hasHook('onTextAdventureInput') ? await runScriptHook('onTextAdventureInput', { text: input.text, mode: input.mode ?? 'do' }) : { text: input.text };
      s = get().current!;
      if (useSettings.getState().ttsSpeakInputs) speak(hooked.text);
      let text = s.mode === 'adventure' ? await adventureInputWith(hooked.text, input.mode ?? 'do', docText(s.doc), moodModel) : hooked.text;
      const before = docText(s.doc);
      if (before && !before.endsWith('\n')) text = '\n' + text;
      if (s.mode === 'adventure') text += '\n';
      const origin = hasAIText(s) ? 'user' : 'prompt';
      const change: Change = { pos: before.length, removed: [], inserted: [{ text, origin }] };
      const doc = canonical(applyChange(s.doc, change));
      get().update((st) => {
        st.history = commit(st.history, origin, [change]).history;
        st.doc = doc;
      });
      get().editor?.setDoc(doc);
      s = get().current!;
    }

    // Lines typed in ephemeral syntax ({+1~5,-2:…}) move out of the story into Ephemeral Context.
    const eph = findEphemeralLines(docText(s.doc), s.step);
    if (eph.length) {
      const changes: Change[] = [...eph].reverse().map((e) => ({ pos: e.from, removed: slice(s!.doc, e.from, e.to), inserted: [] }));
      const doc = canonical(changes.reduce((d, c) => applyChange(d, c), s.doc));
      get().update((st) => {
        st.history = commit(st.history, 'edit', changes).history;
        st.doc = doc;
        st.ephemeral = [...st.ephemeral, ...eph.map((e) => e.entry)];
      });
      get().editor?.setDoc(doc);
      ui.toast(eph.length === 1 ? t('Added an Ephemeral Context entry.') : t('Added {n} Ephemeral Context entries.', { n: eph.length }), 'success');
      s = get().current!;
    }
    await runGeneration(set, get, { from: docText(s.doc).length });
  },

  async retry() {
    const s = get().current;
    if (!s || get().generating) return;
    const cur = s.history.nodes[s.history.current];
    if (cur.type === 'ai') {
      const r = historyUndo(s.history, s.doc)!;
      const doc = canonical(r.doc);
      get().update((st) => {
        st.history = r.history;
        st.doc = doc;
      });
      get().editor?.setDoc(doc);
      const pos = cur.changes[0]?.pos ?? docText(doc).length;
      const end = docText(doc).length;
      await runGeneration(set, get, pos < end ? { from: pos, inline: true } : { from: end });
    } else {
      await get().send();
    }
  },

  async pickAlternative(nodeId, from, to, text) {
    const s = get().current;
    if (!s || get().generating) return;
    const ranges = visibleTokenProbs(s.history).filter((r) => r.node === nodeId);
    const end = Math.max(to, ...ranges.map((r) => r.to));
    const len = docLength(s.doc);
    const change: Change = { pos: from, removed: slice(s.doc, from, end), inserted: text ? [{ text, origin: 'ai' }] : [] };
    const doc = canonical(applyChange(s.doc, change));
    get().update((st) => {
      st.history = commit(st.history, 'edit', [change]).history;
      st.doc = doc;
    });
    get().editor?.setDoc(doc, from + text.length);
    if (end >= len) await runGeneration(set, get, { from: docLength(doc) });
  },

  async generateInline() {
    const s = get().current;
    const ed = get().editor;
    if (!s || !ed || get().generating) return;
    const sel = ed.getSelection();
    const end = docText(s.doc).length;
    await runGeneration(set, get, sel.to < end ? { from: sel.to, inline: true } : { from: end });
  },

  async generatePassage(o = {}) {
    const s = get().current;
    if (!s) return { text: '', from: 0, aborted: false, error: 'No story is open.' };
    const from = docText(s.doc).length;
    if (get().generating) return { text: '', from, aborted: false, error: 'A generation is already running.' };
    if (!get().resolveModel()) return { text: '', from, aborted: false, error: 'No AI model is configured.' };
    return runGeneration(set, get, { from, ...o, quiet: true, awaitSummary: true });
  },

  stop() {
    abort?.abort();
  },

  async generateTitle(ask) {
    const s = get().current;
    const model = get().resolveModel();
    if (!s || !model) return;
    if (ask && s.title.trim() && s.title !== 'New Story') {
      const ok = await useUI.getState().confirm({ title: t('Generate a new title?'), message: t('The current title will be replaced. Previous titles stay in the Title Generation History in Story Settings.'), confirmLabel: t('Generate') });
      if (!ok) return;
    }
    set({ task: 'title' });
    try {
      const req = buildTitleRequest(s);
      const title = (await generateText({ model, ...req, maxTokens: 30, params: { temperature: 1 } })).trim().replace(/^["“']|["”']$/g, '').split('\n')[0];
      if (title) {
        get().update((st) => {
          st.title = title;
          st.titleHistory = [title, ...st.titleHistory].slice(0, 50);
        });
      }
    } catch (e) {
      useUI.getState().toast((e as Error).message, 'error');
    } finally {
      set({ task: null });
    }
  },

  trimStory() {
    get().update((s) => {
      s.history = trimHistory(s.history);
    });
  },

  flattenStory() {
    get().update((s) => {
      s.history = flattenHistory(s.doc);
    });
  },

  resetToPrompt() {
    const s = get().current;
    if (!s) return;
    const prompt = s.doc.filter((sp) => sp.origin === 'prompt');
    const firstNonPrompt = s.doc.findIndex((sp) => sp.origin !== 'prompt');
    const doc = canonical(firstNonPrompt < 0 ? s.doc : s.doc.slice(0, firstNonPrompt));
    void prompt;
    get().update((st) => {
      st.doc = doc;
      st.history = flattenHistory(doc);
      st.step = 0;
    });
    get().editor?.setDoc(doc);
  },
}));

/** Remember the model last used, so new stories (and stories whose model is gone) start with it. */
export function rememberModel(m: ModelRef | null) {
  const last = useSettings.getState().lastModel;
  if (m && (last?.provider !== m.provider || last?.id !== m.id)) useSettings.getState().set({ lastModel: { provider: m.provider, id: m.id } });
}

/**
 * What the local text-analysis models make of player input the words leave open (question or not, its language).
 * Kept short: a model that is slow to answer (still loading, say) is not waited for.
 */
const moodModel: MoodModel = async (texts) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 1500);
  try {
    return (await api.nlpRead(texts, ctl.signal)).readings;
  } catch {
    return texts.map(() => null);
  } finally {
    clearTimeout(timer);
  }
};

/** The story as the writing model should see it for one passage: the Director's beat joins the author's note. */
function directed(s: Story, o: PassageOptions): Story {
  if (!o.directive?.trim() && !o.maxLength) return s;
  const out = { ...s };
  if (o.directive?.trim()) out.authorsNote = [s.authorsNote.trim(), `Direction for this passage: ${o.directive.trim()}`].filter(Boolean).join('\n');
  if (o.maxLength) out.params = { ...s.params, maxLength: o.maxLength };
  return out;
}

/**
 * Stream a story continuation into the editor at `from` (end of story, or a
 * cursor position for inline generation) and record it as an AI history node.
 */
async function runGeneration(
  set: (p: Partial<StoryState>) => void,
  get: () => StoryState,
  opts: { from: number; inline?: boolean; quiet?: boolean; awaitSummary?: boolean } & PassageOptions,
): Promise<PassageResult> {
  // Scripts may cancel the generation or change the story before the context is built.
  if (hasHook('onGenerationRequested') || hasHook('onBeforeContextBuild')) {
    const atEnd = opts.from >= docText(get().current!.doc).length;
    set({ generating: true, task: 'story' });
    const req = await runScriptHook('onGenerationRequested', { inline: !!opts.inline, cancel: false });
    if (req.cancel) {
      set({ generating: false, task: null });
      return { text: '', from: opts.from, aborted: false, error: 'A user script cancelled the generation.' };
    }
    await runScriptHook('onBeforeContextBuild', {});
    if (atEnd) opts = { ...opts, from: docText(get().current!.doc).length };
  }
  const s = get().current!;
  const ui = useUI.getState();
  const settings = useSettings.getState();
  const model = get().resolveModel()!;
  rememberModel(model);
  const info = get().modelInfo();
  const fullText = docText(s.doc);
  const before = fullText.slice(0, opts.from);
  const after = fullText.slice(opts.from);
  const maxCtx = Math.min(s.params.maxContext, info?.contextWindow ?? Infinity, useSettings.getState().maxContextCap || Infinity);
  const caps = capsOf(info);
  if (settings.calibrateTokens) await seedCalibration(model, info, fullText);
  const ctx = directed(s, opts);
  const reqOpts = requestOptions(info, {
    maxContextTokens: maxCtx,
    model: model.id,
    inline: opts.inline ? { before, after, bidirectional: settings.bidirectionalInline } : undefined,
  });
  let req = buildStoryRequest(ctx, reqOpts);
  // Part of the story is out of view: look for earlier passages close in meaning to the latest text too.
  if (req.context.storyStart > 0 && s.recall?.enabled) {
    set({ generating: true, task: 'story' });
    const vectors = await searchVectors(s, stripComments(opts.inline ? before : fullText));
    if (vectors) req = buildStoryRequest(ctx, { ...reqOpts, vectors });
  }
  // "Default Bias": keep dinkuses and asterisms out unless the story already uses them.
  const banned = [...s.bannedTokens, ...(settings.defaultBias ? ['***', '⁂'].filter((x) => !fullText.includes(x)) : [])];
  if (banned.length > s.bannedTokens.length) req.system += `\n\nNever write scene-break markers such as ${banned.slice(s.bannedTokens.length).join(' or ')}.`;
  set({ generating: true, task: 'story', lastContext: req.context });
  abort = new AbortController();
  const builtMessages = JSON.stringify(req.messages);
  if (hasHook('onContextBuilt')) {
    const hooked = await runScriptHook('onContextBuilt', { system: req.system, context: req.messages[0]?.content ?? '', messages: req.messages });
    req.system = String(hooked.system ?? req.system);
    req.messages = Array.isArray(hooked.messages) && hooked.messages !== req.messages ? hooked.messages : req.messages;
    if (req.messages[0] && typeof hooked.context === 'string') req.messages[0] = { ...req.messages[0], content: hooked.context };
  }
  set({ lastRequest: { system: req.system, messages: req.messages } });
  const ed = get().editor;
  let raw = '';
  let shown = '';
  let error: string | null = null;
  const probs: TokenLogprob[] = [];
  const show = (text: string) => {
    ed?.replaceRange(opts.from, opts.from + shown.length, text ? [{ text, origin: 'ai' }] : []);
    shown = text;
    if (!opts.inline) ed?.scrollToEnd();
  };
  try {
    for await (const ev of generateStream(
      {
        model,
        system: req.system,
        messages: req.messages,
        params: ctx.params,
        maxTokens: req.maxTokens,
        stop: req.stop,
        bias: req.bias,
        banned,
        logprobs: settings.tokenProbabilities && caps.logprobs ? settings.logprobsCount : undefined,
        // Only sent untouched: a script that rewrote the messages would be undone by the fallback.
        fallbackMessages: JSON.stringify(req.messages) === builtMessages ? req.fallbackMessages : undefined,
        prompt: info?.completion === 'raw' && !opts.inline ? req.raw : undefined,
      },
      abort.signal,
    )) {
      if (ev.type === 'done' && ev.usage) learnCalibration(model, ev.usage, req.system, req.messages, info?.completion === 'raw' && !opts.inline ? req.raw : undefined);
      else if (ev.type === 'logprobs') probs.push(...ev.tokens);
      else if (ev.type === 'delta') {
        raw += ev.text;
        if (settings.streamResponses) {
          if (settings.streamDelay > 0) await new Promise((r) => setTimeout(r, settings.streamDelay * 10));
          show(postProcess(before, raw, { stop: req.stop, banned, singleBreaks: req.singleBreaks }));
        }
      } else if (ev.type === 'error') {
        error = ev.message;
      }
    }
  } catch (e) {
    error = (e as Error).message;
  }
  let final = postProcess(before, raw, {
    stop: req.stop,
    banned,
    trimToSentence: settings.continueToSentenceEnd && !abort.signal.aborted,
    minLength: s.params.minLength,
    singleBreaks: req.singleBreaks,
  });
  if (final && hasHook('onResponse')) final = String((await runScriptHook('onResponse', { text: final, inline: !!opts.inline })).text ?? final);
  if (settings.autoFormat) final = autoFormat(final);
  if (opts.inline && after && !/^\s/.test(after) && final && !/\s$/.test(final)) final += ' ';
  if (!final.trim()) final = '';
  show(final);
  const aborted = abort?.signal.aborted ?? false;
  abort = null;
  let node: string | undefined;
  let nodeBefore: string | undefined;

  const cur = get().current;
  if (cur && cur.id === s.id && final) {
    const change: Change = { pos: opts.from, removed: [], inserted: [{ text: final, origin: 'ai' }] };
    const doc = canonical(applyChange(cur.doc, change));
    const tokenProbs = alignTokenProbs(raw, final, probs);
    get().update((st) => {
      const r = commit(st.history, 'ai', [change]);
      nodeBefore = st.history.current;
      node = r.node.id;
      st.history = tokenProbs.length ? setNodeProbs(r.history, r.node.id, tokenProbs) : r.history;
      st.doc = doc;
      // Sticky / cooldown lore timing and `{{setvar}}` variables carry over to the next generation.
      const loreState = nextLoreState(st.loreState, req.context.activations, st.step);
      if (Object.keys(loreState).length || st.loreState) st.loreState = loreState;
      if (Object.keys(req.context.macroEnv.vars).length || st.vars) st.vars = req.context.macroEnv.vars;
      st.step = st.step + 1;
      // "Unbias When Generated": a group switches itself off once one of its phrases has appeared.
      if (st.phraseBias.some((g) => g.generateOnce && g.enabled)) {
        st.phraseBias = st.phraseBias.map((g) =>
          g.generateOnce && g.enabled && g.phrases.some((ph) => !/^\s*\[/.test(ph) && final.includes(stripBraces(ph))) ? { ...g, enabled: false } : g,
        );
      }
    });
    // Ensure editor matches canonical doc (e.g. stream disabled).
    if (!settings.streamResponses) ed?.setDoc(doc);
    if (settings.ttsSpeakOutputs) speak(final);
    if (hasHook('onGenerationEnd')) void runScriptHook('onGenerationEnd', { text: final });
    void maybeHypebot(set, get, final);
    if (opts.awaitSummary) {
      // The Director reads the summary next; give it the one that covers the text now out of view.
      set({ task: 'summary' });
      await updateSummary(get, req.context.storyStart);
    } else void updateSummary(get, req.context.storyStart);
    const latest = get().current;
    if (latest?.id === s.id) void syncVectors(latest);
  } else if (!final) {
    ed?.setDoc(get().current?.doc ?? []);
  }
  set({ generating: false, task: null });
  if (error && !opts.quiet) ui.toast(error, 'error');
  return { text: node ? final : '', from: opts.from, aborted, ...(error ? { error } : {}), ...(node ? { node, nodeBefore } : {}) };
}

/**
 * Place streamed token probabilities on the final (post-processed) text: overlap removal, trimming and
 * spacing fixes shift it relative to the raw output, so it is located by its first characters.
 */
export function alignTokenProbs(raw: string, final: string, tokens: TokenLogprob[]): TokenProb[] {
  if (!tokens.length || !final.trim()) return [];
  const rawTok = tokens.map((t) => t.token).join('');
  const body = final.trimStart();
  const lead = final.length - body.length;
  const at = rawTok.indexOf(body.slice(0, Math.min(40, body.length)));
  if (at < 0) return [];
  const out: TokenProb[] = [];
  let off = 0;
  for (const t of tokens) {
    const len = t.token.length;
    // Range of this token in the final text, clipped where trimming cut into it (e.g. a leading space).
    const o = off - at + lead;
    off += len;
    const from = Math.max(o, lead);
    const to = Math.min(o + len, final.length);
    if (to <= from) continue;
    const piece = t.token.slice(from - o, to - o);
    if (final.slice(from, to) !== piece) continue;
    out.push({ o: from, t: piece, lp: t.logprob, top: t.top.map((x) => [x.token, x.logprob]) });
  }
  return out;
}

/** Requests per summary update at most, so a long story catches up over a few generations. */
const SUMMARY_CHUNK = 8000;
let summarizing = false;

/**
 * Fold story text that has dropped out of the context into the running summary. Runs in the background after a
 * generation once enough new text is out of view, or on request (`force`) until it has caught up.
 */
export async function updateSummary(get: () => StoryState, storyStart: number, force = false): Promise<boolean> {
  const s = get().current;
  const model = get().resolveModel();
  if (!s?.summary?.enabled || !model || summarizing) return false;
  const text = docText(s.doc);
  const upTo = Math.min(s.summary.upTo, text.length);
  // Wait until a good stretch is out of view, unless asked.
  if (storyStart - upTo < (force ? 1 : 2000)) return false;
  summarizing = true;
  const id = s.id;
  try {
    let at = upTo;
    let summary = s.summary.text;
    do {
      let end = Math.min(storyStart, at + SUMMARY_CHUNK);
      // End the chunk at a paragraph break when there is one.
      const nl = text.lastIndexOf('\n', end);
      if (end < storyStart && nl > at + SUMMARY_CHUNK / 2) end = nl + 1;
      const req = buildSummaryRequest({ ...s, summary: { enabled: true, text: summary, upTo: at } }, text.slice(at, end));
      const out = (await generateText({ model, ...req, maxTokens: 1200, params: defaultParams({ temperature: 0.4 }) })).trim();
      if (!out || get().current?.id !== id) break;
      summary = out;
      at = end;
      get().update((st) => {
        st.summary = { enabled: st.summary?.enabled ?? true, text: summary, upTo: at };
      });
    } while (force && at < storyStart);
    return true;
  } catch (e) {
    if (force) useUI.getState().toast((e as Error).message, 'error');
    return false;
  } finally {
    summarizing = false;
  }
}

const calibrationKey = (m: { provider: string; id: string }) => `${m.provider}/${m.id}`;

/** A first token ratio for a model on a local server, from its own tokenizer, before any request has run. */
async function seedCalibration(model: ModelRef, info: ModelInfo | undefined, text: string): Promise<void> {
  const settings = useSettings.getState();
  if (settings.tokenCalibration[calibrationKey(model)] || capsOf(info).tokenizer !== 'remote') return;
  const sample = text.slice(-4000);
  const ours = countTokens(sample);
  if (ours < 200) return;
  try {
    const r = await Promise.race([api.tokenize(model, sample), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))]);
    if (r.tokenizer !== 'remote' || !r.ids.length) return;
    const ratio = Math.round((r.ids.length / ours) * 1000) / 1000;
    settings.set({ tokenCalibration: { ...useSettings.getState().tokenCalibration, [calibrationKey(model)]: { ratio, samples: 0, source: 'tokenizer', at: Date.now() } } });
  } catch {
    /* the server's tokenizer is optional */
  }
}

/** Learn the model's token ratio from the input tokens the provider reported for a request. */
function learnCalibration(model: ModelRef, usage: { input?: number; cacheRead?: number; cacheWrite?: number }, system: string, messages: ChatMessage[], prompt?: string) {
  const settings = useSettings.getState();
  // Cached prompt tokens are reported apart from the rest of the input.
  const actual = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  const key = calibrationKey(model);
  const next = updateCalibration(settings.tokenCalibration[key], actual, requestTokenEstimate(system, messages, prompt));
  if (next && next !== settings.tokenCalibration[key]) settings.set({ tokenCalibration: { ...settings.tokenCalibration, [key]: next } });
}

/** The learned token ratio for a model, when calibration is on. */
export function tokenRatio(info: { provider: string; id: string } | undefined): number | undefined {
  const settings = useSettings.getState();
  return settings.calibrateTokens && info ? settings.tokenCalibration[calibrationKey(info)]?.ratio : undefined;
}

/** Options shared by every story request: layout, prefill and bias handling for the model in use. */
function requestOptions(info: ModelInfo | undefined, o: StoryRequestOptions): StoryRequestOptions {
  const settings = useSettings.getState();
  const caps = capsOf(info);
  return {
    tokenRatio: tokenRatio(info),
    ...o,
    nativeBias: caps.tokenizer !== 'none',
    preamble: settings.preamble,
    layout: settings.promptLayout ?? 'structured',
    prefill: Boolean(caps.prefill),
  };
}

async function maybeHypebot(set: (p: Partial<StoryState>) => void, get: () => StoryState, last: string, force = false) {
  const st = useSettings.getState();
  if (st.hypebotMode === 'off') return;
  if (!force && st.hypebotMode === 'automatic' && Math.random() * 100 > st.hypebotChance) return;
  const s = get().current;
  const model = get().resolveModel();
  if (!s || !model) return;
  try {
    const req = buildHypebotRequest(s, last);
    const text = await generateText({ model, ...req, maxTokens: 80, params: defaultParams({ temperature: 1.1 }) });
    if (text.trim()) set({ hypebot: { text: text.trim(), time: Date.now() } });
  } catch {
    /* hypebot is best-effort */
  }
}

export { retryOptions };
