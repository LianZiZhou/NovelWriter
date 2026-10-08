// Runs user scripts: one sandbox per enabled script (story scripts + account scripts), hooks, the RPC API scripts
// call through `api.v1`, permissions, generation limits, UI extensions, decorations, logs and diagnostics.
import { create } from 'zustand';
import { transform } from 'sucrase';
import { buildStoryRequest, countTokens, decodeTokenIds, docText, newLoreEntry, tokenIds, uid, type LoreEntry, type Story, type UserScript } from '@novelwriter/core';
import { generateText } from '../../api.ts';
import { useStory, download } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { speak, stopSpeaking } from '../tts/tts.ts';
import { configValues, parseMeta, PERMISSIONS, type Permission, type ScriptMeta } from './meta.ts';
import { Sandbox, type SandboxMessage } from './sandbox.ts';

export type HookName =
  | 'onScriptsLoaded'
  | 'onGenerationRequested'
  | 'onBeforeContextBuild'
  | 'onContextBuilt'
  | 'onResponse'
  | 'onGenerationEnd'
  | 'onLorebookEntrySelected'
  | 'onTextAdventureInput'
  | 'onHistoryNavigated';

export type Scope = 'story' | 'account';

/** A function inside script data, callable from the app. */
export interface Callback {
  __cb: string;
}

export interface UIPart {
  type: 'row' | 'column' | 'box' | 'text' | 'button' | 'textInput' | 'numberInput' | 'checkbox' | 'slider' | 'collapsible' | 'select';
  id?: string;
  text?: string;
  markdown?: boolean;
  label?: string;
  title?: string;
  value?: unknown;
  placeholder?: string;
  multiline?: boolean;
  min?: number;
  max?: number;
  step?: number;
  open?: boolean;
  options?: { value: string; label: string }[];
  children?: UIPart[];
  onClick?: Callback;
  onChange?: Callback;
  style?: Record<string, string | number>;
}

export interface Extension {
  /** `${scriptKey}:${id}` */
  key: string;
  scriptKey: string;
  scriptName: string;
  type: 'contextMenuButton' | 'toolbarButton' | 'toolboxOption' | 'sidebarPanel' | 'lorebookPanel';
  id: string;
  label?: string;
  title?: string;
  description?: string;
  content?: UIPart[];
  onClick?: Callback;
  onRun?: Callback;
}

export interface ScriptModal {
  key: string;
  scriptKey: string;
  title: string;
  content: UIPart[];
  size?: 'small' | 'medium' | 'large';
}

export interface DecorationRule {
  pattern: string;
  flags?: string;
  style?: Record<string, string>;
  title?: string;
}

export interface Marker {
  from: number;
  to: number;
  style?: Record<string, string>;
  title?: string;
}

export interface LogLine {
  time: number;
  level: 'info' | 'error';
  text: string;
}

export interface Diagnostics {
  status: 'loading' | 'ready' | 'error' | 'restarting';
  error?: string;
  hooks: string[];
  loadMs: number;
  hookCalls: Record<string, number>;
  hookMs: number;
  rpcCalls: number;
  generations: number;
  restarts: number;
}

interface ScriptsState {
  extensions: Extension[];
  modals: ScriptModal[];
  decorations: Record<string, { rules: DecorationRule[]; markers: Marker[] }>;
  logs: Record<string, LogLine[]>;
  diagnostics: Record<string, Diagnostics>;
}

/** Reactive state for the UI (menus, panels, modals, decorations, logs). */
export const useScripts = create<ScriptsState>(() => ({ extensions: [], modals: [], decorations: {}, logs: {}, diagnostics: {} }));

interface Running {
  key: string;
  scope: Scope;
  script: UserScript;
  meta: ScriptMeta;
  sandbox: Sandbox;
  loaded: Promise<void>;
  hooks: Set<string>;
  lastActivity: number;
  rpcInFlight: number;
  hookWaiters: Map<number, (r: { value: unknown; errors: string[] }) => void>;
  callbackWaiters: Map<number, (r: { value: unknown; error?: string }) => void>;
  genTimes: number[];
  gensSinceInteraction: number;
  /** Permissions the user said no to; not asked again until the script restarts. */
  denied: Set<string>;
  /** A permission prompt already open for this script (prompts never stack). */
  asking: Promise<boolean> | null;
}

