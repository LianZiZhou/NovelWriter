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

import { buildStoryRequest, continuationTail, postProcess, storyInfoText } from '../src/prompts.ts';
import { newLoreEntry } from '../src/defaults.ts';
import { flatten } from '../src/history.ts';
import { expandMacros, type MacroEnv } from '../src/macros.ts';
import { activateLorebook, nextLoreState } from '../src/lorebook.ts';
import { chunkText, recallPassages } from '../src/recall.ts';
import { detectTemplate, INSTRUCT_TEMPLATES, renderInstruct, stripThinking } from '../src/instruct.ts';
import { samplerPayload } from '../src/backend.ts';
import { defaultParams } from '../src/defaults.ts';
import type { Story } from '../src/types.ts';

function story(text: string, p: Partial<Story> = {}): Story {
  const doc = [{ text, origin: 'prompt' as const }];
  return newStory({ doc, history: flatten(doc), ...p });
}

describe('structured layout', () => {
  it('puts background in the system prompt and the Author\'s Note after the story', () => {
    const s = story('The rain fell on the town.\nMara opened the door and', {
      memory: 'Mara is a detective.',
      authorsNote: '[ Tone: bleak ]',
      tags: ['noir'],
      styleTag: 5,
    });
    s.lorebook.entries.push(newLoreEntry({ displayName: 'Door', text: 'The door is old.', keys: ['door'] }));
    const r = buildStoryRequest(s, { maxContextTokens: 4000, layout: 'structured', random: () => 0.5 });
    expect(r.system).toContain('<memory>\nMara is a detective.\n</memory>');
    expect(r.system).toContain('<lore name="Door">\nThe door is old.\n</lore>');
    expect(r.system).toContain('Prose quality: exceptional');
    expect(r.system).not.toContain('[ S:');
    const user = r.messages[0].content;
    expect(user.startsWith('<story>\nThe rain fell')).toBe(true);
    expect(user).not.toContain('Mara is a detective');
    expect(user.indexOf('Tone: bleak')).toBeGreaterThan(user.indexOf('</story>'));
    expect(r.messages).toHaveLength(1);
    expect(r.raw).toContain('Mara is a detective.');
  });
  it('opens the reply with the story tail when the model takes a prefill, with a fallback', () => {
    const s = story('First paragraph.\nMara opened the door and');
    const r = buildStoryRequest(s, { maxContextTokens: 4000, layout: 'structured', prefill: true });
    expect(r.messages.at(-1)).toEqual({ role: 'assistant', content: 'Mara opened the door and' });
    expect(r.messages[0].content).not.toContain('Mara opened');
    expect(r.fallbackMessages?.[0].content).toContain('Mara opened the door and');
    // A story ending at a line break has nothing to continue word for word.
    expect(buildStoryRequest(story('Done.\n'), { maxContextTokens: 4000, layout: 'structured', prefill: true }).messages).toHaveLength(1);
  });
  it('keeps the classic single message', () => {
    const r = buildStoryRequest(story('Hello there.', { memory: 'M.' }), { maxContextTokens: 4000 });
    expect(r.messages).toEqual([{ role: 'user', content: 'M.\nHello there.' }]);
  });
  it('cuts long tails at a sentence', () => {
    const t = continuationTail('x'.repeat(10) + '\n' + 'A sentence here. '.repeat(30) + 'And then she');
    expect(t.length).toBeLessThanOrEqual(300);
    expect(t.startsWith('A sentence')).toBe(true);
    expect(t.endsWith('And then she')).toBe(true);
  });
  it('describes the story in plain words', () => {
    expect(storyInfoText(newStory({ title: 'Rain', genre: 'Noir', styleTag: 2 }))).toBe('Title: Rain\nGenre: Noir\nProse quality: plain, readable prose');
  });
});

