/**
 * Sentence punctuation by language: how each kind of sentence ends, the opening marks Spanish puts in front, the
 * space French puts before ? and !, and how to tell whether a piece of text already ends a sentence.
 */
import type { Lang } from './lang.ts';

/** What a sentence does, which decides how it ends. */
export type Mood = 'statement' | 'question' | 'exclamation';

interface Marks {
  statement: string;
  question: string;
  exclamation: string;
  /** Inverted marks put in front (Spanish ¿…? and ¡…!). */
  open?: { question: string; exclamation: string };
  /** Space before the mark (French typography uses a narrow no-break space before ? and !). */
  spaceBefore?: { question?: string; exclamation?: string };
}

const LATIN: Marks = { statement: '.', question: '?', exclamation: '!' };
const FULLWIDTH: Marks = { statement: '。', question: '？', exclamation: '！' };

const MARKS: Partial<Record<Lang, Marks>> = {
  zh: FULLWIDTH,
  ja: FULLWIDTH,
  es: { ...LATIN, open: { question: '¿', exclamation: '¡' } },
  fr: { ...LATIN, spaceBefore: { question: ' ', exclamation: ' ' } },
  ar: { statement: '.', question: '؟', exclamation: '!' },
  fa: { statement: '.', question: '؟', exclamation: '!' },
  el: { statement: '.', question: ';', exclamation: '!' },
  hi: { statement: '।', question: '?', exclamation: '!' },
  hy: { statement: '։', question: '՞', exclamation: '՜' },
  am: { statement: '።', question: '፧', exclamation: '!' },
  my: { statement: '။', question: '။', exclamation: '။' },
  // Thai leaves statements unpunctuated.
  th: { statement: '', question: '?', exclamation: '!' },
};

export function marksFor(lang: Lang): Marks {
  return MARKS[lang] ?? LATIN;
}

/** Closing quotes and brackets that may follow a sentence's final mark. */
export const CLOSERS = `"'”’」』）)]】》›»`;

/** Every sentence-final mark we know of: Unicode's Sentence_Terminal set plus the ellipsis and dashes. */
const TERMINAL = /[\p{Sentence_Terminal}…‥⋯՜՞፧\u037e]$/u;
const TRAILING_CLOSERS = new RegExp(`[${CLOSERS.replace(/[\]\\]/g, '\\$&')}]+$`, 'u');

/** True when `text` already ends a sentence, possibly inside closing quotes ("Run!" / 「走！」). */
export function endsSentence(text: string, lang?: Lang): boolean {
  const t = text.trimEnd().replace(TRAILING_CLOSERS, '');
  // Greek asks with what looks like a semicolon.
  return TERMINAL.test(t) || /(?:—|――|--)$/.test(t) || (lang === 'el' && t.endsWith(';'));
}

/** End `text` the way a sentence of this mood ends in `lang`, unless it already ends one. */
export function terminate(text: string, lang: Lang, mood: Mood): string {
  const t = text.trimEnd();
  if (!t || endsSentence(t, lang)) return t;
  const m = marksFor(lang);
  const mark = m[mood];
  const space = mood === 'statement' ? '' : (m.spaceBefore?.[mood] ?? '');
  const open = mood !== 'statement' && m.open && !t.startsWith(m.open[mood]) ? m.open[mood] : '';
  return `${open}${t}${mark ? space + mark : ''}`;
}
