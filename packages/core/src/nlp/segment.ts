/**
 * Sentence and word segmentation for every script. A full stop ends a sentence at once in Chinese and Japanese
 * (no space follows it), after closing quotes (`"Run!" she said` / `「走！」`), and in alphabetic scripts only
 * before whitespace and not after an abbreviation or an initial.
 */
import { CLOSERS } from './punctuation.ts';

const ESC = CLOSERS.replace(/[\]\\]/g, '\\$&');
/** A run of sentence-final marks and the closing quotes after it. */
const END_RUN = new RegExp(`[\\p{Sentence_Terminal}…‥⋯\\u037e]+[${ESC}]*`, 'gu');
const WIDE_END = /[。．！？｡‼⁇⁈⁉]/u;
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'prof', 'sr', 'jr', 'vs', 'etc', 'e.g', 'i.e', 'mt', 'no', 'vol', 'fig', 'gen', 'capt', 'lt', 'col', 'sgt', 'rev', 'hon']);

/**
 * Offsets just past the end of each sentence in `text` (line breaks end sentences too), ascending. The text
 * after the last offset, if any, is an unfinished sentence.
 */
export function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  const add = (i: number) => {
    if (i > 0 && ends[ends.length - 1] !== i) ends.push(i);
  };
  let nl = text.indexOf('\n');
  for (const m of text.matchAll(END_RUN)) {
    const start = m.index ?? 0;
    let end = start + m[0].length;
    while (nl >= 0 && nl < start) {
      add(nl + 1);
      nl = text.indexOf('\n', nl + 1);
    }
    const next = text[end];
    const wide = WIDE_END.test(m[0]) || /[…‥⋯]/.test(m[0][0]) && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text[start - 1] ?? '');
    if (next === undefined) {
      add(end);
      continue;
    }
    if (!wide) {
      // Alphabetic: only before whitespace, and not "Mr. Smith", "J. R. R." or "3.14".
      if (!/\s/.test(next)) continue;
      if (m[0][0] === '.') {
        const word = /([\p{L}.]+)$/u.exec(text.slice(Math.max(0, start - 12), start))?.[1].toLowerCase() ?? '';
        if (ABBREVIATIONS.has(word) || /^\p{Lu}$/u.test(text.slice(start - 1, start)) && !/\p{L}/u.test(text[start - 2] ?? ' ')) continue;
      }
      // Whitespace after the mark belongs to the sentence it ends.
      while (end < text.length && /[ \t]/.test(text[end])) end++;
    }
    add(end);
  }
  while (nl >= 0) {
    add(nl + 1);
    nl = text.indexOf('\n', nl + 1);
  }
  return ends.filter((e) => e <= text.length).sort((a, b) => a - b).filter((e, i, a) => i === 0 || e !== a[i - 1]);
}

/** The sentences of `text`, with their trailing whitespace. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (const end of sentenceEnds(text)) {
    out.push(text.slice(from, end));
    from = end;
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
}

let wordSegmenter: Intl.Segmenter | null | undefined;

/**
 * The words of `text`. Uses the platform's dictionary-based segmenter (it splits Chinese and Japanese into words,
 * Thai too), and falls back to letter runs where there is none.
 */
export function words(text: string): string[] {
  if (wordSegmenter === undefined) {
    try {
      wordSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
    } catch {
      wordSegmenter = null;
    }
  }
  if (!wordSegmenter) return text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const out: string[] = [];
  for (const s of wordSegmenter.segment(text)) if (s.isWordLike) out.push(s.segment);
  return out;
}
