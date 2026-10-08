import { describe, expect, it } from 'vitest';
import { activateLorebook, evalCondition, matchKey } from '../src/lorebook.ts';
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
});
