import { detectLanguage, punctuate, punctuateWith, type Lang, type MoodModel } from './nlp/index.ts';

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

/** The words around player input in the story's language: `> 你说：你是谁？`, `> You say: Who are you?`. */
const LOCALE: Partial<Record<Lang, { do: string; say: string; colon: string }>> = {
  en: { do: 'You', say: 'You say', colon: ': ' },
  zh: { do: '你', say: '你说', colon: '：' },
  ja: { do: 'あなた', say: 'あなたは言う', colon: '：' },
  ko: { do: '당신', say: '당신은 말한다', colon: ': ' },
  ru: { do: 'Вы', say: 'Вы говорите', colon: ': ' },
  uk: { do: 'Ви', say: 'Ви кажете', colon: ': ' },
  es: { do: 'Tú', say: 'Dices', colon: ': ' },
  fr: { do: 'Vous', say: 'Vous dites', colon: '\u00a0: ' },
  de: { do: 'Du', say: 'Du sagst', colon: ': ' },
  it: { do: 'Tu', say: 'Dici', colon: ': ' },
  pt: { do: 'Você', say: 'Você diz', colon: ': ' },
  nl: { do: 'Jij', say: 'Je zegt', colon: ': ' },
};

interface Parsed {
  /** The finished line, when no punctuation is needed (raw input, shortcuts). */
  line?: string;
  head?: string;
  body?: string;
  /** Leave the body unpunctuated: a trailing `*` lets the AI finish it. */
  open?: boolean;
}

function parse(raw: string, mode: AdventureInputMode, lang: Lang): Parsed {
  let input = raw.trim();
  if (!input) return { line: '' };
  if (mode === 'story') return { line: input };
  // `!` passes input through unchanged (except the hidden `>`).
  if (/^[!！]/.test(input) && input.length > 1) return { line: `> ${input.slice(1).trim()}` };
  // Shortcuts switching mode.
  if (mode === 'do' && /^["“「]/.test(input)) {
    mode = 'say';
    input = input.replace(/^["“「]|["”」]$/g, '');
  } else if (mode === 'say' && /^[>＞]/.test(input)) {
    mode = 'do';
    input = input.slice(1).trim();
  }
  if (!input) return { line: '' };
  const l = LOCALE[lang] ?? LOCALE.en!;
  if (lang === 'en' && mode === 'do') {
    // NovelAI's one-letter shortcuts.
    const lower = input.toLowerCase();
    if (SPECIAL[lower]) return { line: `> You: ${SPECIAL[lower]}.` };
    if (DIRECTIONS[lower]) return { line: `> You: go ${DIRECTIONS[lower]}.` };
    const x = /^x\s+(.+)$/i.exec(input);
    if (x) return { line: `> You: examine ${x[1].replace(/[.]$/, '')}.` };
  }
  const open = input.endsWith('*');
  return { head: `> ${mode === 'do' ? l.do : l.say}${l.colon}`, body: open ? input.slice(0, -1).trimEnd() : input, open };
}

function storyLang(context: string, raw: string): Lang {
  return detectLanguage(context)?.lang ?? detectLanguage(raw)?.lang ?? 'en';
}

/**
 * Convert player input to the text inserted into the story: `> {You / You say, in the story's language}: input`.
 * Actions are prefixed with `> ` (hidden in the editor, visible to the AI). `context` is the story so far, whose
 * language the wording follows (the input's own when the story has none yet). Input that ends a sentence is kept
 * as typed; otherwise it gets the mark its meaning calls for (？ for a question, ！ for an exclamation…), from the
 * words, or with `model`'s help where they are not decisive.
 */
export async function adventureInputWith(raw: string, mode: AdventureInputMode, context = '', model?: MoodModel): Promise<string> {
  const p = parse(raw, mode, storyLang(context, raw));
  if (p.line !== undefined) return p.line;
  return p.head + (p.open ? p.body! : (await punctuateWith(p.body!, context || raw, model)).text);
}

/** `adventureInputWith` from the words alone. */
export function adventureInput(raw: string, mode: AdventureInputMode, context = ''): string {
  const p = parse(raw, mode, storyLang(context, raw));
  if (p.line !== undefined) return p.line;
  return p.head + (p.open ? p.body! : punctuate(p.body!, context || raw).text);
}

/** Strip the hidden `>` action marker for display. */
export function displayAction(line: string): string {
  return line.replace(/^>\s?/, '');
}

export function isActionLine(line: string): boolean {
  return /^>/.test(line);
}
