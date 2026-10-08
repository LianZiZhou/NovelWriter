import { describe, expect, it } from 'vitest';
import { activateLorebook, evalCondition, evalEquation, matchKey } from '../src/lorebook.ts';
import { emptyLorebook, newLoreEntry } from '../src/defaults.ts';

const base = { memoryText: '', authorsNoteText: '', currentStep: 0, model: 'm', mode: 'storyteller' as const };

describe('keys', () => {
  it('matches plain keys case-insensitively', () => {
    expect(matchKey('mara', 'Then MARA left')).toMatchObject({ index: 5 });
    expect(matchKey('zed', 'nothing')).toBeNull();
  });
  it('matches regex keys case-sensitively with flags', () => {
    expect(matchKey('/Ma.a/', 'mara Mara')).toMatchObject({ index: 5 });
    expect(matchKey('/ma.a/i', 'MARA')).not.toBeNull();
  });
  it('requires all parts of & keys', () => {
    expect(matchKey('NovelAI & Anlatan', 'NovelAI by Anlatan')).not.toBeNull();
    expect(matchKey('NovelAI & Anlatan', 'NovelAI only')).toBeNull();
  });
});

describe('activation', () => {
  it('respects search range, forced, disabled and cascading', () => {
    const lb = emptyLorebook();
    const a = newLoreEntry({ displayName: 'A', text: 'A knows Bram.', keys: ['alpha'] });
    const b = newLoreEntry({ displayName: 'B', text: 'Bram is tall.', keys: ['bram'], nonStoryActivatable: true });
    const far = newLoreEntry({ displayName: 'Far', text: 'far', keys: ['ancient'], searchRange: 10 });
    const forced = newLoreEntry({ displayName: 'F', text: 'always', forceActivation: true });
    const off = newLoreEntry({ displayName: 'Off', text: 'x', keys: ['alpha'], enabled: false });
    lb.entries = [a, b, far, forced, off];
    const story = 'An ancient tale begins. Then alpha appears.';
    const res = activateLorebook({ ...base, lorebook: lb, storyText: story });
    const by = Object.fromEntries(res.map((r) => [r.entry.displayName, r]));
    expect(by.A.active).toBe(true);
    expect(by.B.reason).toBe('cascade');
    expect(by.Far.active).toBe(false);
    expect(by.F.reason).toBe('forced');
    expect(by.Off.reason).toBe('disabled');
  });

  it('evaluates advanced conditions', () => {
    const env = { storyText: 'one\ntwo', memoryText: 'mem', authorsNoteText: '', currentStep: 5, model: 'x', mode: 'storyteller' as const, activeIds: new Set<string>(), random: () => 0.5 };
    expect(evalCondition({ type: 'number', variable: 'paragraphCount', op: '=', value: 2 }, env)).toBe(true);
    expect(evalCondition({ type: 'and', conditions: [{ type: 'true' }, { type: 'not', condition: { type: 'random', chance: 10 } }] }, env)).toBe(true);
    expect(evalCondition({ type: 'string', variable: 'memoryText', op: 'startsWith', value: 'me' }, env)).toBe(true);
  });

  it('evaluates equations left to right', () => {
    const env = { storyText: 'a\nb\nc', memoryText: '', authorsNoteText: '', currentStep: 4, model: 'x', mode: 'storyteller' as const, activeIds: new Set<string>(), random: () => 0 };
    expect(evalEquation([{ operator: '+', value: 2 }, { operator: '+', value: 3 }, { operator: '*', value: 4 }], env)).toBe(20);
    expect(evalEquation([{ operator: '+', value: 'currentStep' }, { operator: '%', value: 3 }], env)).toBe(1);
    expect(evalEquation([{ operator: '+', value: 5 }, { operator: '/', value: 0 }], env)).toBe(0);
    expect(evalCondition({ type: 'equation', terms: [{ operator: '+', value: 'paragraphCount' }, { operator: '*', value: 2 }], op: '=', value: 6 }, env)).toBe(true);
  });

  it('searches keyword conditions in memory, author note and active entries, within a range', () => {
    const lb = emptyLorebook();
    const src = newLoreEntry({ displayName: 'Src', text: 'The Silver Order rules.', keys: ['castle'] });
    const byLore = newLoreEntry({ displayName: 'ByLore', text: 'x', keys: [], conditions: [{ type: 'keyword', key: 'silver order', location: 'lore' }] });
    const byMem = newLoreEntry({ displayName: 'ByMem', text: 'x', keys: [], conditions: [{ type: 'keyword', key: 'winter', location: 'memory' }] });
    const ranged = newLoreEntry({ displayName: 'Ranged', text: 'x', keys: [], conditions: [{ type: 'keyword', key: 'castle', range: 5 }] });
    lb.entries = [byLore, src, byMem, ranged];
    const res = activateLorebook({ ...base, memoryText: 'It is winter.', lorebook: lb, storyText: 'A castle stood here long ago.' });
    const by = Object.fromEntries(res.map((r) => [r.entry.displayName, r.active]));
    expect(by).toEqual({ ByLore: true, Src: true, ByMem: true, Ranged: false });
  });

  it('allows search ranges up to 50,000 and 0 disables story keys', () => {
    const lb = emptyLorebook();
    const story = 'dragon ' + 'x'.repeat(30000);
    lb.entries = [newLoreEntry({ displayName: 'Wide', text: 'w', keys: ['dragon'], searchRange: 50000 }), newLoreEntry({ displayName: 'Zero', text: 'z', keys: ['x'], searchRange: 0 })];
    const res = activateLorebook({ ...base, lorebook: lb, storyText: story });
    expect(res.map((r) => r.active)).toEqual([true, false]);
  });

  it('stops conditions that keep flipping each other', () => {
    const lb = emptyLorebook();
    const a = newLoreEntry({ id: 'a', displayName: 'A', text: 'a', keys: [] });
    const b = newLoreEntry({ id: 'b', displayName: 'B', text: 'b', keys: [] });
    a.conditions = [{ type: 'not', condition: { type: 'loreActive', entryId: 'b' } }];
    b.conditions = [{ type: 'not', condition: { type: 'loreActive', entryId: 'a' } }];
    lb.entries = [a, b];
    expect(() => activateLorebook({ ...base, lorebook: lb, storyText: '' })).not.toThrow();
  });
});


