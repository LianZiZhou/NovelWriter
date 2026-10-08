// One sandbox per script: a hidden iframe with an opaque origin (sandbox="allow-scripts") and a CSP that blocks all
// network access, which starts a Worker running the script. The worker keeps its state between hooks; the
// iframe only relays messages and can kill and restart the worker when a script hangs.
//
//   app  <-- postMessage -->  iframe (relay, CSP connect-src 'none')  <-- postMessage -->  worker (script)

/** Runs inside the worker. Builds the `api` object scripts see and evaluates the script. */
const RUNTIME = String.raw`
const pending = new Map();
let seq = 0;
const call = (method, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    postMessage({ type: 'rpc', id, method, args: serialize(args) });
  });
const callbacks = new Map();
let cbSeq = 0;
// Functions inside arguments (UI part handlers, menu buttons…) become callback ids the app can invoke.
const serialize = (v) => {
  if (typeof v === 'function') {
    const id = 'cb' + ++cbSeq;
    callbacks.set(id, v);
    return { __cb: id };
  }
  if (Array.isArray(v)) return v.map(serialize);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = serialize(v[k]);
    return o;
  }
  return v;
};
const fmt = (a) => a.map((x) => (typeof x === 'string' ? x : x instanceof Error ? x.message : JSON.stringify(x))).join(' ');
const hooks = {};
const listeners = {};
const temp = new Map();
let config = {};
const storageApi = (scope) => ({
  get: (key, fallback) => call('storage.get', scope, key).then((v) => (v === undefined ? fallback : v)),
  set: (key, value) => call('storage.set', scope, key, value),
  remove: (key) => call('storage.remove', scope, key),
  list: () => call('storage.list', scope),
});
const rollDice = (expr) => {
  const m = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(String(expr));
  if (!m) throw new Error('Dice: use NdM+K, e.g. 2d6+1');
  const n = Number(m[1] || 1), sides = Number(m[2]), mod = Number((m[3] || '0').replace(/\s/g, ''));
  const rolls = Array.from({ length: Math.min(n, 1000) }, () => 1 + Math.floor(Math.random() * sides));
  return { total: rolls.reduce((a, b) => a + b, 0) + mod, rolls };
};
const v1 = {
  log: (...a) => postMessage({ type: 'log', level: 'info', text: fmt(a) }),
  error: (...a) => postMessage({ type: 'log', level: 'error', text: fmt(a) }),
  hooks: { register: (name, fn) => void (hooks[name === 'onInput' ? 'onTextAdventureInput' : name] ||= []).push(fn) },
  document: {
    text: () => call('document.text'),
    paragraphs: () => call('document.paragraphs'),
    insertParagraph: (index, text) => call('document.insertParagraph', index, text),
    updateParagraph: (index, text) => call('document.updateParagraph', index, text),
    removeParagraph: (index) => call('document.removeParagraph', index),
    append: (text) => call('document.append', text),
    replace: (from, to, text) => call('document.replace', from, to, text),
    undo: () => call('document.undo'),
    redo: () => call('document.redo'),
  },
  editor: {
    selection: () => call('editor.selection'),
    generate: () => call('editor.generate'),
    isGenerating: () => call('editor.isGenerating'),
    decorations: {
      setRules: (rules) => call('editor.decorations.setRules', rules),
      setMarkers: (markers) => call('editor.decorations.setMarkers', markers),
      clear: () => call('editor.decorations.clear'),
    },
  },
  generate: (opts) => call('generate', opts),
  generateWithStory: (opts) => call('generateWithStory', opts),
  story: { get: () => call('story.get'), set: (p) => call('story.set', p) },
  params: { get: () => call('params.get'), set: (p) => call('params.set', p) },
  lorebook: {
    entries: () => call('lorebook.entries'),
    entry: (id) => call('lorebook.entry', id),
    categories: () => call('lorebook.categories'),
    create: (p) => call('lorebook.create', p),
    update: (id, p) => call('lorebook.update', id, p),
    remove: (id) => call('lorebook.remove', id),
  },
  tokenizer: { count: (t) => call('tokenizer.count', t), encode: (t) => call('tokenizer.encode', t), decode: (ids) => call('tokenizer.decode', ids) },
  tts: { speak: (t) => call('tts.speak', t), stop: () => call('tts.stop') },
  storage: storageApi('script'),
  storyStorage: storageApi('story'),
  historyStorage: storageApi('history'),
  tempStorage: {
    get: async (k, f) => (temp.has(k) ? temp.get(k) : f),
    set: async (k, v) => void temp.set(k, v),
    remove: async (k) => void temp.delete(k),
    list: async () => [...temp.keys()],
  },
  timers: { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
  random: {
    float: () => Math.random(),
    int: (min, max) => min + Math.floor(Math.random() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    dice: rollDice,
  },
  messaging: {
    send: (channel, data) => call('messaging.send', channel, data),
    on: (channel, fn) => void (listeners[channel] ||= []).push(fn),
  },
  ui: {
    toast: (text, kind) => call('ui.toast', String(text), kind),
    register: (ext) => call('ui.register', ext),
    update: (id, patch) => call('ui.update', id, patch),
    remove: (id) => call('ui.remove', id),
    modal: {
      open: (m) => call('ui.modal.open', m),
      update: (id, m) => call('ui.modal.update', id, m),
      close: (id) => call('ui.modal.close', id),
    },
  },
  clipboard: { write: (text) => call('clipboard.write', String(text)) },
  file: { download: (name, content, type) => call('file.download', name, String(content), type) },
  hypebot: { comment: (text) => call('hypebot.comment', String(text)) },
  config: { get: (id) => config[id], all: () => ({ ...config }) },
};
// The first version of the API, kept so older scripts keep working.
const api = { v1, hooks: v1.hooks, log: v1.log };

onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'load') {
    config = m.config || {};
    try {
      // Scripts may use top-level await.
      const AsyncFunction = (async () => {}).constructor;
      await new AsyncFunction('api', '"use strict";\n' + m.code)(api);
      postMessage({ type: 'loaded', ok: true, hooks: Object.keys(hooks) });
    } catch (err) {
      postMessage({ type: 'loaded', ok: false, error: String((err && err.stack) || err) });
    }
  } else if (m.type === 'config') {
    config = m.config || {};
  } else if (m.type === 'hook') {
    let value = m.payload;
    const errors = [];
    for (const fn of hooks[m.name] || []) {
      try {
        const r = await fn(structuredClone(value));
        if (r && typeof r === 'object') value = { ...value, ...r };
      } catch (err) {
        errors.push(m.name + ': ' + ((err && err.message) || err));
      }
    }
    postMessage({ type: 'hookResult', id: m.id, value, errors });
  } else if (m.type === 'rpcResult') {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (p) m.ok ? p.resolve(m.value) : p.reject(new Error(m.error));
  } else if (m.type === 'callback') {
    const fn = callbacks.get(m.id);
    let value, error;
    try {
      value = fn ? await fn(...(m.args || [])) : undefined;
    } catch (err) {
      error = String((err && err.message) || err);
      postMessage({ type: 'log', level: 'error', text: error });
    }
    postMessage({ type: 'callbackResult', id: m.callId, value: serialize(value), error });
  } else if (m.type === 'message') {
    for (const fn of listeners[m.channel] || []) {
      try {
        await fn(m.data, m.from);
      } catch (err) {
        postMessage({ type: 'log', level: 'error', text: String((err && err.message) || err) });
      }
    }
  }
};
`;