const running = new Map<string, Running>();
let hookSeq = 0;
let callSeq = 0;
const HOOK_TIMEOUT = 5000;
const GEN_PER_MINUTE = 20;
const GEN_WITHOUT_INTERACTION = 3;

/** `?noscript=true` turns every script off for this page load (to recover from a broken one). */
export const scriptsDisabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('noscript') === 'true';

const keyOf = (scope: Scope, s: UserScript) => `${scope}:${s.id}`;

function compile(s: UserScript): string {
  if (s.language !== 'ts') return s.code;
  return transform(s.code, { transforms: ['typescript'], disableESTransforms: true }).code;
}

function log(key: string, level: LogLine['level'], text: string) {
  const logs = useScripts.getState().logs;
  useScripts.setState({ logs: { ...logs, [key]: [...(logs[key] ?? []), { time: Date.now(), level, text }].slice(-300) } });
  if (level === 'error') {
    const name = running.get(key)?.script.name ?? 'Script';
    useUI.getState().toast(`${name}: ${text.split('\n')[0]}`, 'error');
  }
}

function diag(key: string, patch: Partial<Diagnostics> | ((d: Diagnostics) => Partial<Diagnostics>)) {
  const all = useScripts.getState().diagnostics;
  const cur: Diagnostics = all[key] ?? { status: 'loading', hooks: [], loadMs: 0, hookCalls: {}, hookMs: 0, rpcCalls: 0, generations: 0, restarts: 0 };
  useScripts.setState({ diagnostics: { ...all, [key]: { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) } } });
}

export function clearLogs(key: string) {
  const logs = { ...useScripts.getState().logs };
  delete logs[key];
  useScripts.setState({ logs });
}

// ------------------------------------------------------------------ lifecycle

function start(scope: Scope, script: UserScript): Running {
  const key = keyOf(scope, script);
  const { meta, error } = parseMeta(script.code);
  let resolveLoaded!: () => void;
  const r: Running = {
    key,
    scope,
    script,
    meta,
    sandbox: null as unknown as Sandbox,
    loaded: new Promise((res) => (resolveLoaded = res)),
    hooks: new Set(),
    lastActivity: Date.now(),
    rpcInFlight: 0,
    hookWaiters: new Map(),
    callbackWaiters: new Map(),
    genTimes: [],
    gensSinceInteraction: 0,
    denied: new Set(),
    asking: null,
  };
  const t0 = performance.now();
  r.sandbox = new Sandbox((m) => onMessage(r, m, () => resolveLoaded(), t0));
  running.set(key, r);
  diag(key, { status: 'loading', error: undefined });
  if (error) log(key, 'error', error);
  let code: string;
  try {
    code = compile(script);
  } catch (e) {
    log(key, 'error', `TypeScript: ${(e as Error).message}`);
    diag(key, { status: 'error', error: (e as Error).message });
    resolveLoaded();
    return r;
  }
  void r.sandbox.post({ type: 'load', code, config: configValues(meta, script.config) });
  return r;
}

function stop(key: string) {
  const r = running.get(key);
  if (!r) return;
  r.sandbox.destroy();
  for (const w of r.hookWaiters.values()) w({ value: undefined, errors: [] });
  running.delete(key);
  const st = useScripts.getState();
  const decorations = { ...st.decorations };
  delete decorations[key];
  useScripts.setState({
    extensions: st.extensions.filter((e) => e.scriptKey !== key),
    modals: st.modals.filter((m) => m.scriptKey !== key),
    decorations,
  });
}

