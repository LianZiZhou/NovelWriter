import type { UserScript } from '@novelwriter/core';

export type HookName = 'onContextBuilt' | 'onResponse' | 'onInput';

export interface HookResult<T> {
  value: T;
  logs: string[];
  errors: string[];
}

/**
 * Worker source. Scripts register hooks with `api.hooks.register(name, fn)`;
 * each hook receives a payload object and may return a (partial) replacement.
 * Runs in a dedicated worker with no DOM access, terminated after a timeout.
 */
const WORKER_SRC = `
self.onmessage = async (e) => {
  const { scripts, hook, payload } = e.data;
  const logs = [], errors = [];
  const hooks = {};
  const api = {
    hooks: { register(name, fn) { (hooks[name] ||= []).push(fn); } },
    log: (...a) => logs.push(a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
  };
  for (const s of scripts) {
    try { new Function('api', s.code)(api); }
    catch (err) { errors.push(s.name + ': ' + (err && err.message || err)); }
  }
  let value = payload;
  for (const fn of hooks[hook] || []) {
    try {
      const r = await fn(structuredClone(value));
      if (r && typeof r === 'object') value = { ...value, ...r };
    } catch (err) { errors.push(hook + ': ' + (err && err.message || err)); }
  }
  self.postMessage({ value, logs, errors });
};`;

let workerUrl: string | null = null;

/** Run `hook` across enabled scripts. Resolves the (possibly modified) payload. */
export function runHook<T extends object>(scripts: UserScript[], hook: HookName, payload: T, timeoutMs = 3000): Promise<HookResult<T>> {
  const enabled = scripts.filter((s) => s.enabled && s.code.trim());
  if (!enabled.length || typeof Worker === 'undefined') return Promise.resolve({ value: payload, logs: [], errors: [] });
  workerUrl ??= URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  const worker = new Worker(workerUrl);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ value: payload, logs: [], errors: [`Scripts timed out after ${timeoutMs}ms`] });
    }, timeoutMs);
    worker.onmessage = (e: MessageEvent<HookResult<T>>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ value: payload, logs: [], errors: [e.message] });
    };
    worker.postMessage({ scripts: enabled.map(({ name, code }) => ({ name, code })), hook, payload });
  });
}

export const EXAMPLE_SCRIPT = `// Hooks: onContextBuilt({ system, context }), onResponse({ text }), onInput({ text })
// Return an object with the fields you want to change.

api.hooks.register('onResponse', ({ text }) => {
  // Example: straighten curly quotes in AI output.
  return { text: text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'") };
});

api.hooks.register('onContextBuilt', ({ context }) => {
  api.log('context length', context.length);
});
`;
