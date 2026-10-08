/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyChange, docText, normalize, slice } from '../src/doc.ts';
import { commit, createHistory, materialize, pathTo } from '../src/history.ts';
import { newLoreEntry, newStory } from '../src/defaults.ts';
import { exportNovelAIStory, importFile } from '../src/formats.ts';
import { pack, unpack, Ext } from '../src/msgpackr.ts';
import type { Change, History, Span, Story } from '../src/types.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/novelai/${name}`, import.meta.url), 'utf8');

function loadStory(text: string, name = 'x.story'): Story {
  const r = importFile(name, text);
  if (r.kind !== 'story') throw new Error(`not a story: ${r.kind}`);
  return r.story;
}

describe('NovelAI documents from the real client', () => {
  it('reads a story exported by NovelAI', () => {
    const s = loadStory(fixture('storyteller.story'));
    expect(docText(s.doc)).toBe('Edited: The rain had not stopped for three days.\nMara counted the lanterns on the bridge. Seven were lit.\nA third paragraph about the river. Branch B.');
    expect(new Set(s.doc.map((sp) => sp.origin))).toEqual(new Set(['prompt']));
    expect(s.memory).toBe('MEMORY: Mara is a lantern keeper.');
    // The history replays to the same document.
    expect(docText(materialize(s.history))).toBe(docText(s.doc));
    expect(s.step).toBe(1);
  });

  it('re-encodes NovelAI documents byte for byte', () => {
    for (const f of ['storyteller.story', 'adventure.story']) {
      const doc = JSON.parse(fixture(f)).content.document as string;
      const bytes = Uint8Array.from(atob(doc), (c) => c.charCodeAt(0));
      expect(Buffer.from(pack(unpack(bytes))).equals(Buffer.from(bytes)), f).toBe(true);
    }
  });

  it('reads a text adventure story', () => {
    const s = loadStory(fixture('adventure.story'));
    expect(s.mode).toBe('adventure');
    expect(docText(s.doc)).toContain('You stand at the cave mouth.');
  });
});

/** Apply a text edit to the story as a new history node. */
function edit(s: Story, type: 'prompt' | 'ai' | 'user' | 'edit', from: number, to: number, inserted: Span[]) {
  const change: Change = { pos: from, removed: slice(s.doc, from, to), inserted };
  s.doc = normalize(applyChange(s.doc, change));
  s.history = commit(s.history, type, [change]).history;
}

function richStory(): Story {
  const s = newStory({ title: 'Round Trip', mode: 'adventure', history: createHistory(), doc: [] });
  edit(s, 'prompt', 0, 0, [{ text: 'The gate was shut.\n{ Describe the storm }', origin: 'prompt' }]);
  const end = () => docText(s.doc).length;
  edit(s, 'ai', end(), end(), [{ text: '\nThunder rolled ', origin: 'ai' }, { text: 'twice', origin: 'ai', marks: ['bold'] }, { text: '.', origin: 'ai' }]);
  const branchPoint = s.history.current;
  edit(s, 'user', end(), end(), [{ text: '\n> You open the gate.', origin: 'user' }]);
  edit(s, 'ai', end(), end(), [{ text: '\nIt creaks.', origin: 'ai' }]);
  // Edit in the middle of the first paragraph (update), then delete the instruction paragraph (remove).
  edit(s, 'edit', 4, 8, [{ text: 'iron gate', origin: 'edit', marks: ['italic'] }]);
  const t = docText(s.doc);
  const a = t.indexOf('\n{ Describe');
  edit(s, 'edit', a, a + '\n{ Describe the storm }'.length, []);
  edit(s, 'user', end(), end(), [{ text: '\n> You say "Hello?"', origin: 'user' }]);
  // A retry branch from the earlier AI node.
  const main = s.history.current;
  const h: History = { ...s.history, current: branchPoint };
  const branchDoc = materialize(s.history, branchPoint);
  const alt = { ...s, history: h, doc: branchDoc };
  edit(alt, 'ai', docText(alt.doc).length, docText(alt.doc).length, [{ text: '\nA different ending.', origin: 'ai' }]);
  s.history = { ...alt.history, current: main };
  s.doc = materialize(s.history, main);
  s.memory = 'Memory text';
  s.authorsNote = '[ Style: tense ]';
  s.systemPrompt = 'Be vivid.';
  s.prefill = 'Prefill';
  s.genre = 'Fantasy, Mystery';
  s.phraseBias = [{ phrases: ['storm', '{raw}'], bias: 0.5, ensureSequenceFinish: false, generateOnce: true, enabled: true, whenInactive: false }];
  s.bannedTokens = ['NSFW'];
  s.ephemeral = [{ id: 'e', text: 'EPH', startingStep: 1, delay: 2, duration: 3, repeat: false, position: -2 }];
  const e = newLoreEntry({ displayName: 'Gate', text: 'An iron gate.', keys: ['gate'], hidden: true });
  e.conditions = [
    { type: 'keyword', key: 'storm', location: 'memory', range: 200 },
    { type: 'equation', terms: [{ operator: '+', value: 'currentStep' }, { operator: '%', value: 2 }], op: '=', value: 0 },
    { type: 'not', condition: { type: 'storyMode', mode: 'adventure' } },
    { type: 'string', variable: 'memoryText', op: 'startsWith', value: 'Mem' },
  ];
  s.lorebook.entries.push(e);
  s.chats = [{ id: 'c1', title: 'Chat', createdAt: 1700000000000, messages: [{ role: 'user', content: 'Hi', excerpt: { label: 'Recent Story', text: 'gate' } }, { role: 'assistant', content: 'Hello' }] }];
  return s;
}

