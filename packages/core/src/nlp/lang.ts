/**
 * Language identification for story text: the writing system first (it settles Chinese, Japanese, Korean, Russian,
 * Arabic, Greek…), then common function words to tell the languages written in Latin letters apart.
 */

export type Lang =
  | 'en'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'ru'
  | 'uk'
  | 'es'
  | 'fr'
  | 'de'
  | 'it'
  | 'pt'
  | 'nl'
  | 'ar'
  | 'fa'
  | 'he'
  | 'el'
  | 'hi'
  | 'th'
  | 'hy'
  | 'ka'
  | 'am'
  | 'my';

export const LANGS: Lang[] = ['en', 'zh', 'ja', 'ko', 'ru', 'uk', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ar', 'fa', 'he', 'el', 'hi', 'th', 'hy', 'ka', 'am', 'my'];

export interface LangGuess {
  lang: Lang;
  /** 0–1: the share of letters in the winning script, lowered when function words barely tell Latin languages apart. */
  confidence: number;
}

const SCRIPTS: [Lang | 'cjk' | 'latin' | 'cyrillic' | 'arabic', RegExp][] = [
  ['cjk', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['ko', /\p{Script=Hangul}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['he', /\p{Script=Hebrew}/u],
  ['el', /\p{Script=Greek}/u],
  ['hi', /\p{Script=Devanagari}/u],
  ['th', /\p{Script=Thai}/u],
  ['hy', /\p{Script=Armenian}/u],
  ['ka', /\p{Script=Georgian}/u],
  ['am', /\p{Script=Ethiopic}/u],
  ['my', /\p{Script=Myanmar}/u],
  ['latin', /\p{Script=Latin}/u],
];

/** Frequent short words of each Latin-script language (few shared between them). */
const FUNCTION_WORDS: Partial<Record<Lang, string[]>> = {
  en: ['the', 'and', 'of', 'to', 'is', 'was', 'you', 'that', 'it', 'he', 'she', 'with', 'for', 'his', 'her', 'not', 'are', 'what', 'this', 'have', 'they', 'where', 'who'],
  es: ['el', 'la', 'los', 'las', 'que', 'de', 'y', 'en', 'un', 'una', 'es', 'por', 'con', 'se', 'su', 'no', 'lo', 'pero', 'como', 'dónde', 'qué', 'quién', 'está'],
  fr: ['le', 'la', 'les', 'et', 'des', 'est', 'un', 'une', 'que', 'qui', 'dans', 'pas', 'ne', 'il', 'elle', 'vous', 'je', 'au', 'du', 'sur', 'où', 'avec', 'mais'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'ich', 'du', 'er', 'sie', 'es', 'mit', 'auf', 'den', 'dem', 'zu', 'wer', 'wo', 'wie', 'was', 'sich'],
  it: ['il', 'lo', 'gli', 'che', 'di', 'e', 'non', 'un', 'una', 'è', 'per', 'con', 'mi', 'ti', 'sono', 'della', 'dove', 'chi', 'cosa', 'ma', 'questo', 'perché'],
  pt: ['o', 'os', 'as', 'que', 'de', 'e', 'não', 'um', 'uma', 'é', 'para', 'com', 'em', 'do', 'da', 'você', 'onde', 'quem', 'mas', 'está', 'ele', 'ela'],
  nl: ['de', 'het', 'een', 'en', 'is', 'niet', 'van', 'dat', 'ik', 'je', 'hij', 'zij', 'met', 'op', 'wat', 'waar', 'wie', 'maar', 'ook', 'zijn'],
};

const WORD_SETS = Object.entries(FUNCTION_WORDS).map(([lang, words]) => [lang as Lang, new Set(words)] as const);

/**
 * The language of `text`, judged from its last `window` characters (the story as it reads now), or null when it
 * has no letters.
 */
export function detectLanguage(text: string, window = 2000): LangGuess | null {
  const t = text.slice(-window);
  const counts = new Map<string, number>();
  let kana = 0;
  let letters = 0;
  for (const ch of t) {
    if (!/\p{L}/u.test(ch)) continue;
    letters++;
    for (const [name, re] of SCRIPTS) {
      if (re.test(ch)) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        if (name === 'cjk' && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) kana++;
        break;
      }
    }
  }
  if (!letters) return null;
  const [script, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  const share = n / letters;
  if (script === 'cjk') return { lang: kana > 0 && kana * 10 >= n ? 'ja' : 'zh', confidence: share };
  if (script === 'cyrillic') return { lang: /[іїєґ]/iu.test(t) ? 'uk' : 'ru', confidence: share };
  if (script === 'arabic') return { lang: /[پچژگک]/u.test(t) ? 'fa' : 'ar', confidence: share };
  if (script !== 'latin') return { lang: script as Lang, confidence: share };
  const words = t.toLowerCase().match(/\p{L}+/gu) ?? [];
  let best: Lang = 'en';
  let top = 0;
  let second = 0;
  for (const [lang, set] of WORD_SETS) {
    let hits = 0;
    for (const w of words) if (set.has(w)) hits++;
    if (hits > top) {
      second = top;
      top = hits;
      best = lang;
    } else if (hits > second) second = hits;
  }
  // Too few words to tell: English, with low confidence.
  if (!top) return { lang: 'en', confidence: share * 0.3 };
  return { lang: best, confidence: share * Math.min(1, (top - second + 1) / Math.max(2, top)) };
}

/** Languages written without spaces between sentences (a full stop ends the sentence right there). */
export function isCjk(lang: Lang): boolean {
  return lang === 'zh' || lang === 'ja';
}
