import { describe, expect, it } from 'vitest';
import { buildContext, trimText, unitBoundaries } from '../src/context.ts';
import { newLoreEntry, newStory } from '../src/defaults.ts';
import { countTokens } from '../src/tokenizer.ts';
import { parseEphemeral, ephemeralActive } from '../src/ephemeral.ts';

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