/** Every node's document, in a canonical DFS order of the tree (children by insertion order). */
function treeTexts(h: History): string[] {
  const out: string[] = [];
  const walk = (id: string, depth: number) => {
    out.push(`${depth}:${docText(materialize(h, id))}`);
    for (const c of h.nodes[id].children) walk(c, depth + 1);
  };
  walk('root', 0);
  return out;
}

describe('NovelAI .story round trip', () => {
  it('keeps text, origins, formatting, sections and the whole history tree', () => {
    const s = richStory();
    const json = exportNovelAIStory(s);
    const back = loadStory(json);
    expect(docText(back.doc)).toBe(docText(s.doc));
    // Origins and marks per character survive.
    const charInfo = (doc: Span[]) => doc.flatMap((sp) => [...sp.text].map(() => `${sp.origin}:${(sp.marks ?? []).sort().join('+')}`));
    expect(charInfo(back.doc).filter((_, i) => docText(back.doc)[i] !== '\n')).toEqual(charInfo(s.doc).filter((_, i) => docText(s.doc)[i] !== '\n'));
    // Same tree of documents (our extra root-level prompt node aside, depth is the same).
    expect(treeTexts(back.history)).toEqual(treeTexts(s.history));
    expect(pathTo(back.history, back.history.current).length).toBe(pathTo(s.history, s.history.current).length);
    expect(back.mode).toBe('adventure');
    expect(back.memory).toBe('Memory text');
    expect(back.authorsNote).toBe('[ Style: tense ]');
    expect(back.systemPrompt).toBe('Be vivid.');
    expect(back.prefill).toBe('Prefill');
    expect(back.genre).toBe('Fantasy, Mystery');
    expect(back.phraseBias[0].phrases).toEqual(['storm', '{raw}']);
    expect(back.bannedTokens).toEqual(['NSFW']);
    expect(back.ephemeral[0]).toMatchObject({ text: 'EPH', startingStep: 1, delay: 2, duration: 3, position: -2 });
    const entry = back.lorebook.entries[0];
    expect(entry).toMatchObject({ displayName: 'Gate', keys: ['gate'], hidden: true });
    expect(entry.conditions).toEqual(s.lorebook.entries[0].conditions);
    expect(back.chats[0].messages.map((m) => [m.role, m.content, m.excerpt?.text])).toEqual([
      ['user', '', 'gate'],
      ['user', 'Hi', undefined],
      ['assistant', 'Hello', undefined],
    ]);
  });

  it('writes NovelAI sections: actions without "> ", instruction source, origin and format codes', () => {
    const s = richStory();
    const json = JSON.parse(exportNovelAIStory(s));
    const doc = unpack(Uint8Array.from(atob(json.content.document), (c) => c.charCodeAt(0))) as Ext;
    expect(doc.type).toBe(20);
    const d = doc.value as { sections: Map<number, { text: string; source?: number; meta: Map<number, { data: number }[]> }>; order: number[]; step: number };
    const secs = d.order.map((id) => d.sections.get(id)!);
    expect(secs.map((x) => x.text)).toEqual(['The iron gate was shut.', 'Thunder rolled twice.', 'You open the gate.', 'It creaks.', 'You say "Hello?"']);
    expect(secs.map((x) => x.source ?? 0)).toEqual([0, 0, 1, 0, 2]);
    expect(secs[1].meta.get(1)!.map((r) => r.data)).toEqual([2]);
    expect(secs[1].meta.get(2)!.map((r) => r.data)).toEqual([1]);
    expect(secs[0].meta.get(2)!.map((r) => r.data)).toEqual([2]);
    expect(d.step).toBe(pathTo(s.history, s.history.current).length - 1);
    expect(json.content.storyContentVersion).toBe(7);
    expect(json.content.lorebook.lorebookVersion).toBe(6);
  });

  it('applies and undoes its own section diffs (random edits)', () => {
    let seed = 3;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    const words = ['rain', 'lantern', 'bridge', ' ', '. ', 'Mara', 'storm'];
    for (let round = 0; round < 200; round++) {
      const s = newStory({ history: createHistory(), doc: [] });
      edit(s, 'prompt', 0, 0, [{ text: 'Start of the story.\nSecond line.', origin: 'prompt' }]);
      for (let i = 0; i < 6; i++) {
        const len = docText(s.doc).length;
        const a = rnd(len + 1);
        const b = Math.min(len, a + rnd(6));
        const text = Array.from({ length: 1 + rnd(4) }, () => words[rnd(words.length)]).join('') + (rnd(4) === 0 ? '\n' : '');
        const origin = (['ai', 'user', 'edit'] as const)[rnd(3)];
        edit(s, origin, a, b, rnd(3) === 0 ? [] : [{ text, origin, ...(rnd(3) === 0 ? { marks: ['bold' as const] } : {}) }]);
      }
      const back = loadStory(exportNovelAIStory(s));
      expect(treeTexts(back.history), `round ${round}`).toEqual(treeTexts(s.history));
    }
  });
});
