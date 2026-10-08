import { describe, expect, it } from 'vitest';
import { buildContext, trimText, unitBoundaries } from '../src/context.ts';
import { newLoreEntry, newStory } from '../src/defaults.ts';
import { countTokens } from '../src/tokenizer.ts';
import { parseEphemeral, ephemeralActive, findEphemeralLines, formatEphemeral } from '../src/ephemeral.ts';

describe('trimming', () => {
  it('splits units', () => {
    expect(unitBoundaries('a\nb\nc', 'newline')).toEqual([0, 2, 4, 5]);
    expect(unitBoundaries('One. Two! Three', 'sentence')).toEqual([0, 5, 10, 15]);
  });
  it('trims from the top by lines', () => {
    const text = Array.from({ length: 50 }, (_, i) => `Line number ${i} here.`).join('\n');
    const t = trimText(text, 20, 'trimTop', 'sentence')!;
    expect(countTokens(t.text)).toBeLessThanOrEqual(20);
    expect(t.text.endsWith('Line number 49 here.')).toBe(true);
    expect(t.type).toBe('newline');
  });
  it('falls back to sentence trimming', () => {
    const t = trimText('First sentence here. Second sentence here. Third one.', 9, 'trimBottom', 'sentence')!;
    expect(t.text.startsWith('First')).toBe(true);
    expect(t.type).toBe('sentence');
  });
});

describe('buildContext', () => {
  it('orders memory, lore, story, and author note like NovelAI', () => {
    const s = newStory({
      memory: 'MEMORY',
      authorsNote: 'NOTE',
      doc: [{ text: 'l1\nl2\nl3\nl4\nl5\nl6 Mara', origin: 'prompt' }],
    });
    s.lorebook.entries.push(newLoreEntry({ displayName: 'Mara', text: 'LORE', keys: ['mara'] }));
    const c = buildContext(s, { maxContextTokens: 2000, outputTokens: 100 });
    const lines = c.text.split('\n');
    expect(lines[0]).toBe('MEMORY');
    expect(lines[1]).toBe('LORE');
    expect(lines[2]).toBe('l1');
    // AN goes 4 lines up from the bottom (3 story lines below it).
    expect(lines.indexOf('NOTE')).toBe(lines.length - 4);
    expect(c.report.find((r) => r.id === 'story')!.included).toBe(true);
    expect(c.stages).toHaveLength(4);
  });

  it('trims story to fit the budget while keeping memory', () => {
    const long = Array.from({ length: 400 }, (_, i) => `Sentence ${i} of the story goes here.`).join('\n');
    const s = newStory({ memory: 'Important memory.', doc: [{ text: long, origin: 'ai' }] });
    const c = buildContext(s, { maxContextTokens: 900, outputTokens: 100 });
    expect(c.usedTokens).toBeLessThanOrEqual(800);
    expect(c.text.startsWith('Important memory.')).toBe(true);
    expect(c.text.endsWith('Sentence 399 of the story goes here.')).toBe(true);
    expect(c.report.find((r) => r.id === 'story')!.reason).toBe('trimmed');
  });

  it('parses absolute and relative ephemeral steps and story lines', () => {
    const rel = parseEphemeral('{+2~3,-1:A}', 5)!;
    expect(ephemeralActive(rel, 6)).toBe(false);
    expect(ephemeralActive(rel, 7)).toBe(true);
    expect(ephemeralActive(rel, 10)).toBe(false);
    const abs = parseEphemeral('{8~2,+0:B}', 5)!;
    expect(ephemeralActive(abs, 7)).toBe(false);
    expect(ephemeralActive(abs, 8)).toBe(true);
    expect(ephemeralActive(abs, 10)).toBe(false);
    expect(formatEphemeral(rel)).toBe('{7~3,-1:A}');
    const text = 'One.\n{+1~4,-2:Rain falls}\nTwo.\n{3~1,+0:End}';
    const found = findEphemeralLines(text, 0);
    expect(found.map((f) => f.entry.text)).toEqual(['Rain falls', 'End']);
    let rest = text;
    for (const f of [...found].reverse()) rest = rest.slice(0, f.from) + rest.slice(f.to);
    expect(rest).toBe('One.\nTwo.');
  });

  it('inserts key-relative entries next to their key even when placed before the story', () => {
    const s = newStory({ doc: [{ text: 'Para one.\nThe dragon wakes.\nPara three.\nPara four.', origin: 'prompt' }] });
    const e = newLoreEntry({ displayName: 'Dragon', text: 'DRAGON LORE', keys: ['dragon'], keyRelative: true });
    e.contextConfig = { ...e.contextConfig, budgetPriority: 900, insertionType: 'newline', insertionPosition: 0 };
    s.lorebook.entries.push(e);
    const c = buildContext(s, { maxContextTokens: 2000, outputTokens: 100 });
    expect(c.text).toContain('The dragon wakes.\nDRAGON LORE\nPara three.');
  });

  it('includes active ephemeral entries', () => {
    const s = newStory({ doc: [{ text: 'a\nb\nc', origin: 'prompt' }], step: 4 });
    const e = parseEphemeral('{+3~10,-2:EPH}', 0)!;
    expect(ephemeralActive(e, 2)).toBe(false);
    expect(ephemeralActive(e, 4)).toBe(true);
    s.ephemeral.push(e);
    const c = buildContext(s, { maxContextTokens: 1000, outputTokens: 10 });
    expect(c.text).toContain('EPH');
  });

  it('adds ATTG when tags are set', () => {
    const s = newStory({ title: 'Rain', tags: ['noir'], doc: [{ text: 'x', origin: 'prompt' }] });
    expect(buildContext(s, { maxContextTokens: 1000, outputTokens: 10 }).text.startsWith('[ Title: Rain; Tags: noir ]')).toBe(true);
  });
});

describe('comment lines', () => {
  it('drops ## lines from story, memory and lore text', async () => {
    const { buildContext, newStory, flatten, stripComments } = await import('../src/index.ts');
    expect(stripComments('a\n## note\nb\n  ## x\n')).toBe('a\nb\n');
    const doc = [{ text: 'Line one.\n## hidden note\nLine two.', origin: 'prompt' as const }];
    const s = newStory({ doc, history: flatten(doc), memory: 'M.\n## secret' });
    const ctx = buildContext(s, { maxContextTokens: 2000, outputTokens: 100 });
    expect(ctx.text).not.toContain('hidden note');
    expect(ctx.text).not.toContain('secret');
    expect(ctx.text).toContain('Line two.');
  });
});
