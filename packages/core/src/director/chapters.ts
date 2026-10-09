import type { Outline } from './types.ts';

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Whether the story is written in Chinese/Japanese/Korean (chapter headings follow its convention). */
export function looksCjk(text: string): boolean {
  const sample = text.slice(-2000);
  const cjk = (sample.match(new RegExp(CJK.source, 'gu')) ?? []).length;
  return cjk > 0 && cjk * 3 >= sample.replace(/\s/g, '').length;
}

const CN_DIGITS = '零一二三四五六七八九';

/** 1 → 一, 12 → 十二, 105 → 一百零五 (chapter numbers). */
export function chineseNumber(n: number): string {
  if (n <= 0 || !Number.isInteger(n) || n >= 10000) return String(n);
  const units = ['', '十', '百', '千'];
  const digits = String(n).split('').map(Number);
  let out = '';
  let zero = false;
  digits.forEach((d, i) => {
    const unit = units[digits.length - 1 - i];
    if (d === 0) {
      zero = out.length > 0;
      return;
    }
    if (zero) out += '零';
    zero = false;
    out += (d === 1 && unit === '十' && out === '' ? '' : CN_DIGITS[d]) + unit;
  });
  return out;
}

/** The heading line for chapter `n` (1-based). */
export function chapterHeading(n: number, title: string, cjk: boolean): string {
  const t = title.trim();
  if (cjk) return `第${chineseNumber(n)}章${t ? ` ${t}` : ''}`;
  return `Chapter ${n}${t ? `: ${t}` : ''}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s:：·.。,，\-—_*#]+/g, '');

/**
 * Where each outline chapter starts in the text: the offset of its heading line, or null when no heading for
 * it is found (not written yet, or the author removed it). Headings are short lines holding the chapter title
 * or "Chapter n" / "第n章", searched in order.
 */
export function locateChapters(text: string, outline: Outline | undefined): (number | null)[] {
  if (!outline) return [];
  const lines: { at: number; text: string }[] = [];
  let at = 0;
  for (const line of text.split('\n')) {
    if (line.trim() && line.trim().length <= 80) lines.push({ at, text: line });
    at += line.length + 1;
  }
  const out: (number | null)[] = [];
  let from = 0;
  outline.chapters.forEach((ch, i) => {
    const n = i + 1;
    const title = norm(ch.title);
    const marks = [norm(`chapter ${n}`), norm(`第${chineseNumber(n)}章`), norm(`第${n}章`)];
    const idx = lines.findIndex((l, j) => {
      if (j < from) return false;
      const t = norm(l.text);
      const numbered = marks.some((m) => t.startsWith(m) && !/^\d/.test(t.slice(m.length)));
      return numbered || (title.length >= 2 && t === title);
    });
    if (idx < 0) out.push(null);
    else {
      out.push(lines[idx].at);
      from = idx + 1;
    }
  });
  return out;
}

/** Text range of chapter `n` (1-based): from its heading to the next located heading, or the end. */
export function chapterRange(text: string, outline: Outline | undefined, n: number): { from: number; to: number } | null {
  const starts = locateChapters(text, outline);
  const from = starts[n - 1];
  if (from === null || from === undefined) return null;
  const next = starts.slice(n).find((x): x is number => x !== null && x > from);
  return { from, to: next ?? text.length };
}