describe('foreign lorebooks', () => {
  it('imports SillyTavern, character-book, Agnai and AI Dungeon formats', async () => {
    const { importFile } = await import('../src/formats.ts');
    const st = importFile('w.json', JSON.stringify({ entries: { 0: { uid: 0, key: ['Mara', 'the captain'], keysecondary: ['ship'], selective: true, comment: 'Mara', content: 'Mara is a captain.', constant: false, disable: false, order: 120 }, 1: { uid: 1, key: ['sea'], content: 'Salt.', constant: true, disable: true } } }));
    expect(st.kind).toBe('lorebook');
    if (st.kind !== 'lorebook') return;
    expect(st.lorebook.entries[0]).toMatchObject({ displayName: 'Mara', text: 'Mara is a captain.', keys: ['Mara & ship', 'the captain & ship'], enabled: true });
    expect(st.lorebook.entries[0].contextConfig.budgetPriority).toBe(120);
    expect(st.lorebook.entries[1]).toMatchObject({ forceActivation: true, enabled: false });

    const card = importFile('c.json', JSON.stringify({ spec: 'chara_card_v2', data: { name: 'X', character_book: { entries: [{ keys: ['tower'], content: 'A tall tower.', enabled: true, insertion_order: 10, name: 'Tower' }] } } }));
    expect(card.kind === 'lorebook' && card.lorebook.entries[0]).toMatchObject({ displayName: 'Tower', keys: ['tower'], text: 'A tall tower.' });

    const agnai = importFile('a.json', JSON.stringify({ kind: 'memory', name: 'Book', entries: [{ name: 'Elf', entry: 'Elves are old.', keywords: ['elf', 'elves'], priority: 5, weight: 1, enabled: true }] }));
    expect(agnai.kind === 'lorebook' && agnai.lorebook.entries[0]).toMatchObject({ displayName: 'Elf', keys: ['elf', 'elves'], text: 'Elves are old.' });

    const aid = importFile('wi.json', JSON.stringify([{ keys: 'dragon, wyrm', entry: 'Dragons hoard gold.' }]));
    expect(aid.kind === 'lorebook' && aid.lorebook.entries[0]).toMatchObject({ keys: ['dragon', 'wyrm'], text: 'Dragons hoard gold.' });

    // NovelAI bias groups (a bare array) still import as bias.
    expect(importFile('b.bias', JSON.stringify([{ phrases: [{ sequence: 'x' }], bias: 1 }])).kind).toBe('bias');
  });
});
