import { describe, expect, it } from 'vitest';
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
  it('adds a space after sentence ends and applies stops', () => {
    expect(postProcess('He left.', 'She stayed.')).toBe(' She stayed.');
    expect(postProcess('He left. ', 'She stayed.')).toBe('She stayed.');
    expect(postProcess('x', 'abc STOP def', { stop: ['STOP'] })).toBe('abc ');
    expect(postProcess('', 'One. Two', { trimToSentence: true })).toBe('One.');
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
