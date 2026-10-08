import { docText } from './doc.ts';
import { historyStats } from './history.ts';
import type { Story } from './types.ts';

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
}

export function storyStats(story: Story): StoryStats {
  const text = docText(story.doc);
  const h = historyStats(story.history);
  const byOrigin: Record<string, number> = { prompt: 0, ai: 0, edit: 0, user: 0 };
  for (const s of story.doc) byOrigin[s.origin] = (byOrigin[s.origin] ?? 0) + s.text.length;
  const words = text.match(/[\p{L}\p{N}'’]+/gu) ?? [];
  const freq = new Map<string, number>();
  for (const w of words) {
    const k = w.toLowerCase();
    if (k.length < 3 || STOPWORDS.has(k)) continue;
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
    sentences: (text.match(/[.!?…。！？]+(\s|$)/g) ?? []).length,
    mostUsedWords: [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
  };
}