/** The iframe document: strict CSP, starts the worker and relays messages both ways. */
function relayDocument(): string {
  const runtime = JSON.stringify(RUNTIME);
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; form-action 'none'">
<script>
let worker = null;
const url = URL.createObjectURL(new Blob([${runtime}], { type: 'text/javascript' }));
const start = () => {
  worker = new Worker(url);
  worker.onmessage = (e) => parent.postMessage(e.data, '*');
  worker.onerror = (e) => parent.postMessage({ type: 'log', level: 'error', text: e.message || 'Script error' }, '*');
};
start();
addEventListener('message', (e) => {
  if (e.source !== parent) return;
  if (e.data && e.data.type === 'kill') { worker.terminate(); start(); parent.postMessage({ type: 'killed' }, '*'); return; }
  worker.postMessage(e.data);
});
parent.postMessage({ type: 'ready' }, '*');
</script>`;
}

export type SandboxMessage =
  | { type: 'ready' }
  | { type: 'killed' }
  | { type: 'loaded'; ok: boolean; error?: string; hooks?: string[] }
  | { type: 'hookResult'; id: number; value: unknown; errors: string[] }
  | { type: 'rpc'; id: number; method: string; args: unknown[] }
  | { type: 'log'; level: 'info' | 'error'; text: string }
  | { type: 'callbackResult'; id: number; value: unknown; error?: string };

/** The app side of one script's sandbox. */
export class Sandbox {
  private frame: HTMLIFrameElement;
  private ready: Promise<void>;
  private onReady!: () => void;
  private listener: (e: MessageEvent) => void;

  constructor(private onMessage: (m: SandboxMessage) => void) {
    this.ready = new Promise((r) => (this.onReady = r));
    this.frame = document.createElement('iframe');
    this.frame.setAttribute('sandbox', 'allow-scripts');
    this.frame.setAttribute('aria-hidden', 'true');
    this.frame.className = 'script-sandbox';
    this.frame.style.display = 'none';
    this.listener = (e: MessageEvent) => {
      if (e.source !== this.frame.contentWindow) return;
      const m = e.data as SandboxMessage;
      if (m?.type === 'ready') this.onReady();
      else if (m && typeof m === 'object') this.onMessage(m);
    };
    window.addEventListener('message', this.listener);
    this.frame.srcdoc = relayDocument();
    document.body.appendChild(this.frame);
  }

  async post(m: unknown): Promise<void> {
    await this.ready;
    this.frame.contentWindow?.postMessage(m, '*');
  }

  /** Stop a runaway script; a fresh worker replaces it (its in-memory state is lost). */
  kill(): Promise<void> {
    return this.post({ type: 'kill' });
  }

  destroy(): void {
    window.removeEventListener('message', this.listener);
    this.frame.remove();
  }
}
