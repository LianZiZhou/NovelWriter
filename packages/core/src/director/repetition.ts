/**
 * How much of `passage` repeats `earlier` (0–1): the share of its word (or CJK character) trigrams that
 * already occur there. Long runs share a lot; ordinary continuations stay low.
 */
export function repetitionScore(passage: string, earlier: string): number {
  const grams = (text: string) => {
    const terms = tokens(text);
    const out = new Set<string>();
    for (let i = 0; i + 2 < terms.length; i++) out.add(`${terms[i]} ${terms[i + 1]} ${terms[i + 2]}`);
    return out;
  };
  const a = grams(passage);
  if (a.size < 5) return 0;
  const b = grams(earlier);
  let hit = 0;
  for (const g of a) if (b.has(g)) hit++;
  return hit / a.size;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Words, with CJK runs split into single characters, lower-cased. */
function tokens(text: string): string[] {
  const out: string[] = [];
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (CJK.test(w)) out.push(...[...w]);
    else out.push(w);
  }
  return out;
}
