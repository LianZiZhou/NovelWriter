// Screenshot NovelWriter in the same states as capture-reference.mjs, for side-by-side comparison.
// Usage: node scripts/capture-app.mjs [baseUrl]   (default http://127.0.0.1:5173)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const out = new URL('../reference/app/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}${name}.png` });
};

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'create a new story' }).click();
await shot('new-story');
await page.getByRole('button', { name: /Storyteller/ }).first().click();
await page.waitForTimeout(500);
await page.locator('.ProseMirror').click();
await page.keyboard.type('The rain had not stopped for three days.');
await page.waitForTimeout(400);
await shot('editor-both');
await page.getByRole('tab', { name: 'Advanced' }).click();
await shot('advanced');
await page.getByRole('tab', { name: 'Generation Settings' }).click();
await shot('generation');
await page.getByRole('button', { name: /Advanced Options/ }).click();
await page.setViewportSize({ width: 1600, height: 2600 });
await shot('generation-advanced');
await page.setViewportSize({ width: 1600, height: 900 });
await page.getByRole('tab', { name: 'Story' }).click();
await page.getByRole('button', { name: 'Lorebook', exact: true }).first().click();
await shot('lorebook-empty');
await page.getByRole('button', { name: /^Entry$/ }).click();
await shot('lorebook-entry');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Open Settings' }).first().click();
for (const tab of ['AI Settings', 'Interface', 'Theme', 'Text To Speech', 'Defaults', 'Hotkeys', 'AI Providers']) {
  await page.locator('.split-modal .nav button', { hasText: tab }).click();
  await shot(`settings-${tab.replace(/ /g, '')}`);
}
await page.keyboard.press('Escape');
await page.locator('.ProseMirror').click({ button: 'right', position: { x: 200, y: 20 } });
await shot('context-menu');
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 390, height: 844 });
await shot('mobile');
await browser.close();
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
console.log('saved to', out);