/** Start, restart or stop sandboxes so they match the enabled scripts of the current story and the account. */
export function syncScripts() {
  const story = useStory.getState().current;
  const settings = useSettings.getState();
  const wanted = new Map<string, { scope: Scope; script: UserScript }>();
  if (!scriptsDisabled && settings.userScriptsAccepted) {
    for (const s of settings.accountScripts) if (s.enabled && s.code.trim()) wanted.set(keyOf('account', s), { scope: 'account', script: s });
    for (const s of story?.scripts ?? []) if (s.enabled && s.code.trim()) wanted.set(keyOf('story', s), { scope: 'story', script: s });
  }
  for (const [key, r] of running) {
    const w = wanted.get(key);
    // Restart when the code or language changed; config changes are pushed to the running script.
    if (!w || w.script.code !== r.script.code || w.script.language !== r.script.language) stop(key);
    else if (JSON.stringify(w.script.config) !== JSON.stringify(r.script.config)) {
      r.script = w.script;
      void r.sandbox.post({ type: 'config', config: configValues(r.meta, w.script.config) });
    } else r.script = w.script;
  }
  for (const [key, w] of wanted) {
    if (running.has(key)) continue;
    const r = start(w.scope, w.script);
    void r.loaded.then(() => {
      if (r.hooks.has('onScriptsLoaded')) void runOne(r, 'onScriptsLoaded', {});
    });
  }
}

let initialized = false;
/** Keep sandboxes in sync with the story and settings; count user interaction for generation limits. */
export function initScripts() {
  if (initialized) return;
  initialized = true;
  let lastStory: Story | null = null;
  useStory.subscribe((s) => {
    if (s.current?.id !== lastStory?.id || s.current?.scripts !== lastStory?.scripts) {
      lastStory = s.current;
      syncScripts();
    }
  });
  useSettings.subscribe((s, prev) => {
    if (s.accountScripts !== prev.accountScripts || s.userScriptsAccepted !== prev.userScriptsAccepted) syncScripts();
  });
  const interacted = () => {
    for (const r of running.values()) r.gensSinceInteraction = 0;
  };
  window.addEventListener('keydown', interacted, true);
  window.addEventListener('pointerdown', interacted, true);
  syncScripts();
}

export function restartScript(key: string) {
  const r = running.get(key);
  if (!r) return;
  stop(key);
  diag(key, (d) => ({ restarts: d.restarts + 1 }));
  syncScripts();
}

export function isRunning(key: string): boolean {
  return running.has(key);
}

// ------------------------------------------------------------------ messages

function onMessage(r: Running, m: SandboxMessage, loaded: () => void, t0: number) {
  r.lastActivity = Date.now();
  switch (m.type) {
    case 'loaded':
      r.hooks = new Set(m.hooks ?? []);
      diag(r.key, { status: m.ok ? 'ready' : 'error', error: m.error, hooks: m.hooks ?? [], loadMs: Math.round(performance.now() - t0) });
      if (!m.ok) log(r.key, 'error', m.error ?? 'Failed to load');
      loaded();
      break;
    case 'log':
      log(r.key, m.level, m.text);
      break;
    case 'hookResult': {
      const w = r.hookWaiters.get(m.id);
      r.hookWaiters.delete(m.id);
      w?.({ value: m.value, errors: m.errors });
      break;
    }
    case 'callbackResult': {
      const w = r.callbackWaiters.get(m.id);
      r.callbackWaiters.delete(m.id);
      w?.({ value: m.value, error: m.error });
      break;
    }
    case 'rpc':
      r.rpcInFlight++;
      diag(r.key, (d) => ({ rpcCalls: d.rpcCalls + 1 }));
      handleRpc(r, m.method, m.args)
        .then(
          (value) => r.sandbox.post({ type: 'rpcResult', id: m.id, ok: true, value }),
          (e: Error) => r.sandbox.post({ type: 'rpcResult', id: m.id, ok: false, error: e.message }),
        )
        .finally(() => {
          r.rpcInFlight--;
          r.lastActivity = Date.now();
        });
      break;
    case 'killed':
      break;
  }
}

/** Wait for a reply from the sandbox; a script that stays silent for 5 s (outside API calls) is restarted. */
function watch<T>(r: Running, register: (resolve: (v: T) => void) => void, fallback: T, what: string): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const finish = (v: T) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      resolve(v);
    };
    register(finish);
    r.lastActivity = Date.now();
    const timer = setInterval(() => {
      if (!running.has(r.key)) return finish(fallback);
      if (r.rpcInFlight === 0 && Date.now() - r.lastActivity > HOOK_TIMEOUT) {
        log(r.key, 'error', `${what} took longer than ${HOOK_TIMEOUT / 1000}s; the script was restarted.`);
        finish(fallback);
        restartScript(r.key);
      }
    }, 250);
  });
}

