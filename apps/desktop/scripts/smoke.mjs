// Smoke test for the bundled desktop app: launches Electron on dist/main.mjs
// (or a packaged executable given as argv[2]) with a throwaway profile and
// checks the window, the in-process server and the link handling.
// Linux CI/containers: run under `xvfb-run -a`.
import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packaged = process.argv[2];
const profile = mkdtempSync(join(tmpdir(), 'nw-desktop-'));
const args = [`--user-data-dir=${profile}`];
// Test harness only: Chromium's sandbox needs a SUID chrome-sandbox or unprivileged user
// namespaces, which root containers and Ubuntu 24.04 CI runners do not provide.
if (process.platform === 'linux') args.unshift('--no-sandbox');
const executablePath = packaged ?? createRequire(import.meta.url)('electron');
if (!packaged) args.push(join(root, 'dist/main.mjs'));

const step = async (name, fn) => {
  process.stdout.write(`- ${name} ... `);
  await fn();
  console.log('ok');
};

const app = await electron.launch({ executablePath, args, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }, timeout: 60_000 });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const origin = new URL(page.url()).origin;

  await step(`window loads the app from ${origin}`, async () => {
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    await page.waitForSelector('#root > *', { timeout: 30_000 });
    assert.equal(await page.title(), 'NovelWriter');
    if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SMOKE_SCREENSHOT });
  });

  await step('security defaults (no Node in the page)', async () => {
    assert.equal(await page.evaluate(() => typeof globalThis.require + typeof globalThis.process), 'undefinedundefined');
  });

  await step('API reachable from the window, refused without the per-launch password', async () => {
    assert.deepEqual(await page.evaluate(() => fetch('/api/health').then((r) => r.json())), { ok: true });
    assert.equal((await fetch(`${origin}/api/health`)).status, 401);
  });

  await step('demo generation streams over SSE', async () => {
    const body = await page.evaluate(() =>
      fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: { provider: 'demo', id: 'markov' }, system: 'continue', messages: [{ role: 'user', content: 'The rain fell on the old bridge.' }], params: { maxLength: 200 } }),
      }).then((r) => r.text()),
    );
    assert.match(body, /"type":"delta"/);
    assert.match(body, /"type":"done"/);
  });

  await step('o200k tokenizer data is bundled', async () => {
    const res = await page.evaluate(async () => {
      // A custom endpoint of the OpenAI flavour is tokenized locally with o200k.
      const json = { 'content-type': 'application/json' };
      const provider = [{ id: 'smoke', name: 'Smoke', baseUrl: 'http://127.0.0.1:9/v1', flavor: 'openai', models: [{ id: 'm' }] }];
      await fetch('/api/custom-providers', { method: 'PUT', headers: json, body: JSON.stringify(provider) });
      const id = 'm';
      return fetch('/api/tokenize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: { provider: 'smoke', id }, text: 'Hello world' }) }).then((r) => r.json());
    });
    assert.equal(res.tokenizer, 'o200k');
    assert.deepEqual(res.ids, [13225, 2375]);
  });

  await step('OAuth login over the WebSocket yields a login URL (bundled pi-ai flow)', async () => {
    const event = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://${location.host}/api/auth/login?provider=anthropic&type=oauth`);
          const t = setTimeout(() => reject(new Error('no login event in 15s')), 15_000);
          ws.onmessage = (m) => {
            const msg = JSON.parse(m.data);
            if (msg.type === 'error') reject(new Error(msg.message));
            const url = msg.event?.url ?? msg.prompt?.url;
            if (url || msg.type === 'prompt') {
              clearTimeout(t);
              ws.send(JSON.stringify({ type: 'cancel' }));
              ws.close();
              resolve({ type: msg.type, url });
            }
          };
          ws.onerror = () => reject(new Error('websocket error'));
        }),
    );
    assert.ok(event.url ? /^https:\/\//.test(event.url) : event.type === 'prompt', JSON.stringify(event));
  });

  await step('external links go to the system browser (http(s) only)', async () => {
    await app.evaluate(({ shell }) => {
      globalThis.__opened = [];
      shell.openExternal = async (url) => void globalThis.__opened.push(url);
    });
    await page.evaluate(() => {
      window.open('https://example.com/a', '_blank', 'noopener');
      window.open('file:///etc/passwd', '_blank');
      window.open('javascript:alert(1)', '_blank');
      const a = Object.assign(document.createElement('a'), { href: 'https://example.com/b', target: '_blank', rel: 'noopener noreferrer' });
      document.body.append(a);
      a.click();
      a.remove();
    });
    await page.waitForTimeout(500);
    assert.deepEqual(await app.evaluate(() => globalThis.__opened), ['https://example.com/a', 'https://example.com/b']);
    assert.equal(app.windows().length, 1);
    assert.equal(new URL(page.url()).origin, origin);
  });

  await step('graceful quit', async () => {
    const proc = app.process();
    const exited = new Promise((r) => proc.once('exit', (code) => r(code)));
    await app.evaluate(({ app: a }) => a.quit());
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 10_000))]);
    assert.equal(code, 0);
  });
  console.log('desktop smoke test passed');
} catch (e) {
  await app.close().catch(() => {});
  throw e;
} finally {
  rmSync(profile, { recursive: true, force: true });
}
