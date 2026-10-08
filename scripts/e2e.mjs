// End-to-end smoke test against a running dev stack (server + vite), using the offline demo model.
// Usage: node scripts/e2e.mjs [baseUrl]
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const out = new URL('../reference/e2e/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
// Every editor update is checked against a full document conversion (see StoryEditor onUpdate).
await ctx.addInitScript(() => {
  window.__nwCheckDoc = true;
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  await fn();
  console.log('ok');
};
const editorText = () => page.locator('.ProseMirror').innerText();

await page.goto(base, { waitUntil: 'networkidle' });

await step('use the offline demo model by default', async () => {
  await page.evaluate(async () => {
    const s = await (await fetch('/api/settings')).json();
    await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...s, defaultModel: { provider: 'demo', id: 'markov' }, language: 'en', rightTab: 'story', rightOpen: true, leftOpen: true, userScriptsAccepted: null }) });
  });
  await page.reload({ waitUntil: 'networkidle' });
});

await step('create a storyteller story and type a prompt', async () => {
  await page.getByRole('button', { name: 'create a new story' }).click();
  await page.getByRole('button', { name: /Storyteller/ }).first().click();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Mara crossed the old bridge in the rain.');
  assert.equal(await page.locator('.ProseMirror .o-prompt').count() > 0, true, 'prompt text should be cream (o-prompt)');
});

await step('send streams AI text', async () => {
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForSelector('.ProseMirror .o-ai');
  await page.waitForFunction(() => document.querySelector('.send-btn')?.getAttribute('aria-label') === 'Send');
  const text = await editorText();
  assert.ok(text.length > 'Mara crossed the old bridge in the rain.'.length + 10, 'story grew');
});

await step('user typing at end is blue, edits are pink', async () => {
  await page.locator('.ProseMirror').press('Control+End');
  await page.keyboard.type(' She waited.');
  await page.waitForSelector('.ProseMirror .o-user');
  // edit inside the prompt text
  await page.locator('.ProseMirror p').first().click({ position: { x: 5, y: 10 } });
  await page.keyboard.press('Home');
  await page.keyboard.type('X');
  await page.waitForSelector('.ProseMirror .o-edit');
});

await step('incremental edits stay in sync with the stored document', async () => {
  const ed = page.locator('.ProseMirror');
  await ed.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Then');
  await page.keyboard.press('Enter');
  await page.keyboard.type('A new line.');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('After a blank.');
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Edit ');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+v');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Delete');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  assert.equal(errors.length, 0, errors.join('\n'));
});

await step('retry produces a sibling branch', async () => {
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.querySelector('.send-btn')?.getAttribute('aria-label') === 'Send');
  const before = await editorText();
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.waitForFunction(() => document.querySelector('.send-btn')?.getAttribute('aria-label') === 'Send');
  await page.waitForTimeout(300);
  const count = await page.locator('.branch-count').innerText();
  assert.equal(count.trim(), '2', 'two retry options');
  await page.locator('.branch-count').click();
  await page.locator('.redo-strip .redo-row').first().click();
  assert.equal(await editorText(), before, 'switching to first branch restores its text');
});

await step('undo and redo', async () => {
  const before = await editorText();
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.notEqual(await editorText(), before);
  await page.getByRole('button', { name: 'Redo' }).click();
  assert.equal(await editorText(), before);
});

