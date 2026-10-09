import { describe, expect, it } from 'vitest';
import { newStory } from '../src/defaults.ts';
import { loadTokenizer } from '../src/tokenizer.ts';
import { charsPerToken, outputTokens } from '../src/prompts.ts';

const ZH = '夜色渐深，城墙上的火把在风中摇曳。林舟握紧了手中的长剑，目光穿过雨幕望向远处的山谷。他知道，今晚之后，一切都将不同。';
const EN = 'The night grew deeper, and the torches on the city wall flickered in the wind. Lin Zhou gripped his sword and looked into the rain.';

describe('output length', () => {
  it('measures characters per token on the story text, before and after the tokenizer loads', async () => {
    expect(charsPerToken(ZH)).toBeLessThan(1.6);
    expect(charsPerToken(EN)).toBeGreaterThan(3);
    await loadTokenizer();
    expect(charsPerToken(ZH)).toBeLessThan(1.6);
    expect(charsPerToken(EN)).toBeGreaterThan(3);
  });
  it('gives Chinese stories enough tokens for the requested characters', async () => {
    await loadTokenizer();
    const s = newStory();
    s.params.maxLength = 1024;
    expect(outputTokens(s.params, ZH.repeat(5))).toBeGreaterThan(640);
    expect(outputTokens(s.params, EN.repeat(5))).toBeLessThan(340);
    expect(outputTokens(s.params)).toBe(256);
  });
});
