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
  try {
    await fn();
  } catch (e) {
    await page.screenshot({ path: `${out}failure.png` }).catch(() => {});
    throw e;
  }
  console.log('ok');
};
const editorText = () => page.locator('.ProseMirror').innerText();

await page.goto(base, { waitUntil: 'networkidle' });

await step('use the offline demo model by default', async () => {
  await page.evaluate(async () => {
    const s = await (await fetch('/api/settings')).json();
    await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...s, defaultModel: { provider: 'demo', id: 'markov' }, language: 'en', rightTab: 'story', rightOpen: true, leftOpen: true, userScriptsAccepted: null, tokenProbabilities: false, editorTokenProbabilities: false }) });
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

await step('lorebook: welcome, key editing, hidden entries, confirm over the modal', async () => {
  await page.getByRole('button', { name: 'Lorebook', exact: true }).first().click();
  await page.waitForSelector('.lore-welcome');
  await page.locator('.lore-item').first().click();
  await page.getByRole('button', { name: 'Edit key mara' }).click();
  await page.getByLabel('Edit key', { exact: true }).fill('Mara');
  await page.getByLabel('Edit key', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Edit key Mara' }).waitFor();
  await page.getByRole('button', { name: 'Hide Entry' }).click();
  await page.getByLabel('Entry Text').waitFor(); // hiding it yourself keeps it open
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Lorebook', exact: true }).first().click();
  await page.locator('.lore-item').first().click();
  await page.getByRole('button', { name: 'Reveal Entry' }).click();
  await page.getByRole('button', { name: 'Unhide Entry' }).click();
  // A confirmation opens above the lorebook and cancelling it keeps the lorebook open.
  await page.getByRole('button', { name: /^Category$/ }).click();
  await page.locator('.cat-head.active').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete Category?' }).getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await page.locator('.lore-modal').count(), 1, 'lorebook stays open');
  await page.locator('.cat-head.active').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete Category?' }).getByRole('button', { name: 'Delete' }).click();
  assert.equal(await page.locator('.lore-cat').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.lore-modal').count(), 0);
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
  await page.locator('.modal').getByRole('button', { name: 'New Script' }).click();
  // The first API version (api.hooks.register) still works.
  await page.getByRole('textbox', { name: 'Script', exact: true }).fill("api.hooks.register('onResponse', ({ text }) => ({ text: text + ' [[SCRIPTED]]' }));");
  await page.locator('.modal').getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.scripts-item.active [role=switch]').click();
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

await step("writer's toolbox infills at the cursor", async () => {
  const p = page.locator('.ProseMirror p').first();
  await p.click();
  await page.keyboard.press('End');
  const before = await editorText();
  await p.click({ button: 'right' });
  await page.getByRole('menuitem', { name: "Writer's Toolbox" }).click();
  await page.getByRole('tab', { name: 'Infill' }).waitFor();
  await page.locator('.modal').getByRole('button', { name: 'Generate' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Insert', exact: true }).click();
  assert.equal(await page.locator('.modal').count(), 0);
  assert.ok((await editorText()).length > before.length, 'infill inserted text');
});

await step('find and replace', async () => {
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' findme and findme.');
  await page.keyboard.press('Control+f');
  await page.getByRole('textbox', { name: 'Find' }).fill('findme');
  await page.getByRole('button', { name: 'Toggle Replace' }).click();
  await page.getByRole('textbox', { name: 'Replace with' }).fill('FOUNDIT');
  await page.getByRole('button', { name: 'Replace All' }).click();
  const text = await editorText();
  assert.equal(text.includes('findme'), false);
  assert.equal(text.split('FOUNDIT').length - 1, 2);
  await page.getByRole('textbox', { name: 'Find' }).press('Escape');
});

await step('instruction lines and ephemeral entries typed in the story', async () => {
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('{');
  await page.keyboard.type('Describe the storm');
  await page.waitForSelector('.ProseMirror p.instruction-line');
  { const txt = await editorText(); assert.ok(txt.includes('{ Describe the storm }'), `brace auto-closed: ${JSON.stringify(txt.slice(-80))}`); }
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('{');
  await page.keyboard.type('+0~3,-1:EPHNOTE');
  await page.getByRole('button', { name: 'Send' }).click();
  // The line leaves the story when generation starts; waiting on the Send label alone can pass before that.
  await page.waitForFunction(() => !document.querySelector('.ProseMirror')?.textContent?.includes('EPHNOTE'), null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.send-btn')?.getAttribute('aria-label') === 'Send');
  assert.equal((await editorText()).includes('EPHNOTE'), false, 'ephemeral line moved out of the story');
  // Saves are batched; poll until the entry reaches the server.
  await page.waitForFunction(async () => {
    const list = await (await fetch('/api/stories')).json();
    const id = [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    return (await (await fetch(`/api/stories/${id}`)).json()).ephemeral.some((e) => e.text.includes('EPHNOTE'));
  }, null, { timeout: 10000, polling: 300 });
});

await step('side chat about the recent story', async () => {
  await page.getByRole('tab', { name: 'Side Chat' }).click();
  await page.getByRole('button', { name: 'Chat About the Recent Story' }).click();
  await page.waitForSelector('.chat-msg.assistant .chat-text:not(:has(.spinner))');
  await page.waitForFunction(() => !document.querySelector('.side-chat-actions [aria-label="Stop"]'));
  assert.ok((await page.locator('.chat-msg.assistant').innerText()).length > 5);
  await page.getByRole('textbox', { name: 'Chat message' }).fill('Who is Mara?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.chat-msg.assistant').length === 2 && !document.querySelector('.side-chat-actions [aria-label="Stop"]'));
  await page.getByRole('tab', { name: 'Story' }).click();
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

await step('token probabilities: pick an alternative in the editor', async () => {
  await page.getByRole('button', { name: 'Open Settings' }).first().click();
  await page.locator('.split-modal .nav button', { hasText: 'AI Settings' }).click();
  await page.getByRole('switch', { name: 'Enable Token Probabilities' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Story' }).click();
  await page.getByRole('switch', { name: 'Editor Token Probabilities' }).click();
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.querySelector('.send-btn')?.getAttribute('aria-label') === 'Send');
  await page.waitForSelector('.ProseMirror .tp');
  const before = await editorText();
  await page.locator('.ProseMirror .tp').nth(3).click();
  await page.waitForSelector('.tp-popover');
  await page.locator('.tp-popover button:not([disabled])').first().click();
  await page.waitForFunction(() => document.querySelector('.send-btn')?.getAttribute('aria-label') === 'Send');
  await page.waitForTimeout(300);
  assert.notEqual(await editorText(), before, 'text changed after picking an alternative');
  await page.keyboard.press('Control+Alt+t');
  await page.waitForSelector('.tp-modal .tp-chip');
  await page.keyboard.press('Escape');
});

await step('export story to file', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'To File' }).click()]);
  assert.ok(dl.suggestedFilename().endsWith('.story'));
});

await step('shelves: create, drag a story in, search the shelf, nested shelf, back out', async () => {
  const title = await page.locator('.story-card.active .name').innerText();
  await page.getByRole('button', { name: 'New Shelf' }).click();
  await page.getByLabel('Shelf Name').fill('E2E Shelf');
  await page.getByRole('button', { name: 'Create Shelf' }).click();
  const shelfCard = page.locator('.shelf-card', { hasText: 'E2E Shelf' });
  await page.locator('.story-card.active').dragTo(shelfCard);
  await page.waitForFunction(() => !document.querySelector('.story-card.active'));
  await shelfCard.click();
  await page.locator('.story-card.active').waitFor();
  await page.getByRole('button', { name: 'Search stories' }).click();
  await page.getByPlaceholder('Search this shelf').fill('zzzz-not-here');
  await page.getByText("We can't find what you're looking for.").waitFor();
  await page.getByPlaceholder('Search this shelf').fill('');
  await page.getByRole('button', { name: 'Search stories' }).click();
  // A shelf inside this shelf.
  await page.getByRole('button', { name: 'New Shelf' }).click();
  await page.getByLabel('Shelf Name').fill('Inner Shelf');
  await page.getByRole('button', { name: 'Create Shelf' }).click();
  await page.locator('.shelf-card', { hasText: 'Inner Shelf' }).waitFor();
  // Drag the story back to the library via the back button.
  await page.locator('.story-card.active').dragTo(page.locator('.shelf-back'));
  await page.locator('.shelf-back').click();
  await page.locator('.story-card.active', { hasText: title }).waitFor();
  assert.ok((await page.locator('.shelf-card', { hasText: 'E2E Shelf' }).innerText()).includes('0'), 'shelf now empty');
  // Clean up: delete the outer shelf (the inner one moves up), then the inner one.
  for (const name of ['E2E Shelf', 'Inner Shelf']) {
    await page.locator('.shelf-card', { hasText: name }).getByRole('button', { name: 'Delete Shelf' }).click();
    await page.getByRole('dialog', { name: 'Delete Shelf?' }).getByRole('button', { name: 'Delete' }).click();
    await page.locator('.shelf-card', { hasText: name }).waitFor({ state: 'detached' });
  }
});

await step('download all stories as a zip', async () => {
  await page.getByRole('button', { name: 'Open Account Menu' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download All Stories' }).click()]);
  assert.ok(dl.suggestedFilename().endsWith('.zip'));
  const path = await dl.path();
  const { readFileSync } = await import('node:fs');
  assert.equal(readFileSync(path).subarray(0, 2).toString(), 'PK');
  await page.getByRole('button', { name: 'Open Account Menu' }).click();
});

await step('scenario browser and placeholders dialog', async () => {
  await page.getByRole('button', { name: 'create a new story' }).click();
  await page.getByRole('button', { name: /View All Scenarios/ }).click();
  await page.getByLabel('Search scenarios').fill('goblin');
  assert.equal(await page.locator('.scenario-card h3').count(), 1);
  await page.locator('.scenario-card').first().getByRole('button', { name: 'Start' }).click();
  await page.getByText('used in').first().waitFor();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Bramble');
  await page.getByRole('button', { name: 'Fill Placeholders' }).click();
  await page.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent?.includes('Bramble'));
});

await step('tutorial, message-format context, tokenizer, speech endpoint settings', async () => {
  await page.getByRole('button', { name: 'Open Account Menu' }).click();
  await page.getByRole('button', { name: 'Interactive Tutorials' }).click();
  const tour = page.getByRole('dialog', { name: 'Interactive Tutorial' });
  await tour.waitFor();
  for (let i = 0; i < 6; i++) await tour.getByRole('button', { name: 'Next' }).click();
  await tour.getByRole('button', { name: 'Finish' }).click();
  await tour.waitFor({ state: 'detached' });

  await page.locator('.right-tabs').getByRole('tab', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Current Context' }).click();
  await page.getByRole('button', { name: 'Message Format' }).click();
  await page.getByText('Transformed context to message format.').waitFor();
  assert.ok((await page.locator('.ctx-msg').count()) >= 2, 'system + user messages');
  await page.keyboard.press('Escape');
  await page.locator('.right-tabs').getByRole('tab', { name: 'Story' }).click();

  await page.getByRole('button', { name: 'Open Account Menu' }).click();
  await page.getByRole('button', { name: 'Tokenizer' }).click();
  await page.getByPlaceholder('Type text to tokenize…').fill('Hello world');
  await page.getByLabel('Token IDs').fill('13225, 2375');
  await page.waitForFunction(() => [...document.querySelectorAll('.ctx-text')].some((e) => e.textContent === 'Hello world'));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open Account Menu' }).click();

  await page.getByRole('button', { name: 'Open Settings' }).first().click();
  await page.locator('.split-modal .nav button', { hasText: 'Text To Speech' }).click();
  await page.getByText('Speech Endpoint', { exact: true }).click();
  await page.getByText('Endpoint URL').waitFor();
  await page.getByText('Streamed TTS Settings').waitFor();
  await page.getByText('Browser Voices', { exact: true }).click();
  await page.keyboard.press('Escape');
});

await step('scripts: sandbox, examples with buttons, windows, panels, decorations, TypeScript, hang guard', async () => {
  await page.locator('.right-tabs').getByRole('tab', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: /Edit User Scripts/ }).click();
  const modal = page.locator('.scripts-modal');
  // Network access is blocked inside the sandbox.
  await modal.getByRole('button', { name: 'New Script' }).click();
  await page.getByLabel('Script name').fill('Net Probe');
  await page.getByRole('textbox', { name: 'Script', exact: true }).fill(
    "try { await fetch('/api/health'); api.v1.log('NET:open'); } catch (e) { api.v1.log('NET:blocked'); }\napi.v1.log('parent:' + (() => { try { return String(parent.document.title); } catch { return 'unreachable'; } })());",
  );
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.scripts-item.active [role=switch]').click();
  await modal.getByRole('tab', { name: 'Logs' }).click();
  await modal.locator('.scripts-logs', { hasText: 'NET:blocked' }).waitFor();
  assert.ok((await modal.locator('.scripts-logs').innerText()).includes('parent:unreachable'));
  await page.locator('.scripts-item.active [role=switch]').click();

  for (const name of ['Find & Replace (script)', 'Bookmarks', 'Smart Summarizer']) {
    await modal.getByRole('button', { name: 'Add an example' }).click();
    await page.getByRole('option', { name }).click();
    await page.locator('.scripts-item.active [role=switch]').click();
    // Bookmarks draws its markers as soon as it loads, so it asks for editorDecorations right away.
    if (name === 'Bookmarks') await page.getByRole('dialog', { name: /Allow/ }).getByRole('button', { name: 'Allow' }).click();
  }
  await modal.getByRole('tab', { name: 'Diagnostics' }).click();
  await modal.locator('.scripts-diag dd', { hasText: /^Running$/ }).waitFor(); // Smart Summarizer is TypeScript: compiled and running
  await page.keyboard.press('Escape');

  // Find & Replace window from a toolbar button; documentEdit is asked for once.
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' zebra and zebra.');
  await page.locator('.script-toolbar').getByRole('button', { name: 'Find & Replace' }).click();
  const win = page.getByRole('dialog', { name: 'Find & Replace' });
  await win.getByLabel('Find', { exact: true }).fill('zebra');
  await win.getByText('2 match(es)').waitFor();
  await win.getByLabel('Replace with').fill('okapi');
  await win.getByRole('button', { name: 'Replace All' }).click();
  await page.getByRole('dialog', { name: /Allow/ }).getByRole('button', { name: 'Allow' }).click();
  await page.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent?.includes('okapi and okapi'));
  await win.locator('.script-parts').getByRole('button', { name: 'Close' }).click();

  // Bookmarks: context menu button, editor markers, sidebar panel.
  const p = page.locator('.ProseMirror p').first();
  await p.click({ clickCount: 3 });
  await p.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'User Scripts' }).hover();
  await page.getByRole('menuitem', { name: /Bookmark selection/ }).click();
  await page.waitForSelector('.ProseMirror .script-deco');
  await page.locator('.right-tabs').getByRole('tab', { name: 'Script Panels' }).click();
  await page.locator('.script-panel', { hasText: 'Bookmarks' }).waitFor();
  await page.locator('.right-tabs').getByRole('tab', { name: 'Story' }).click();

  // Smart Summarizer (TypeScript): generation + Memory edit.
  await page.locator('.script-toolbar').getByRole('button', { name: 'Summarize into Memory' }).click();
  await page.getByRole('dialog', { name: /Allow/ }).getByRole('button', { name: 'Allow' }).click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="memory"]')?.value.includes('[ Summary ]'), null, { timeout: 30000 });

  // A script that hangs in a hook is stopped and generation carries on.
  await page.locator('.right-tabs').getByRole('tab', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: /Edit User Scripts/ }).click();
  await modal.getByRole('button', { name: 'New Script' }).click();
  await page.getByRole('textbox', { name: 'Script', exact: true }).fill("api.v1.hooks.register('onContextBuilt', () => { while (true) {} });");
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.scripts-item.active [role=switch]').click();
  await page.keyboard.press('Escape');
  const before = (await editorText()).length;
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.querySelector('.send-btn')?.getAttribute('aria-label') === 'Send', null, { timeout: 30000 });
  assert.ok((await editorText()).length > before, 'generated despite the hanging script');
  await page.getByText(/took longer than 5s/).first().waitFor();
  // Turn every script off again for later runs.
  await page.getByRole('button', { name: /Edit User Scripts/ }).click();
  const on = page.locator('.scripts-item [role=switch][aria-checked=true]');
  while ((await on.count()) > 0) await on.first().click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(async () => {
    const list = await (await fetch('/api/stories')).json();
    const id = [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    return (await (await fetch(`/api/stories/${id}`)).json()).scripts.every((x) => !x.enabled);
  }, null, { timeout: 10000, polling: 300 });
  await page.locator('.right-tabs').getByRole('tab', { name: 'Story' }).click();
});

await page.screenshot({ path: `${out}final.png` });
await browser.close();
if (errors.length) {
  console.error('page errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('all e2e steps passed');
