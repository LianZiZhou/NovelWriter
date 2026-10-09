/**
 * NovelWriter's text-analysis pipeline, one place for what the app needs to know about story text in any language:
 *
 *   language (`lang.ts`) → sentences and words (`segment.ts`) → what each sentence does (`mood.ts`) →
 *   how it is punctuated in that language (`punctuation.ts`).
 *
 * Every stage runs anywhere without a model. Local models for each task (`models.ts`) are downloaded and run by the
 * server, like the embedding models; where one is installed, it is asked when the rules are not sure.
 */
import { detectLanguage, type Lang } from './lang.ts';
import { guessMood, type MoodGuess } from './mood.ts';
import { endsSentence, terminate, type Mood } from './punctuation.ts';

export * from './lang.ts';
export * from './segment.ts';
export * from './mood.ts';
export * from './punctuation.ts';
export * from './models.ts';

/** What the local models make of a typed line: how likely it asks something, and its language. */
export interface ModelReading {
  question?: number;
  lang?: Lang | null;
}

/** Asks the local models about each text; null where they have nothing to say. */
export type MoodModel = (texts: string[]) => Promise<(ModelReading | null)[]>;

export interface Punctuated {
  text: string;
  lang: Lang;
  mood: Mood;
  /** Whether the player's own ending was kept, the words decided, or a model weighed in. */
  source: 'typed' | 'rules' | 'model';
  guess?: MoodGuess;
}

/**
 * The words' scores weighed against a punctuation model's chance that the sentence is a question. The model knows
 * questions from statements but not exclamations, so between those two the words decide.
 */
export function blendMood(rules: MoodGuess, question: number | null | undefined): { mood: Mood; source: 'rules' | 'model' } {
  if (question == null || rules.confidence >= 0.75) return { mood: rules.mood, source: 'rules' };
  const w = Math.max(0.25, rules.confidence);
  const q = rules.scores.question * w + question * (1 - w);
  const mood: Mood = q >= 0.5 ? 'question' : rules.scores.exclamation > rules.scores.statement ? 'exclamation' : 'statement';
  return { mood, source: mood === rules.mood ? 'rules' : 'model' };
}

/**
 * End `text` with the mark its meaning calls for in the language of `context` (the story so far; the text's own
 * language when the story has none): 「你是谁」→「你是谁？」, "where am I" → "where am I?". Text that already ends
 * a sentence is returned as typed.
 */
export function punctuate(text: string, context = '', reading?: ModelReading | null): Punctuated {
  const lang = detectLanguage(context)?.lang ?? detectLanguage(text)?.lang ?? 'en';
  const t = text.trim();
  if (!t || endsSentence(t, lang)) return { text: t, lang, mood: 'statement', source: 'typed' };
  // The words are read in their own language (English typed into a Chinese story), the marks follow the story's.
  const own = detectLanguage(t);
  const guess = guessMood(t, reading?.lang ?? (own && own.confidence >= 0.5 ? own.lang : lang));
  const { mood, source } = blendMood(guess, reading?.question);
  return { text: terminate(t, lang, mood), lang, mood, source, guess };
}

/** `punctuate`, asking `model` when the words alone are not decisive. */
export async function punctuateWith(text: string, context: string, model?: MoodModel): Promise<Punctuated> {
  const quick = punctuate(text, context);
  if (!model || quick.source === 'typed' || (quick.guess?.confidence ?? 1) >= 0.75) return quick;
  try {
    const [reading] = await model([text.trim()]);
    return punctuate(text, context, reading);
  } catch {
    return quick;
  }
}
