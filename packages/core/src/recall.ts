import { countTokens } from './tokenizer.ts';
import { textHash } from './embeddings.ts';
import { sentences as splitSentences } from './nlp/segment.ts';

/** Vector search results for the story's chunks (by `textHash` of the chunk), best first. */
export interface VectorHits {
  hashes: string[];
  /** Weight of this ranking against the keyword ranking (1 = equal). */
  weight?: number;
}

/** Reciprocal rank fusion constant: how much the top ranks dominate. */
const RRF_K = 60;

/**
 * Passages from earlier in the story (text that no longer fits in the context) that are most relevant to the
 * latest text. Ranked with BM25 (words in alphabetic scripts; Chinese, Japanese and Korean by character pairs)
 * and, when `vectors` are given, fused with the embedding search's ranking by reciprocal rank. Returns
 * passages in story order, within `budget` tokens.
 */
export function recallPassages(earlier: string, query: string, budget: number, vectors?: VectorHits): string[] {
  if (budget <= 0 || earlier.trim().length < 200) return [];
  const chunks = chunkText(earlier);
  if (!chunks.length) return [];
  const docs = chunks.map((c) => termCounts(c));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = docs.reduce((n, d) => n + sum(d), 0) / docs.length || 1;
  const q = [...termCounts(query).keys()];
  const N = docs.length;
  const k1 = 1.2;
  const b = 0.75;
  const scored = docs.map((d, i) => {
    const len = sum(d);
    let score = 0;
    for (const t of q) {
      const f = d.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      // Terms in most chunks (names of the main characters, common words) say little about relevance.
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgLen));
    }
    return { i, score };
  });
  let ranked = scored.filter((x) => x.score > 1.5).sort((a, b) => b.score - a.score);
  if (vectors?.hashes.length) {
    const fused = new Map<number, number>();
    ranked.forEach((x, r) => fused.set(x.i, 1 / (RRF_K + r + 1)));
    const at = new Map(chunks.map((c, i) => [textHash(c), i]));
    const w = vectors.weight ?? 1;
    let r = 0;
    for (const h of vectors.hashes) {
      const i = at.get(h);
      // Hits outside the earlier text (still in the context) don't count, nor take a rank.
      if (i === undefined) continue;
      fused.set(i, (fused.get(i) ?? 0) + w / (RRF_K + ++r));
    }
    ranked = [...fused].map(([i, score]) => ({ i, score })).sort((a, b) => b.score - a.score);
  }
  const picked: { i: number; text: string }[] = [];
  let used = 0;
  for (const { i } of ranked) {
    let text = chunks[i];
    let n = countTokens(text) + 2;
    // Too long for what is left: keep just its sentences that share terms with the latest text, or (a passage
    // found by meaning alone) its first sentences.
    if (used + n > budget) {
      const sentences = splitSentences(text).map((x) => x.trim()).filter(Boolean);
      const matching = sentences.filter((x) => q.some((t) => termCounts(x).has(t)));
      const keep: string[] = [];
      let size = 2;
      for (const x of matching.length ? matching : sentences) {
        const m = countTokens(x) + 1;
        if (used + size + m > budget) break;
        keep.push(x);
        size += m;
      }
      text = keep.join(' ').trim();
      n = countTokens(text) + 2;
      if (!text || used + n > budget) continue;
    }
    picked.push({ i, text });
    used += n;
    if (picked.length >= 6) break;
  }
  return picked.sort((a, b) => a.i - b.i).map((x) => x.text);
}

/** The chunks `recallPassages` searches, with the hashes their vectors are stored under. */
export function recallChunks(text: string): { hash: string; text: string }[] {
  return chunkText(text).map((t) => ({ hash: textHash(t), text: t }));
}

/** Paragraphs, joined up to ~400 characters and split down to ~800, never across a scene break. */
export function chunkText(text: string): string[] {
  const paras = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = '';
  };
  for (const p of paras) {
    if (/^(\*\s*){3,}$|^⁂$|^-{3,}$/.test(p)) {
      flush();
      continue;
    }
    if (p.length > 800) {
      flush();
      for (let i = 0; i < p.length; i += 600) out.push(p.slice(i, i + 600));
      continue;
    }
    if (cur && cur.length + p.length > 600) flush();
    cur = cur ? `${cur}\n${p}` : p;
    if (cur.length >= 400) flush();
  }
  flush();
  return out;
}

const STOP = new Set(
  'the and that with was were his her she him they them their this from had have has not but for you your are all would could there then than into what when which will been out who one said over back about like just only some'.split(' '),
);
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function termCounts(text: string): Map<string, number> {
  const m = new Map<string, number>();
  const add = (t: string) => m.set(t, (m.get(t) ?? 0) + 1);
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (CJK.test(w)) {
      const chars = [...w].filter((c) => CJK.test(c));
      for (let i = 0; i + 1 < chars.length; i++) add(chars[i] + chars[i + 1]);
    } else if (w.length >= 3 && !STOP.has(w)) add(w);
  }
  return m;
}

function sum(m: Map<string, number>): number {
  let n = 0;
  for (const v of m.values()) n += v;
  return n;
}
