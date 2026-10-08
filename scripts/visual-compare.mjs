// Compose side-by-side comparisons: NovelAI reference (left) vs NovelWriter (right).
// Run capture-reference.mjs and capture-app.mjs first. Output: reference/compare/*.png
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';

const ref = new URL('../reference/', import.meta.url).pathname;
const app = `${ref}app/`;
const out = `${ref}compare/`;
mkdirSync(out, { recursive: true });
// NovelAI's anonymous session shows a 52px sign-up banner; crop it so layouts align.
const BANNER = Number(process.env.BANNER ?? 52);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const names = readdirSync(app).filter((f) => f.endsWith('.png') && existsSync(`${ref}${f}`));
for (const name of names) {
  const a = `data:image/png;base64,${readFileSync(`${ref}${name}`).toString('base64')}`;
  const b = `data:image/png;base64,${readFileSync(`${app}${name}`).toString('base64')}`;
  await page.setContent(`
    <body style="margin:0;background:#000;display:flex;gap:8px;font:14px sans-serif;color:#fff">
      <div><div style="padding:4px">NovelAI — ${name}</div><div style="width:800px;height:${450}px;overflow:hidden"><img src="${a}" style="width:800px;margin-top:-${BANNER / 2}px"></div></div>
      <div><div style="padding:4px">NovelWriter — ${name}</div><div style="width:800px;height:450px;overflow:hidden"><img src="${b}" style="width:800px"></div></div>
    </body>`);
  await page.setViewportSize({ width: 1608, height: 480 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${out}${name}` });
}
await browser.close();
console.log(`wrote ${names.length} comparisons to ${out}`);
