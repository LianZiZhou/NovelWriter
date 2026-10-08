// Capture NovelAI reference screenshots and computed styles for UI comparison.
// Output goes to reference/ (gitignored). Usage: node scripts/capture-reference.mjs
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = new URL('../reference/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const clickText = (t) =>
  page.evaluate((t) => {
    const els = [...document.querySelectorAll('button,div,span,a')].filter((e) => e.offsetParent && e.innerText?.trim() === t);
    const el = els[els.length - 1];
    if (!el) return false;
    (el.closest('button') || el).click();
    return true;
  }, t);
const clickAria = (t) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('[aria-label]')].filter((e) => e.offsetParent).find((e) => e.getAttribute('aria-label') === t);
    if (!el) return false;
    el.click();
    return true;
  }, t);
const shot = async (name) => {
  await wait(1200);
  await page.screenshot({ path: `${out}${name}.png` });
};

/** Dump computed styles for elements matched by visible text or aria-label. */
async function measure(name, targets) {
  const data = await page.evaluate((targets) => {
    const pick = ['width', 'height', 'padding', 'margin', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'backgroundColor', 'border', 'borderRadius', 'letterSpacing', 'gap'];
    const res = {};
    for (const t of targets) {
      const all = [...document.querySelectorAll('*')].filter((e) => e.offsetParent || e === document.body);
      const el =
        t.startsWith('aria:') ? all.find((e) => e.getAttribute('aria-label') === t.slice(5))
        : t.startsWith('css:') ? document.querySelector(t.slice(4))
        : all.filter((e) => e.childElementCount === 0 && e.textContent?.trim() === t).pop();
      if (!el) { res[t] = null; continue; }
      const chain = [];
      let cur = el;
      for (let i = 0; i < 4 && cur; i++, cur = cur.parentElement) {
        const cs = getComputedStyle(cur);
        const r = cur.getBoundingClientRect();
        chain.push({ tag: cur.tagName, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], ...Object.fromEntries(pick.map((k) => [k, cs[k]])) });
      }
      res[t] = chain;
    }
    return res;
  }, targets);
  writeFileSync(`${out}${name}.json`, JSON.stringify(data, null, 1));
}

await page.goto('https://novelai.net/stories', { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(8000);
await page.keyboard.press('Escape');
await clickAria('Close this consent banner');
await clickText('New Story');
await wait(5000);
await page.keyboard.press('Escape');
await shot('new-story');
await measure('new-story', ["Let's start writing!", 'Storyteller', 'Text Adventure', 'Shuffle']);
await clickText('Storyteller');
await wait(6000);
await page.keyboard.press('Escape');
await page.click('.ProseMirror').catch(() => {});
await page.keyboard.type('The rain had not stopped for three days.');
await shot('editor-collapsed');
await page.mouse.click(1545, 88);
await page.mouse.click(48, 88);
await shot('editor-both');
await measure('editor', [
  'Your Stories', 'aria:Send', 'aria:Undo', 'aria:Retry', 'aria:Lorebook', 'New Story', 'css:.ProseMirror', 'css:.ProseMirror p',
  'Story', 'Advanced', 'AI Model', 'Config Preset', 'Memory', 'The AI will better remember info placed here.', 'Lorebook Quick Access',
  'Editor Token Probabilities', 'Import File', 'New Shelf', 'aria:Edit Story Information', 'a few seconds ago', 'aria:Open Settings',
]);
await clickText('Advanced');
await shot('advanced');
await measure('advanced', ['Context', 'Last Context', 'Edit System Prompt', 'Logit Bias', 'Stop Sequences', 'Avoid Overused Words']);
await page.mouse.click(1537, 85);
await shot('generation');
await measure('generation', ['Randomness', 'Output Length', 'Generation Options', 'Advanced Options', 'Default: 1']);
await clickText('Advanced Options');
await page.setViewportSize({ width: 1600, height: 2600 });
await shot('generation-advanced');
await page.setViewportSize({ width: 1600, height: 900 });
await clickAria('Lorebook');
await shot('lorebook-empty');
await clickText('Entry');
await shot('lorebook-entry');
await measure('lorebook', ['Entries', 'Entry Text', 'Activation Keys', 'Category', 'Always On', 'Enabled']);
for (const t of ['Placement', 'Advanced Conditions', 'Category']) if (await clickText(t)) await shot(`lorebook-${t.replace(/ /g, '')}`);
await page.keyboard.press('Escape');
await wait(600);
await page.keyboard.press('Escape');
await page.mouse.click(48, 88);
await clickAria('Open Settings');
for (const t of ['AI Settings', 'Interface', 'Theme', 'Text To Speech', 'Defaults', 'Hotkeys']) if (await clickText(t)) await shot(`settings-${t.replace(/ /g, '')}`);
await measure('settings', ['User Settings', 'AI Settings', 'Stream AI Responses', 'AI Responses']);
await page.keyboard.press('Escape');
await wait(600);
await page.mouse.click(700, 195, { button: 'right' });
await shot('context-menu');
await measure('context-menu', ['Cut', 'Generate Inline', 'Writer\'s Toolbox']);
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 390, height: 844 });
await shot('mobile');
await browser.close();
console.log('saved to', out);
