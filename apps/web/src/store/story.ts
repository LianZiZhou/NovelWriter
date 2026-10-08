import { useRef } from 'react';
import { create } from 'zustand';
import {
  BUILTIN_PRESETS,
  adventureInput,
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
  type HistoryNodeType,
  type ModelRef,
  type Preset,
  type Shelf,
  type Span,
  type Story,
  type StoryMeta,
} from '@novelwriter/core';
import { api, generateStream, generateText, type ModelInfo } from '../api.ts';
import { useSettings } from './settings.ts';
import { useUI } from './ui.ts';
import { t } from '../i18n.ts';
import { speak } from '../features/tts/tts.ts';
import { runHook } from '../features/scripts/runner.ts';

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
  hypebot: HypebotComment | null;
  editor: EditorController | null;
  serverDown: boolean;
  activeShelf: string | null;
  scriptLogs: string[];

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
  importFiles: (files: FileList | File[]) => Promise<void>;
  saveShelves: (s: Shelf[]) => void;
  savePresets: (p: Preset[]) => void;
  allPresets: () => Preset[];
  setEditor: (e: EditorController | null) => void;

  /** Apply a user edit made in the editor (computed incrementally by the editor). */
  editorChanged: (change: Change) => void;
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
  stop: () => void;
  generateTitle: () => Promise<void>;
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

