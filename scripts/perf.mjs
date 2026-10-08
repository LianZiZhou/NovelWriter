// Editor performance on long stories. Creates stories of several sizes through the API, opens each in the
// running dev stack and measures open time, keystroke latency (typing at the end and at the start), scroll
// frame times and a demo-model generation. Usage: npx tsx scripts/perf.mjs [baseUrl] [sizes]
//   sizes: comma-separated character counts, default 100000,500000,1000000
import { chromium } from 'playwright-core';
import { flatten, newStory, uid } from '@novelwriter/core';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const sizes = (process.argv[3] ?? '100000,500000,1000000').split(',').map(Number);

const WORDS = 'the rain had not stopped for three days and the river rose against the old stone bridge while Mara counted lanterns in the dark she said nothing he waited a door opened somewhere below'.split(' ');
function makeDoc(chars) {
  const spans = [];
  let n = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const origins = ['prompt', 'ai', 'ai', 'ai', 'user', 'edit'];
  while (n < chars) {
    let p = '';
    const len = 200 + Math.floor(rnd() * 500);
    while (p.length < len) p += (p ? ' ' : '') + WORDS[Math.floor(rnd() * WORDS.length)];
    p = `${p[0].toUpperCase()}${p.slice(1)}. "${WORDS[Math.floor(rnd() * WORDS.length)]}," she said.`;
    const text = (spans.length ? '\n' : '') + p;
    spans.push({ text, origin: n === 0 ? 'prompt' : origins[Math.floor(rnd() * origins.length)] });
    n += text.length;
  }
  return spans;
}

async function api(path, init) {
  const r = await fetch(new URL(path, base), { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN;
};
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const rows = [];

for (const size of sizes) {
  const doc = makeDoc(size);
  const story = newStory({ id: uid(), title: `PERF ${size}`, doc, history: flatten(doc), step: 1 });
  await api(`/api/stories/${story.id}`, { method: 'PUT', body: JSON.stringify(story) });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const t0 = Date.now();
  await page.locator('.story-card', { hasText: `PERF ${size}` }).first().click();
  const paras = doc.length;
  await page.waitForFunction((n) => document.querySelectorAll('.ProseMirror p').length >= n, paras, { timeout: 120000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r))));
  const open = Date.now() - t0;

  // Latency from beforeinput to the frame after the DOM update.
  await page.evaluate(() => {
    window.__lat = [];
    document.addEventListener('beforeinput', () => {
      const t = performance.now();
      requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - t)));
    });
  });
  const typeAt = async (where) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.press(where === 'end' ? 'Control+End' : 'Control+Home');
    await page.evaluate(() => (window.__lat = []));
    for (let i = 0; i < 40; i++) {
      await page.keyboard.type('x');
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(400);
    return page.evaluate(() => window.__lat);
  };
  const end = await typeAt('end');
  const start = await typeAt('start');

  // Scroll frame times over ~1.5 s.
  const frames = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const el = document.querySelector('.editor-scroll');
        const out = [];
        let last = performance.now();
        const stopAt = last + 1500;
        el.scrollTop = 0;
        const tick = () => {
          const now = performance.now();
          out.push(now - last);
          last = now;
          el.scrollTop += 400;
          if (now < stopAt) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
  );

  // Stream a demo-model generation at the end; record long frames while it streams.
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    window.__frameRun = true;
    const tick = () => {
      const now = performance.now();
      window.__frames.push(now - last);
      last = now;
      if (window.__frameRun) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const g0 = Date.now();
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.querySelector('.send-btn')?.getAttribute('aria-label') === 'Stop', null, { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('.send-btn')?.getAttribute('aria-label') === 'Send', null, { timeout: 120000 });
  const gen = Date.now() - g0;
  const genFrames = await page.evaluate(() => {
    window.__frameRun = false;
    return window.__frames;
  });

  rows.push({
    gen,
    genP95: pct(genFrames, 95),
    size,
    paras,
    open,
    endP50: pct(end, 50),
    endP95: pct(end, 95),
    startP50: pct(start, 50),
    startP95: pct(start, 95),
    scrollP95: pct(frames, 95),
  });
  await api(`/api/stories/${story.id}`, { method: 'DELETE' }).catch(() => {});
}
await browser.close();

console.log('\nchars     paras  open(ms)  type@end p50/p95  type@start p50/p95  scroll frame p95  generate(ms) frame p95');
for (const r of rows) {
  console.log(
    `${String(r.size).padEnd(9)} ${String(r.paras).padEnd(6)} ${String(r.open).padEnd(9)} ${`${fmt(r.endP50)}/${fmt(r.endP95)}`.padEnd(17)} ${`${fmt(r.startP50)}/${fmt(r.startP95)}`.padEnd(19)} ${fmt(r.scrollP95).padEnd(17)} ${String(r.gen).padEnd(12)} ${fmt(r.genP95)}`,
  );
}
if (errors.length) console.log('\npage errors:\n' + errors.join('\n'));