async function runOne(r: Running, name: HookName, payload: object): Promise<{ value: object; errors: string[] }> {
  await r.loaded;
  if (!r.hooks.has(name)) return { value: payload, errors: [] };
  const id = ++hookSeq;
  const t0 = performance.now();
  void r.sandbox.post({ type: 'hook', id, name, payload });
  const res = await watch<{ value: unknown; errors: string[] }>(r, (resolve) => r.hookWaiters.set(id, resolve), { value: payload, errors: [] }, name);
  diag(r.key, (d) => ({ hookCalls: { ...d.hookCalls, [name]: (d.hookCalls[name] ?? 0) + 1 }, hookMs: Math.round(d.hookMs + performance.now() - t0) }));
  for (const e of res.errors) log(r.key, 'error', e);
  return { value: (res.value as object) ?? payload, errors: res.errors };
}

/** Run a hook through every running script in turn; each may change the payload. */
export async function runScriptHook<T extends object>(name: HookName, payload: T): Promise<T> {
  let value: T = payload;
  for (const r of [...running.values()]) {
    if (!r.hooks.has(name) && r.hooks.size) continue;
    const res = await runOne(r, name, value);
    value = { ...value, ...(res.value as Partial<T>) };
  }
  return value;
}

export function hasHook(name: HookName): boolean {
  return [...running.values()].some((r) => r.hooks.has(name));
}

/** Call a function the script handed us (menu button, UI part handler…). */
export async function invoke(scriptKey: string, cb: Callback | undefined, ...args: unknown[]): Promise<unknown> {
  const r = running.get(scriptKey);
  if (!r || !cb) return undefined;
  r.gensSinceInteraction = 0; // a click on the script's own UI counts as interaction
  const id = ++callSeq;
  void r.sandbox.post({ type: 'callback', id: cb.__cb, callId: id, args });
  const res = await watch<{ value: unknown; error?: string }>(r, (resolve) => r.callbackWaiters.set(id, resolve), { value: undefined }, 'A script callback');
  return res.value;
}

export function broadcast(from: string, channel: string, data: unknown) {
  const name = running.get(from)?.script.name ?? '';
  for (const r of running.values()) if (r.key !== from) void r.sandbox.post({ type: 'message', channel, data, from: name });
}

// ------------------------------------------------------------------ API

async function need(r: Running, p: Permission) {
  if (!r.meta.permissions.includes(p)) throw new Error(`Permission "${p}" is not declared in the script's @meta block.`);
  if (r.script.granted?.includes(p)) return;
  if (r.denied.has(p)) throw new Error(`Permission "${p}" was denied.`);
  // One prompt at a time per script; concurrent calls wait for the same answer.
  while (r.asking) await r.asking;
  if (r.script.granted?.includes(p)) return;
  r.asking = useUI.getState().confirm({
    title: t('Allow "{name}"?', { name: r.script.name }),
    message: `${t('This script wants to:')} ${t(PERMISSIONS[p])}.`,
    confirmLabel: t('Allow'),
  });
  const ok = await r.asking;
  r.asking = null;
  if (!ok) {
    r.denied.add(p);
    throw new Error(`Permission "${p}" was denied.`);
  }
  updateScript(r.scope, r.script.id, (s) => ({ ...s, granted: [...new Set([...(s.granted ?? []), p])] }));
  r.script = { ...r.script, granted: [...(r.script.granted ?? []), p] };
}

export function updateScript(scope: Scope, id: string, fn: (s: UserScript) => UserScript) {
  if (scope === 'account') {
    const st = useSettings.getState();
    st.set({ accountScripts: st.accountScripts.map((s) => (s.id === id ? fn(s) : s)) });
  } else useStory.getState().update((st) => void (st.scripts = st.scripts.map((s) => (s.id === id ? fn(s) : s))));
}

function story(): Story {
  const s = useStory.getState().current;
  if (!s) throw new Error('No story is open.');
  return s;
}

function paragraphOffsets(text: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let pos = 0;
  for (const p of text.split('\n')) {
    out.push({ from: pos, to: pos + p.length });
    pos += p.length + 1;
  }
  return out;
}

