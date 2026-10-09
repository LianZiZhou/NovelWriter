import { describe, expect, it } from 'vitest';
import { docText } from '../src/doc.ts';
import { adventureInput } from '../src/adventure.ts';
import { applyPlaceholders, findPlaceholders } from '../src/scenario.ts';
import { embedPngLorebook, exportLorebook, exportScenario, exportStoryFile, importFile, readPngLorebook } from '../src/formats.ts';
import { newLoreEntry, newStory } from '../src/defaults.ts';
import { postProcess } from '../src/prompts.ts';

describe('adventure', () => {
  it('converts do/say input', () => {
    expect(adventureInput('charge the dragon', 'do')).toBe('> You charge the dragon.');
    expect(adventureInput('hello there', 'say')).toBe('> You say, "Hello there."');
    expect(adventureInput('who are you?', 'say')).toBe('> You ask, "Who are you?"');
    expect(adventureInput('run!', 'say')).toBe('> You yell, "Run!"');
    expect(adventureInput('n', 'do')).toBe('> You go north.');
    expect(adventureInput('x the door', 'do')).toBe('> You examine the door.');
    expect(adventureInput('!The guard falls asleep.', 'do')).toBe('> The guard falls asleep.');
    expect(adventureInput('"hi', 'do')).toBe('> You say, "Hi."');
    expect(adventureInput('A storm rolls in.', 'story')).toBe('A storm rolls in.');
  });
  it('writes Chinese and Japanese input in the story\'s own language', () => {
    expect(adventureInput('你是谁？', 'say')).toBe('> 你问：“你是谁？”');
    expect(adventureInput('我该去往何处', 'say')).toBe('> 你说：“我该去往何处。”');
    expect(adventureInput('快跑！', 'say')).toBe('> 你喊：“快跑！”');
    expect(adventureInput('我推开门', 'do')).toBe('> 你推开门。');
    expect(adventureInput('“等等', 'do')).toBe('> 你说：“等等。”');
    expect(adventureInput('だれ？', 'say')).toBe('> 「だれ？」');
  });
});

describe('scenario placeholders', () => {
  it('finds and fills', () => {
    const p = findPlaceholders(['Hello ${name[Mara]:Your name}, ${name}!']);
    expect(p).toEqual([{ key: 'name', defaultValue: 'Mara', description: 'Your name' }]);
    const s = newStory({ memory: 'You are ${name[Mara]}.', doc: [{ text: 'Hi ${name}', origin: 'prompt' }] });
    const f = applyPlaceholders(s, { name: 'Ion' });
    expect(f.memory).toBe('You are Ion.');
    expect(f.doc[0].text).toBe('Hi Ion');
  });
});

describe('formats', () => {
  it('round-trips stories, scenarios and lorebooks', () => {
    const s = newStory({ title: 'T', memory: 'M', doc: [{ text: 'abc', origin: 'prompt' }] });
    s.lorebook.entries.push(newLoreEntry({ displayName: 'E', keys: ['k'], text: 'lore' }));
    const r1 = importFile('x.story', exportStoryFile(s));
    expect(r1.kind === 'story' && r1.story.memory).toBe('M');
    expect(r1.kind === 'story' && r1.story.id).not.toBe(s.id);
    const r2 = importFile('x.scenario', exportScenario(s));
    expect(r2.kind === 'story' && r2.story.doc[0].text).toBe('abc');
    const r3 = importFile('x.lorebook', exportLorebook(s.lorebook));
    expect(r3.kind === 'lorebook' && r3.lorebook.entries[0].keys).toEqual(['k']);
    const r4 = importFile('notes.txt', 'plain text');
    expect(r4.kind === 'story' && r4.story.title).toBe('notes');
  });

  it('embeds lorebooks in PNG', () => {
    // 1x1 transparent PNG
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const png = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const s = newStory();
    s.lorebook.entries.push(newLoreEntry({ displayName: 'Ünïcode', keys: ['k'] }));
    const out = embedPngLorebook(png, s.lorebook);
    expect(readPngLorebook(out)!.entries[0].displayName).toBe('Ünïcode');
    const r = importFile('a.png', out);
    expect(r.kind).toBe('lorebook');
  });
});