describe('macros', () => {
  const env = (): MacroEnv => ({ title: 'Rain', author: '', genre: '', tags: ['a', 'b'], step: 3, seed: 's', vars: { mood: 'grim' }, random: () => 0 });
  it('expands story fields, randoms, dice and variables', () => {
    const e = env();
    expect(expandMacros('{{title}} {{tags}} {{step}} {{random::x::y}} {{roll:2d6}}', e)).toBe('Rain a, b 3 x 2');
    expect(expandMacros('{{setvar::hp::10}}{{addvar::hp::5}}{{getvar::hp}} {{getvar::mood}}', e)).toBe('15 grim');
    expect(e.vars.hp).toBe('15');
    expect(expandMacros('a {{// hidden}}b\n{{trim}}\nc {{unknown}}', e)).toBe('a bc {{unknown}}');
    expect(expandMacros('{{random::{{getvar::mood}}::z}}', e)).toBe('grim');
  });
  it('keeps picks stable', () => {
    const a = expandMacros('{{pick::1::2::3::4::5}}', { ...env(), random: Math.random });
    for (let i = 0; i < 5; i++) expect(expandMacros('{{pick::1::2::3::4::5}}', { ...env(), random: Math.random })).toBe(a);
  });
  it('expands in memory but never in the story', () => {
    const r = buildStoryRequest(story('Say {{title}}.', { title: 'Rain', memory: 'Title is {{title}}.' }), { maxContextTokens: 4000 });
    expect(r.messages[0].content).toBe('Title is Rain.\nSay {{title}}.');
  });
});

describe('lorebook timing and groups', () => {
  const base = { storyText: 'The dragon sleeps.', memoryText: '', authorsNoteText: '', model: '', mode: 'storyteller' as const };
  it('keeps sticky entries on and blocks them during cooldown', () => {
    const e = newLoreEntry({ id: 'd', text: 'Dragon lore', keys: ['dragon'], sticky: 2, cooldown: 1 });
    const lorebook = { ...newStory().lorebook, entries: [e] };
    const a0 = activateLorebook({ ...base, lorebook, currentStep: 0 });
    expect(a0[0].reason).toBe('key');
    const st = nextLoreState(undefined, a0, 0);
    expect(st.d).toEqual({ stickyUntil: 2, cooldownUntil: 3 });
    expect(activateLorebook({ ...base, storyText: 'nothing', lorebook, currentStep: 2, state: st })[0].reason).toBe('sticky');
    expect(activateLorebook({ ...base, lorebook, currentStep: 3, state: st })[0].reason).toBe('cooldown');
    expect(activateLorebook({ ...base, lorebook, currentStep: 4, state: st })[0].reason).toBe('key');
  });
  it('applies delay and probability', () => {
    const lorebook = { ...newStory().lorebook, entries: [newLoreEntry({ text: 'x', keys: ['dragon'], delay: 5 }), newLoreEntry({ text: 'y', keys: ['dragon'], probability: 30 })] };
    const a = activateLorebook({ ...base, lorebook, currentStep: 1, random: () => 0.5 });
    expect(a.map((x) => x.reason)).toEqual(['delayed', 'probability']);
    expect(activateLorebook({ ...base, lorebook, currentStep: 5, random: () => 0.1 }).map((x) => x.active)).toEqual([true, true]);
  });
  it('keeps one entry per inclusion group', () => {
    const lorebook = {
      ...newStory().lorebook,
      entries: [
        newLoreEntry({ id: 'a', text: 'a', keys: ['dragon'], group: 'weather' }),
        newLoreEntry({ id: 'b', text: 'b', keys: ['sleeps'], group: 'weather', groupPrioritize: true, contextConfig: { ...newLoreEntry().contextConfig, budgetPriority: 900 } }),
      ],
    };
    expect(activateLorebook({ ...base, lorebook, currentStep: 0 }).map((x) => x.reason)).toEqual(['group', 'key']);
  });
  it('matches whole words and case when asked, and stops recursion', () => {
    const lorebook = {
      ...newStory().lorebook,
      entries: [
        newLoreEntry({ id: 'a', text: 'Mentions Castle.', keys: ['dragon'], preventRecursion: true }),
        newLoreEntry({ id: 'b', text: 'b', keys: ['Castle'], searchRange: 0, nonStoryActivatable: true }),
        newLoreEntry({ id: 'c', text: 'c', keys: ['drag'], wholeWords: true }),
        newLoreEntry({ id: 'd', text: 'd', keys: ['the'], caseSensitive: true }),
      ],
    };
    expect(activateLorebook({ ...base, lorebook, currentStep: 0 }).map((x) => x.active)).toEqual([true, false, false, false]);
  });
});