function checkGenerationLimit(r: Running) {
  const now = Date.now();
  r.genTimes = r.genTimes.filter((x) => now - x < 60000);
  if (r.genTimes.length >= GEN_PER_MINUTE) throw new Error(`Generation limit: ${GEN_PER_MINUTE} requests per minute.`);
  if (r.gensSinceInteraction >= GEN_WITHOUT_INTERACTION) throw new Error(`Generation limit: ${GEN_WITHOUT_INTERACTION} requests without user interaction. Click or type to continue.`);
  r.genTimes.push(now);
  r.gensSinceInteraction++;
  diag(r.key, (d) => ({ generations: d.generations + 1 }));
}

function storageGet(r: Running, scope: 'script' | 'story' | 'history'): Record<string, unknown> {
  if (scope === 'script') return useSettings.getState().scriptStorage[r.script.id] ?? {};
  const s = story();
  const all = s.scriptStorage?.[r.script.id] ?? {};
  if (scope === 'story') return Object.fromEntries(Object.entries(all).filter(([k]) => k !== '__history'));
  return ((all.__history as Record<string, Record<string, unknown>> | undefined) ?? {})[s.history.current] ?? {};
}

function storageSet(r: Running, scope: 'script' | 'story' | 'history', next: Record<string, unknown>) {
  if (scope === 'script') {
    const st = useSettings.getState();
    st.set({ scriptStorage: { ...st.scriptStorage, [r.script.id]: next } });
    return;
  }
  useStory.getState().update((s) => {
    const all = { ...(s.scriptStorage?.[r.script.id] ?? {}) };
    if (scope === 'story') {
      const history = all.__history;
      s.scriptStorage = { ...(s.scriptStorage ?? {}), [r.script.id]: { ...next, ...(history ? { __history: history } : {}) } };
    } else {
      const history = { ...((all.__history as Record<string, Record<string, unknown>> | undefined) ?? {}), [s.history.current]: next };
      s.scriptStorage = { ...(s.scriptStorage ?? {}), [r.script.id]: { ...all, __history: history } };
    }
  });
}

const STORY_FIELDS = ['title', 'description', 'memory', 'authorsNote', 'systemPrompt', 'prefill', 'tags'] as const;

