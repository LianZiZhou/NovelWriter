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
// Advanced Options starts open; only expand it when collapsed.
if ((await page.getByRole('button', { name: /Advanced Options/ }).getAttribute('aria-expanded')) === 'false') await page.getByRole('button', { name: /Advanced Options/ }).click();
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
await page.setViewportSize({ width: 1600, height: 900 });

// Detail states, named like capture-reference.mjs. Each step is independent.
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log('skipped', name, e.message.split('\n')[0]);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
};
const toStory = async () => page.getByRole('tab', { name: 'Story' }).click();
await step('model-dropdown', async () => {
  await toStory();
  await page.getByRole('button', { name: 'AI Model' }).click();
  await shot('model-dropdown');
});
await step('export-menu', async () => {
  await page.locator('.right-body').evaluate((e) => e.scrollTo(0, 99999));
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.locator('.right-body').evaluate((e) => e.scrollTo(0, 99999));
  await shot('export-menu');
});
await step('story-stats', async () => {
  await page.getByRole('button', { name: 'View Story Stats' }).click();
  await shot('story-stats');
});
await step('memory-expand', async () => {
  await page.locator('.right-body').evaluate((e) => e.scrollTo(0, 0));
  await page.getByRole('button', { name: 'expand memory' }).click();
  await shot('memory-expand');
});
await step('context-viewer', async () => {
  await page.getByRole('tab', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Current Context' }).click();
  await shot('context-viewer');
});
await step('system-prompt', async () => {
  await page.getByRole('button', { name: 'Edit System Prompt' }).click();
  await shot('system-prompt');
});
await step('user-scripts', async () => {
  await page.evaluate(async () => {
    const s = await (await fetch('/api/settings')).json();
    await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...s, userScriptsAccepted: null, rightTab: 'advanced' }) });
  });
  // The notice only shows before the first answer, so reload with the answer cleared.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Edit User Scripts/ }).click();
  await shot('user-scripts');
});
await step('samplers', async () => {
  await page.getByRole('tab', { name: 'Generation Settings' }).click();
  await page.locator('.change-samplers').click();
  await shot('samplers');
});
await step('context-special', async () => {
  await toStory();
  await page.locator('.ProseMirror').click({ button: 'right', position: { x: 200, y: 20 } });
  await page.getByRole('menuitem', { name: /Special Character/ }).hover();
  await shot('context-special');
});
await step('redo-list', async () => {
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' More words.');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.locator('.branch-count').click();
  await shot('redo-list');
  await page.locator('.branch-count').click();
});
await step('settings-bottoms', async () => {
  await page.getByRole('button', { name: 'Open Settings' }).first().click();
  for (const tab of ['AI Settings', 'Interface', 'Theme', 'Text To Speech', 'Defaults', 'Hotkeys']) {
    await page.locator('.split-modal .nav button', { hasText: tab }).first().click();
    await page.locator('.split-modal .content-body').evaluate((e) => e.scrollTo(0, 99999));
    await shot(`settings-${tab.replace(/ /g, '')}-bottom`);
  }
  await page.locator('.split-modal .nav button', { hasText: 'Change Log' }).click();
  await shot('changelog');
  await page.keyboard.press('Escape');
});
await step('account-menu', async () => {
  await page.getByRole('button', { name: 'Open Account Menu' }).click();
  await shot('account-menu');
  await page.getByRole('button', { name: 'Open Account Menu' }).click();
});
await step('story-settings', async () => {
  await page.locator('.story-card.active [aria-label="Edit Story Information"]').click();
  await shot('story-settings');
});
await step('filters', async () => {
  await page.getByRole('button', { name: 'Open Sort Settings' }).click();
  await shot('filters');
  await page.getByRole('button', { name: 'Open Sort Settings' }).click();
});
await step('adventure', async () => {
  await page.getByRole('button', { name: 'create a new story' }).click();
  await page.getByRole('button', { name: /Text Adventure/ }).first().click();
  await shot('adventure');
});
await step('dashboard', async () => {
  await page.getByRole('button', { name: 'Open Account Menu' }).click();
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await shot('dashboard');
});
await browser.close();
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
console.log('saved to', out);