function scheduleSave(get: () => StoryState, set: (p: Partial<StoryState>) => void) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => whenIdle(async () => {
    const s = get().current;
    if (!s) return;
    try {
      const meta = await api.saveStory(s);
      set({ library: upsertMeta(get().library, meta), serverDown: false });
    } catch {
      set({ serverDown: true });
    }
  }), 600);
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
  hypebot: null,
  editor: null,
  serverDown: false,
  activeShelf: null,
  scriptLogs: [],

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
      presetId: preset.id,
      params: cloneJson(preset.params),
      model: settings.defaultModel,
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
  },

  resolveModel() {
    const s = get().current;
    const settings = useSettings.getState();
    const models = get().models;
    const pick = s?.model ?? settings.defaultModel;
    if (pick && models.some((m) => m.provider === pick.provider && m.id === pick.id)) return pick;
    if (pick && models.length === 0) return pick;
    const first = preferredModel(models);
    return first ? { provider: first.provider, id: first.id } : null;
  },

  modelInfo() {
    const ref = get().resolveModel();
    return ref ? get().models.find((m) => m.provider === ref.provider && m.id === ref.id) : undefined;
  },

  previewContext() {
    const s = get().current;
    if (!s) return null;
    const info = get().modelInfo();
    const maxCtx = Math.min(s.params.maxContext, info?.contextWindow ?? Infinity);
    return buildStoryRequest(s, { maxContextTokens: maxCtx, model: info?.id }).context;
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
      const hooked = await runHook(s.scripts, 'onInput', { text: input.text });
      logScripts(set, get, hooked);
      let text = s.mode === 'adventure' ? adventureInput(hooked.value.text, input.mode ?? 'do') : hooked.value.text;
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

  stop() {
    abort?.abort();
  },

  async generateTitle() {
    const s = get().current;
    const model = get().resolveModel();
    if (!s || !model) return;
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

/**
 * Stream a story continuation into the editor at `from` (end of story, or a
 * cursor position for inline generation) and record it as an AI history node.
 */
async function runGeneration(
  set: (p: Partial<StoryState>) => void,
  get: () => StoryState,
  opts: { from: number; inline?: boolean },
): Promise<void> {
  const s = get().current!;
  const ui = useUI.getState();
  const settings = useSettings.getState();
  const model = get().resolveModel()!;
  const info = get().modelInfo();
  const fullText = docText(s.doc);
  const before = fullText.slice(0, opts.from);
  const after = fullText.slice(opts.from);
  const maxCtx = Math.min(s.params.maxContext, info?.contextWindow ?? Infinity);
  const caps = backendCaps(info?.flavor ?? 'chat-only');
  const req = buildStoryRequest(s, {
    maxContextTokens: maxCtx,
    model: model.id,
    inline: opts.inline ? { before, after } : undefined,
    nativeBias: caps.tokenizer !== 'none',
    preamble: settings.preamble,
  });
  // "Default Bias": keep dinkuses and asterisms out unless the story already uses them.
  const banned = [...s.bannedTokens, ...(settings.defaultBias ? ['***', '⁂'].filter((x) => !fullText.includes(x)) : [])];
  if (banned.length > s.bannedTokens.length) req.system += `\n\nNever write scene-break markers such as ${banned.slice(s.bannedTokens.length).join(' or ')}.`;
  set({ generating: true, task: 'story', lastContext: req.context });
  abort = new AbortController();
  if (s.scripts.some((x) => x.enabled)) {
    const hooked = await runHook(s.scripts, 'onContextBuilt', { system: req.system, context: req.messages[0]?.content ?? '' });
    logScripts(set, get, hooked);
    req.system = hooked.value.system;
    if (req.messages[0]) req.messages[0] = { ...req.messages[0], content: hooked.value.context };
  }
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
        params: s.params,
        maxTokens: req.maxTokens,
        stop: req.stop,
        bias: req.bias,
        banned,
        logprobs: settings.tokenProbabilities && caps.logprobs ? settings.logprobsCount : undefined,
      },
      abort.signal,
    )) {
      if (ev.type === 'logprobs') probs.push(...ev.tokens);
      else if (ev.type === 'delta') {
        raw += ev.text;
        if (settings.streamResponses) {
          if (settings.streamDelay > 0) await new Promise((r) => setTimeout(r, settings.streamDelay * 10));
          show(postProcess(before, raw, { stop: req.stop, banned }));
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
  });
  if (final && s.scripts.some((x) => x.enabled)) {
    const hooked = await runHook(s.scripts, 'onResponse', { text: final });
    logScripts(set, get, hooked);
    final = hooked.value.text;
  }
  if (settings.autoFormat) final = autoFormat(final);
  if (opts.inline && after && !/^\s/.test(after) && final && !/\s$/.test(final)) final += ' ';
  if (!final.trim()) final = '';
  show(final);
  abort = null;

  const cur = get().current;
  if (cur && cur.id === s.id && final) {
    const change: Change = { pos: opts.from, removed: [], inserted: [{ text: final, origin: 'ai' }] };
    const doc = canonical(applyChange(cur.doc, change));
    const tokenProbs = alignTokenProbs(raw, final, probs);
    get().update((st) => {
      const r = commit(st.history, 'ai', [change]);
      st.history = tokenProbs.length ? setNodeProbs(r.history, r.node.id, tokenProbs) : r.history;
      st.doc = doc;
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
    void maybeHypebot(set, get, final);
  } else if (!final) {
    ed?.setDoc(get().current?.doc ?? []);
  }
  set({ generating: false, task: null });
  if (error) ui.toast(error, 'error');
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

function logScripts(set: (p: Partial<StoryState>) => void, get: () => StoryState, r: { logs: string[]; errors: string[] }) {
  if (!r.logs.length && !r.errors.length) return;
  const stamp = new Date().toLocaleTimeString();
  const lines = [...r.logs.map((l) => `[${stamp}] ${l}`), ...r.errors.map((e) => `[${stamp}] ERROR ${e}`)];
  set({ scriptLogs: [...get().scriptLogs, ...lines].slice(-200) });
  if (r.errors.length) useUI.getState().toast(r.errors[0], 'error');
}

async function maybeHypebot(set: (p: Partial<StoryState>) => void, get: () => StoryState, last: string) {
  const st = useSettings.getState();
  if (st.hypebotMode === 'off') return;
  if (st.hypebotMode === 'automatic' && Math.random() * 100 > st.hypebotChance) return;
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
