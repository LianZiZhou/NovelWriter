export type AdventureInputMode = 'do' | 'say' | 'story';

const DIRECTIONS: Record<string, string> = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  ne: 'northeast',
  nw: 'northwest',
  se: 'southeast',
  sw: 'southwest',
  u: 'up',
  d: 'down',
};

const SPECIAL: Record<string, string> = {
  l: 'look around',
  i: 'check your inventory',
  z: 'wait',
};

/**
 * The words around player input, in the story's language: `> 你说：你是谁？`, `> You say: Who are you?`. Only
 * scripts are told apart; anything else is written the English way.
 */
const LOCALE = {
  en: { do: 'You', say: 'You say', colon: ': ', stop: '.' },
  zh: { do: '你', say: '你说', colon: '：', stop: '。' },
  ja: { do: 'あなた', say: 'あなたは言う', colon: '：', stop: '。' },
  ko: { do: '당신', say: '당신은 말한다', colon: ': ', stop: '.' },
  ru: { do: 'Вы', say: 'Вы говорите', colon: ': ', stop: '.' },
};

/** The language of `text` by its script (the last ~2000 characters, so the story as it is now). */
export function scriptLanguage(text: string): keyof typeof LOCALE | null {
  const t = text.slice(-2000);
  const count = (re: RegExp) => (t.match(re) ?? []).length;
  const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const han = count(/\p{Script=Han}/gu);
  const hangul = count(/\p{Script=Hangul}/gu);
  const cyrillic = count(/\p{Script=Cyrillic}/gu);
  const latin = count(/\p{Script=Latin}/gu);
  const best = Math.max(kana + han, hangul, cyrillic, latin);
  if (!best) return null;
  if (kana + han === best) return kana > 0 && kana * 10 >= han ? 'ja' : 'zh';
  if (hangul === best) return 'ko';
  if (cyrillic === best) return 'ru';
  return 'en';
}

/** Input that already ends a sentence is kept as typed; otherwise the language's full stop is added. */
function finish(text: string, stop: string): string {
  return /[\p{Sentence_Terminal}…"”’」』）)\]]$/u.test(text) ? text : text + stop;
}

/**
 * Convert player input to the text inserted into the story: `> {You / You say, in the story's language}: input`.
 * Actions are prefixed with `> ` (hidden in the editor, visible to the AI). `context` is the story so far, whose
 * language the wording follows (the input's own when the story has none yet).
 */
export function adventureInput(raw: string, mode: AdventureInputMode, context = ''): string {
  let input = raw.trim();
  if (!input) return '';
  if (mode === 'story') return input;

  // `!` passes input through unchanged (except the hidden `>`).
  if (/^[!！]/.test(input) && input.length > 1) return `> ${input.slice(1).trim()}`;

  // Shortcuts switching mode.
  if (mode === 'do' && /^["“「]/.test(input)) {
    mode = 'say';
    input = input.replace(/^["“「]|["”」]$/g, '');
  } else if (mode === 'say' && /^[>＞]/.test(input)) {
    mode = 'do';
    input = input.slice(1).trim();
  }
  if (!input) return '';
  const l = LOCALE[scriptLanguage(context) ?? scriptLanguage(input) ?? 'en'];

  if (l === LOCALE.en && mode === 'do') {
    // NovelAI's one-letter shortcuts.
    const lower = input.toLowerCase();
    if (SPECIAL[lower]) return `> You: ${SPECIAL[lower]}.`;
    if (DIRECTIONS[lower]) return `> You: go ${DIRECTIONS[lower]}.`;
    const x = /^x\s+(.+)$/i.exec(input);
    if (x) return `> You: examine ${x[1].replace(/[.]$/, '')}.`;
  }
  // A trailing `*` leaves the line open for the AI to finish.
  const open = input.endsWith('*');
  const text = open ? input.slice(0, -1).trimEnd() : finish(input, l.stop);
  return `> ${mode === 'do' ? l.do : l.say}${l.colon}${text}`;
}

/** Strip the hidden `>` action marker for display. */
export function displayAction(line: string): string {
  return line.replace(/^>\s?/, '');
}

export function isActionLine(line: string): boolean {
  return /^>/.test(line);
}