async function handleRpc(r: Running, method: string, args: unknown[]): Promise<unknown> {
  const store = useStory.getState();
  const a = args as never[];
  switch (method) {
    // document
    case 'document.text':
      return docText(story().doc);
    case 'document.paragraphs':
      return docText(story().doc).split('\n');
    case 'document.insertParagraph': {
      await need(r, 'documentEdit');
      const text = docText(story().doc);
      const offs = paragraphOffsets(text);
      const i = Math.max(0, Math.min(offs.length, Number(a[0])));
      if (i >= offs.length) store.replaceText(text.length, text.length, `${text ? '\n' : ''}${String(a[1])}`);
      else store.replaceText(offs[i].from, offs[i].from, `${String(a[1])}\n`);
      return true;
    }
    case 'document.updateParagraph': {
      await need(r, 'documentEdit');
      const offs = paragraphOffsets(docText(story().doc));
      const p = offs[Number(a[0])];
      if (!p) throw new Error('No such paragraph.');
      store.replaceText(p.from, p.to, String(a[1]));
      return true;
    }
    case 'document.removeParagraph': {
      await need(r, 'documentEdit');
      const text = docText(story().doc);
      const offs = paragraphOffsets(text);
      const p = offs[Number(a[0])];
      if (!p) throw new Error('No such paragraph.');
      if (p.to < text.length) store.replaceText(p.from, p.to + 1, '');
      else store.replaceText(Math.max(0, p.from - 1), p.to, '');
      return true;
    }
    case 'document.append': {
      await need(r, 'documentEdit');
      const len = docText(story().doc).length;
      store.replaceText(len, len, String(a[0]));
      return true;
    }
    case 'document.replace':
      await need(r, 'documentEdit');
      store.replaceText(Number(a[0]), Number(a[1]), String(a[2]));
      return true;
    case 'document.undo':
      await need(r, 'documentEdit');
      store.undo();
      return true;
    case 'document.redo':
      await need(r, 'documentEdit');
      store.redo();
      return true;
    // editor
    case 'editor.selection':
      return store.editor?.getSelection() ?? { from: 0, to: 0, text: '' };
    case 'editor.generate':
      checkGenerationLimit(r);
      await store.send();
      return docText(story().doc);
    case 'editor.isGenerating':
      return store.generating;
    case 'editor.decorations.setRules':
      await need(r, 'editorDecorations');
      setDecorations(r.key, { rules: (Array.isArray(a[0]) ? a[0] : []) as DecorationRule[] });
      return true;
    case 'editor.decorations.setMarkers':
      await need(r, 'editorDecorations');
      setDecorations(r.key, { markers: (Array.isArray(a[0]) ? a[0] : []) as Marker[] });
      return true;
    case 'editor.decorations.clear':
      setDecorations(r.key, { rules: [], markers: [] });
      return true;
    // generation
    case 'generate': {
      checkGenerationLimit(r);
      const o = (a[0] ?? {}) as { prompt?: string; messages?: { role: 'user' | 'assistant'; content: string }[]; system?: string; maxTokens?: number; temperature?: number };
      const model = store.resolveModel();
      if (!model) throw new Error('No AI model is configured.');
      const messages = o.messages ?? [{ role: 'user' as const, content: String(o.prompt ?? '') }];
      const text = await generateText({ model, system: o.system, messages, maxTokens: Math.min(4000, o.maxTokens ?? 300), params: o.temperature !== undefined ? { temperature: o.temperature } : undefined });
      return { text };
    }
    case 'generateWithStory': {
      checkGenerationLimit(r);
      const o = (a[0] ?? {}) as { instruction?: string; maxTokens?: number };
      const model = store.resolveModel();
      if (!model) throw new Error('No AI model is configured.');
      const s = story();
      const info = store.modelInfo();
      const req = buildStoryRequest(s, { maxContextTokens: Math.min(s.params.maxContext, info?.contextWindow ?? Infinity) });
      const system = o.instruction ? `${req.system}\n\n${o.instruction}` : req.system;
      const text = await generateText({ model, system, messages: req.messages, maxTokens: Math.min(4000, o.maxTokens ?? 300), params: s.params });
      return { text };
    }
    // story
    case 'story.get': {
      const s = story();
      return { title: s.title, description: s.description, tags: s.tags, mode: s.mode, step: s.step, memory: s.memory, authorsNote: s.authorsNote, systemPrompt: s.systemPrompt, prefill: s.prefill };
    }
    case 'story.set': {
      await need(r, 'storyEdit');
      const p = (a[0] ?? {}) as Record<string, unknown>;
      store.update((s) => {
        for (const k of STORY_FIELDS) if (k in p) (s as unknown as Record<string, unknown>)[k] = k === 'tags' ? (p[k] as unknown[]).map(String) : String(p[k]);
      });
      return true;
    }
    case 'params.get':
      return story().params;
    case 'params.set':
      await need(r, 'presetEdit');
      store.update((s) => void (s.params = { ...s.params, ...(a[0] as object) }));
      return true;
    // lorebook
    case 'lorebook.entries':
      return story().lorebook.entries;
    case 'lorebook.entry':
      return story().lorebook.entries.find((e) => e.id === a[0]) ?? null;
    case 'lorebook.categories':
      return story().lorebook.categories;
    case 'lorebook.create': {
      await need(r, 'lorebookEdit');
      const e = newLoreEntry({ ...(a[0] as Partial<LoreEntry>), id: uid() }, story().contextSettings.loreDefaults);
      store.update((s) => void (s.lorebook = { ...s.lorebook, entries: [...s.lorebook.entries, e] }));
      return e.id;
    }
    case 'lorebook.update':
      await need(r, 'lorebookEdit');
      store.update((s) => void (s.lorebook = { ...s.lorebook, entries: s.lorebook.entries.map((e) => (e.id === a[0] ? { ...e, ...(a[1] as object), id: e.id, lastUpdatedAt: Date.now() } : e)) }));
      return true;
    case 'lorebook.remove':
      await need(r, 'lorebookEdit');
      store.update((s) => void (s.lorebook = { ...s.lorebook, entries: s.lorebook.entries.filter((e) => e.id !== a[0]) }));
      return true;
    // tokenizer
    case 'tokenizer.count':
      return countTokens(String(a[0] ?? ''));
    case 'tokenizer.encode':
      return tokenIds(String(a[0] ?? ''));
    case 'tokenizer.decode':
      return decodeTokenIds((a[0] as number[]) ?? []);
    // tts
    case 'tts.speak':
      speak(String(a[0] ?? ''));
      return true;
    case 'tts.stop':
      stopSpeaking();
      return true;
    // storage
    case 'storage.get':
      return storageGet(r, a[0])[String(a[1])];
    case 'storage.set': {
      const scope = a[0] as 'script' | 'story' | 'history';
      const next = { ...storageGet(r, scope), [String(a[1])]: a[2] };
      if (JSON.stringify(next).length > 1_000_000) throw new Error('Storage limit (1 MB) exceeded.');
      storageSet(r, scope, next);
      return true;
    }
    case 'storage.remove': {
      const scope = a[0] as 'script' | 'story' | 'history';
      const next = { ...storageGet(r, scope) };
      delete next[String(a[1])];
      storageSet(r, scope, next);
      return true;
    }
    case 'storage.list':
      return Object.keys(storageGet(r, a[0]));
    // messaging
    case 'messaging.send':
      broadcast(r.key, String(a[0]), a[1]);
      return true;
    // ui
    case 'ui.toast':
      useUI.getState().toast(String(a[0]), a[1] === 'error' || a[1] === 'success' ? a[1] : 'info');
      return true;
    case 'ui.register': {
      const ext = a[0] as Omit<Extension, 'key' | 'scriptKey' | 'scriptName'>;
      if (!ext?.id || !['contextMenuButton', 'toolbarButton', 'toolboxOption', 'sidebarPanel', 'lorebookPanel'].includes(ext.type)) throw new Error('ui.register needs an id and a known type.');
      const key = `${r.key}:${ext.id}`;
      const list = useScripts.getState().extensions.filter((e) => e.key !== key);
      useScripts.setState({ extensions: [...list, { ...ext, key, scriptKey: r.key, scriptName: r.script.name }] });
      return key;
    }
    case 'ui.update': {
      const key = `${r.key}:${String(a[0])}`;
      useScripts.setState({ extensions: useScripts.getState().extensions.map((e) => (e.key === key ? { ...e, ...(a[1] as object), key, scriptKey: e.scriptKey } : e)) });
      return true;
    }
    case 'ui.remove': {
      const key = `${r.key}:${String(a[0])}`;
      useScripts.setState({ extensions: useScripts.getState().extensions.filter((e) => e.key !== key) });
      return true;
    }
    case 'ui.modal.open': {
      const m = (a[0] ?? {}) as Partial<ScriptModal>;
      const key = `${r.key}:modal:${++callSeq}`;
      useScripts.setState({ modals: [...useScripts.getState().modals, { key, scriptKey: r.key, title: String(m.title ?? r.script.name), content: m.content ?? [], size: m.size }] });
      return key;
    }
    case 'ui.modal.update':
      useScripts.setState({ modals: useScripts.getState().modals.map((m) => (m.key === a[0] ? { ...m, ...(a[1] as object), key: m.key } : m)) });
      return true;
    case 'ui.modal.close':
      useScripts.setState({ modals: useScripts.getState().modals.filter((m) => m.key !== a[0]) });
      return true;
    // other
    case 'clipboard.write':
      await need(r, 'clipboardWrite');
      await navigator.clipboard.writeText(String(a[0]));
      return true;
    case 'file.download':
      await need(r, 'fileDownload');
      download(String(a[0] || 'download.txt').replace(/[\\/:*?"<>|]/g, '_'), String(a[1]), String(a[2] || 'text/plain'));
      return true;
    case 'hypebot.comment':
      useStory.setState({ hypebot: { text: String(a[0]), time: Date.now() } });
      return true;
  }
  throw new Error(`Unknown API method ${method}`);
}

function setDecorations(key: string, patch: Partial<{ rules: DecorationRule[]; markers: Marker[] }>) {
  const all = useScripts.getState().decorations;
  const cur = all[key] ?? { rules: [], markers: [] };
  useScripts.setState({ decorations: { ...all, [key]: { ...cur, ...patch } } });
}

export { safeStyle } from './meta.ts';
