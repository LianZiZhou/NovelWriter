import { docText } from './doc.ts';
import { historyStats, pathTo, structureStats, type StructureStats } from './history.ts';
import type { Story } from './types.ts';
import { sentences as splitSentences, words as splitWords } from './nlp/segment.ts';

const STOPWORDS = new Set(
  'the a an and or but of to in on at for with as is was were be been it its he she they them his her their you your i me my we our that this there then than from by not no so if into out up down over'.split(' '),
);

export interface StoryStats {
  steps: number;
  historyNodes: number;
  deadEnds: number;
  aiGenerations: number;
  characters: number;
  charactersByOrigin: Record<string, number>;
  words: number;
  paragraphs: number;
  sentences: number;
  mostUsedWords: [string, number][];
  sections: number;
  lorebookEntries: number;
  ephemeralEntries: number;
  /** History blocks (one per undoable change) in the whole tree, on the current path, and off it. */
  dataBlocks: number;
  dataBlocksOnPath: number;
  dataBlocksAbandoned: number;
  /** Characters removed by edits along the current path. */
  deletedCharacters: number;
  structure: StructureStats;
}

export function storyStats(story: Story): StoryStats {
  const text = docText(story.doc);
  const h = historyStats(story.history);
  const nodes = Object.values(story.history.nodes);
  const onPath = new Set(pathTo(story.history, story.history.current));
  let dataBlocks = 0;
  let dataBlocksOnPath = 0;
  let deletedCharacters = 0;
  for (const n of nodes) {
    dataBlocks += n.changes.length;
    if (!onPath.has(n.id)) continue;
    dataBlocksOnPath += n.changes.length;
    for (const c of n.changes) deletedCharacters += c.removed.reduce((k, sp) => k + sp.text.length, 0);
  }
  const byOrigin: Record<string, number> = { prompt: 0, ai: 0, edit: 0, user: 0 };
  for (const s of story.doc) byOrigin[s.origin] = (byOrigin[s.origin] ?? 0) + s.text.length;
  // Dictionary-based word breaks, so Chinese and Japanese count words rather than whole runs of characters.
  const words = splitWords(text);
  const freq = new Map<string, number>();
  for (const w of words) {
    const k = w.toLowerCase();
    if (k.length < (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(k) ? 2 : 3) || STOPWORDS.has(k)) continue;
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  return {
    steps: story.step,
    historyNodes: h.nodes,
    deadEnds: h.deadEnds,
    aiGenerations: h.aiNodes,
    characters: text.length,
    charactersByOrigin: byOrigin,
    words: words.length,
    paragraphs: text.split('\n').filter((p) => p.trim()).length,
    sentences: splitSentences(text).filter((x) => /[\p{L}\p{N}]/u.test(x)).length,
    mostUsedWords: [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
    sections: text ? text.split('\n').length : 0,
    lorebookEntries: story.lorebook.entries.length,
    ephemeralEntries: story.ephemeral.length,
    dataBlocks,
    dataBlocksOnPath,
    dataBlocksAbandoned: dataBlocks - dataBlocksOnPath,
    deletedCharacters,
    structure: structureStats(story.history),
  };
}