describe('postProcess', () => {
  it('keeps a story\'s single line breaks between paragraphs', () => {
    expect(postProcess('One.\n', 'Two.\n\nThree.', { singleBreaks: true })).toBe('Two.\nThree.');
    expect(postProcess('One.\n', 'Two.\n\nThree.')).toBe('Two.\n\nThree.');
  });
  it('adds a space after sentence ends and applies stops', () => {
    expect(postProcess('He left.', 'She stayed.')).toBe(' She stayed.');
    expect(postProcess('He left. ', 'She stayed.')).toBe('She stayed.');
    expect(postProcess('x', 'abc STOP def', { stop: ['STOP'] })).toBe('abc ');
    expect(postProcess('', 'One. Two', { trimToSentence: true })).toBe('One.');
    expect(postProcess('> You open the door.\n', ' The hinges creak.')).toBe('The hinges creak.');
  });
  it('removes echoed context', () => {
    expect(postProcess('The rain fell on the town.', 'fell on the town. Then night came.')).toBe(' Then night came.');
  });
});

import { countTokens, loadTokenizer, tokenize, tokenizerReady } from '../src/tokenizer.ts';
describe('tokenizer', () => {
  it('loads o200k and tokenizes multibyte text', async () => {
    await loadTokenizer();
    expect(tokenizerReady()).toBe(true);
    expect(countTokens('Hello world')).toBe(2);
    expect(tokenize('雨が降る').join('')).toBe('雨が降る');
  });
});

describe('presets', () => {
  it('round-trips through the NovelAI preset layout', async () => {
    const { exportPreset, importPreset, defaultParams } = await import('../src/index.ts');
    const p = defaultParams({ temperature: 0.85, maxLength: 1200, topK: 250, minP: 0.05, phraseRepPen: 'medium', unifiedQuad: 0.3, maxContext: 16384 });
    p.order = [...p.order].reverse().map((o, i) => ({ ...o, enabled: i % 2 === 0 }));
    const back = importPreset(JSON.parse(exportPreset('X', p)));
    expect(back.name).toBe('X');
    expect(back.params).toEqual(p);
  });
  it('reads an older NovelAI preset with numeric sampler order', async () => {
    const { importFile } = await import('../src/index.ts');
    const r = importFile('Fresh Coffee.preset', JSON.stringify({ presetVersion: 2, name: 'Fresh Coffee', parameters: { temperature: 1, max_length: 40, top_k: 25, top_p: 1, tail_free_sampling: 0.925, repetition_penalty: 1.9, order: [3, 0, 1] } }));
    expect(r.kind).toBe('preset');
    if (r.kind !== 'preset') return;
    expect(r.preset.params).toMatchObject({ temperature: 1, maxLength: 160, topK: 25, tailFreeSampling: 0.925, repetitionPenalty: 1.9 });
    expect(r.preset.params.order.filter((o) => o.enabled).map((o) => o.id)).toEqual(['tfs', 'temperature', 'top_k']);
  });
});