await step('memory and lorebook activation show in the context viewer', async () => {
  await page.getByLabel('memory', { exact: true }).fill('MEMORY-MARKER');
  await page.getByRole('button', { name: 'Lorebook', exact: true }).first().click();
  await page.getByRole('button', { name: /^Entry$/ }).click();
  await page.getByLabel('Entry Text').fill('LORE-MARKER: Mara is a courier.');
  await page.getByLabel('save key').fill('mara');
  await page.getByLabel('save key').press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Current Context' }).click();
  const ctxText = await page.locator('.ctx-text').innerText();
  assert.ok(ctxText.startsWith('MEMORY-MARKER'), 'memory at top');
  assert.ok(ctxText.includes('LORE-MARKER'), 'lore entry activated by key');
  await page.screenshot({ path: `${out}context-viewer.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Story' }).click();
});

await step('text adventure input', async () => {
  await page.getByRole('button', { name: 'create a new story' }).click();
  await page.getByRole('button', { name: /Text Adventure/ }).first().click();
  await page.getByPlaceholder('What do you want to do?').fill('open the door');
  await page.getByPlaceholder('What do you want to do?').press('Enter');
  await page.waitForSelector('.ProseMirror .action-line');
  await page.waitForFunction(() => document.querySelector('.send-btn')?.getAttribute('aria-label') === 'Send');
  const txt = await editorText();
  assert.ok(txt.includes('You open the door.'), 'action inserted');
  assert.ok(!txt.includes('> You'), 'the > marker is hidden');
  await page.screenshot({ path: `${out}adventure.png` });
});

await step('stories persist across reload', async () => {
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.story-card');
  assert.ok((await page.locator('.story-card').count()) >= 2);
});

await step('user scripts hook the AI response', async () => {
  await page.locator('.story-card').nth(1).click();
  await page.getByRole('tab', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: /Edit User Scripts/ }).click();
  // First use shows the consent notice; later runs reuse the saved answer.
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 1500 }).catch(() => false)) await gotIt.click();
  await page.locator('.modal').getByRole('button', { name: 'Add' }).click();
  await page.getByRole('textbox', { name: 'Script', exact: true }).fill("api.hooks.register('onResponse', ({ text }) => ({ text: text + ' [[SCRIPTED]]' }));");
  await page.locator('.modal [role=switch]').first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent?.includes('[[SCRIPTED]]'));
  await page.getByRole('tab', { name: 'Story' }).click();
});

await step("writer's toolbox rewrites a selection", async () => {
  const p = page.locator('.ProseMirror p').first();
  await p.click({ clickCount: 3 });
  await p.click({ button: 'right' });
  await page.getByRole('menuitem', { name: "Writer's Toolbox" }).click();
  await page.getByRole('tab', { name: 'Condense' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Generate' }).click();
  await page.getByRole('button', { name: 'Replace' }).waitFor();
  await page.getByRole('button', { name: 'Replace' }).click();
  assert.equal(await page.locator('.modal').count(), 0);
});

await step('history tree opens and jumps', async () => {
  await page.locator('.branch-count').click();
  await page.getByRole('button', { name: /History Tree/ }).click();
  const nodes = page.locator('.history-tree .node');
  assert.ok((await nodes.count()) > 3);
  await nodes.nth(1).click();
  await page.keyboard.press('Escape');
});

await step('theme and language switch', async () => {
  await page.getByRole('button', { name: 'Open Settings' }).first().click();
  await page.locator('.split-modal .nav button', { hasText: 'Theme' }).click();
  await page.getByRole('button', { name: /NovelWriter Light/ }).click();
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg2').trim());
  assert.equal(bg.toUpperCase(), '#EEECF4');
  await page.screenshot({ path: `${out}theme-light.png` });
  await page.getByRole('button', { name: /NovelWriter Dark$/ }).click();
  await page.locator('.split-modal .nav button', { hasText: 'Interface' }).click();
  await page.locator('.split-modal .select-box').first().click();
  await page.getByRole('option', { name: '简体中文' }).click();
  await page.waitForSelector('text=发送');
  await page.screenshot({ path: `${out}zh.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '打开设置' }).first().click();
  await page.locator('.split-modal .nav button', { hasText: '界面' }).click();
  await page.locator('.split-modal .select-box').first().click();
  await page.getByRole('option', { name: 'English' }).click();
  await page.waitForSelector('text=Send');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800); // settings save is debounced
});

await step('export story to file', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'To File' }).click()]);
  assert.ok(dl.suggestedFilename().endsWith('.story'));
});

await page.screenshot({ path: `${out}final.png` });
await browser.close();
if (errors.length) {
  console.error('page errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('all e2e steps passed');