describe('long stories', () => {
  it('finds earlier passages relevant to the latest text, in Chinese too', () => {
    const filler = Array.from({ length: 30 }, (_, i) => `第${i}天，村子里一切如常，人们照旧耕田、做饭、聊天。`).join('\n');
    const earlier = `${filler}\n老铁匠把那把刻着龙纹的青铜钥匙埋在了古井旁边的槐树下。\n${filler}`;
    const got = recallPassages(earlier, '她想起了那把青铜钥匙，也许就埋在古井附近。', 200);
    expect(got.join('')).toContain('青铜钥匙');
    expect(recallPassages(earlier, '完全无关的内容', 200).join('')).not.toContain('青铜钥匙');
  });
  it('chunks by paragraphs and scene breaks', () => {
    expect(chunkText('a\nb\n***\nc')).toEqual(['a\nb', 'c']);
  });
  it('adds the summary and recalled passages only when the story no longer fits', () => {
    const long = Array.from({ length: 200 }, (_, i) => `Paragraph ${i} about ordinary things in the valley.`).join('\n');
    const text = 'The silver compass was hidden under the bell tower.\n' + long + '\nShe needed the silver compass now.';
    const s = story(text, { summary: { enabled: true, text: 'Mara arrived in the valley.', upTo: 100 }, recall: { enabled: true, tokenBudget: 200 } });
    const r = buildStoryRequest(s, { maxContextTokens: 1500, layout: 'structured' });
    expect(r.context.storyStart).toBeGreaterThan(0);
    expect(r.system).toContain('<summary>\nMara arrived in the valley.\n</summary>');
    expect(r.system).toContain('silver compass was hidden');
    const small = buildStoryRequest(story('Short.', { summary: { enabled: true, text: 'S', upTo: 0 } }), { maxContextTokens: 800 });
    expect(small.context.storyStart).toBe(0);
    expect(small.messages[0].content).not.toContain('Earlier in the story');
  });
});

describe('text completion', () => {
  it('detects templates and renders an open reply', () => {
    expect(detectTemplate('x', '{% ... <|im_start|> %}')).toBe('chatml');
    expect(detectTemplate('Meta-Llama-3.1-8B-Instruct')).toBe('llama3');
    expect(detectTemplate('gemma-3-27b')).toBe('gemma');
    const p = renderInstruct(INSTRUCT_TEMPLATES.chatml, 'Sys', [{ role: 'user', content: 'U' }, { role: 'assistant', content: 'Tail' }]);
    expect(p).toBe('<|im_start|>system\nSys<|im_end|>\n<|im_start|>user\nU<|im_end|>\n<|im_start|>assistant\nTail');
    expect(renderInstruct(INSTRUCT_TEMPLATES.gemma, 'Sys', [{ role: 'user', content: 'U' }])).toBe('<start_of_turn>user\nSys\n\nU<end_of_turn>\n<start_of_turn>model\n');
    expect(renderInstruct(INSTRUCT_TEMPLATES.chatml, '', [{ role: 'user', content: 'U' }], { modelId: 'Qwen3-32B' }).endsWith('<|im_start|>assistant\n<think>\n\n</think>\n\n')).toBe(true);
  });
  it('strips thinking from the output', () => {
    expect(stripThinking('<think>plan</think>\nThe story.')).toBe('The story.');
    expect(stripThinking('<think>still going')).toBe('');
    expect(stripThinking('hidden plan</think>Text')).toBe('Text');
    expect(postProcess('Hi.', '<think>x</think> There.')).toBe(' There.');
  });
});

describe('samplers', () => {
  it('sends XTC and banned strings where supported', () => {
    const p = defaultParams({ xtcProbability: 0.5, xtcThreshold: 0.12 });
    expect(samplerPayload(p, 'tabbyapi', { banned: ['{shivers}', '[12]'] }).body).toMatchObject({ xtc_probability: 0.5, xtc_threshold: 0.12, banned_strings: ['shivers'] });
    expect(samplerPayload(p, 'koboldcpp', { banned: ['x'] }).body).toMatchObject({ banned_tokens: ['x'] });
    expect(samplerPayload(p, 'openai', { banned: ['x'] }).body).not.toHaveProperty('xtc_probability');
  });
});