describe('placeholder definitions and uses', () => {
  it('reads %{} headers, orders them and strips them when filling', async () => {
    const { storyPlaceholders, placeholderUses } = await import('../src/scenario.ts');
    const { newLoreEntry } = await import('../src/defaults.ts');
    const s = newStory({
      doc: [{ text: '%{2city[Veylan]:Home city:Where you grew up}\n%{1name[Mara]:Your name}\n${name} left ${city}.', origin: 'prompt' }],
      systemPrompt: 'Write about ${name}.',
    });
    s.lorebook.entries.push(newLoreEntry({ displayName: '${city}', keys: ['${city}'], text: 'A city.' }));
    const p = storyPlaceholders(s);
    expect(p.map((x) => [x.key, x.defaultValue, x.description])).toEqual([
      ['name', 'Mara', 'Your name'],
      ['city', 'Veylan', 'Home city'],
    ]);
    expect(p[1].longDescription).toBe('Where you grew up');
    expect(placeholderUses(s).get('name')).toEqual(['Story', 'System Prompt']);
    const f = applyPlaceholders(s, { name: 'Ion', city: 'Tarn' });
    expect(f.doc[0].text).toBe('Ion left Tarn.');
    expect(f.systemPrompt).toBe('Write about Ion.');
    expect(f.lorebook.entries[0].keys).toEqual(['Tarn']);
  });
});

describe('foreign stories', () => {
  it('imports NovelAI scenario extras, KoboldAI and AI Dungeon saves, badwords and modules', async () => {
    const scen = importFile('x.scenario', JSON.stringify({
      scenarioVersion: 3,
      title: 'S',
      prompt: 'Once.',
      context: [{ text: 'mem' }, { text: 'an' }],
      phraseBiasGroups: [{ phrases: [{ sequence: 'dragon' }], bias: 0.5, enabled: true }],
      bannedSequenceGroups: [{ sequences: [{ sequence: 'NSFW' }], enabled: true }],
      ephemeralContext: [{ text: 'EPH', startingStep: 1, delay: 2, duration: 3, repeat: false, contextConfig: { insertionPosition: -2 } }],
      settings: { banBrackets: false, parameters: { temperature: 0.7 } },
    }));
    expect(scen.kind).toBe('story');
    if (scen.kind !== 'story') return;
    expect(scen.story.phraseBias[0].phrases).toEqual(['dragon']);
    expect(scen.story.bannedTokens).toEqual(['NSFW']);
    expect(scen.story.ephemeral[0]).toMatchObject({ text: 'EPH', startingStep: 1, delay: 2, duration: 3, position: -2 });
    expect(scen.story.banBrackets).toBe(false);

    const kobold = importFile('save.json', JSON.stringify({ gamestarted: true, prompt: 'The gate.', memory: 'M', authorsnote: 'A', actions: [' It opened.', ' Wind.'], worldinfo: [{ key: 'gate, door', content: 'An iron gate.', comment: 'Gate' }] }));
    expect(kobold.kind === 'story' && docText(kobold.story.doc)).toBe('The gate. It opened. Wind.');
    expect(kobold.kind === 'story' && kobold.story.lorebook.entries[0]).toMatchObject({ displayName: 'Gate', keys: ['gate', 'door'] });

    const aid = importFile('adv.json', JSON.stringify({ title: 'Cave', prompt: 'You enter a cave.', memory: '', authorsNote: '', actions: [{ type: 'do', text: '\n> You light a torch.\n' }, { type: 'continue', text: 'Shadows flee.' }], storyCards: [{ keys: 'cave', value: 'Dark.', title: 'Cave' }] }));
    expect(aid.kind === 'story' && aid.story.mode).toBe('adventure');
    expect(aid.kind === 'story' && aid.story.doc.map((d) => d.origin)).toContain('ai');

    expect(importFile('x.badwords', JSON.stringify({ sequences: [{ sequence: 'foo' }, 'bar'] }))).toEqual({ kind: 'banned', phrases: ['foo', 'bar'] });
    const mod = importFile('noir.module', JSON.stringify({ name: 'Noir', description: 'Hardboiled prose.', data: 'AAAA', prefix: 'x' }));
    expect(mod).toEqual({ kind: 'module', name: 'Noir', note: '[ Style: Noir — Hardboiled prose. ]' });
    expect(importFile('h.bias', JSON.stringify([{ phrase: 'moon', bias: 2 }]))).toMatchObject({ kind: 'bias', groups: [{ phrases: ['moon'], bias: 2 }] });
  });


});
