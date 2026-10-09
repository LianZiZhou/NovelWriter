/**
 * NovelWriter's text-analysis pipeline, one place for what the app needs to know about story text in any language:
 *
 *   language (`lang.ts`) → sentences and words (`segment.ts`) → what each sentence does (`mood.ts`) →
 *   how it is punctuated in that language (`punctuation.ts`).
 *
 * Every stage runs anywhere without a model. Where the words don't settle a sentence's mood, a model can be
 * consulted: the server classifies with the embedding model set up for recall (see the server's `nlp.ts`), so the
 * pipeline uses the same engines (ONNX Runtime, llama.cpp, an endpoint) and hardware as embeddings.
 */
import { detectLanguage, type Lang } from './lang.ts';
import { bestMood, guessMood, type MoodGuess, type MoodScores } from './mood.ts';
import { endsSentence, terminate, type Mood } from './punctuation.ts';

export * from './lang.ts';
export * from './segment.ts';
export * from './mood.ts';
export * from './punctuation.ts';
export * from './exemplars.ts';

/** A model's opinion of each text's mood (scores summing to 1), or null where it has none. */
export type MoodModel = (texts: string[], lang: Lang) => Promise<(MoodScores | null)[]>;

export interface Punctuated {
  text: string;
  lang: Lang;
  mood: Mood;
  /** Whether the player's own ending was kept, the words decided, or a model weighed in. */
  source: 'typed' | 'rules' | 'model';
  guess?: MoodGuess;
}

/** How far the words' scores are trusted against a model's, by how decisive the words were. */
export function blendMood(rules: MoodGuess, model: MoodScores | null | undefined): { mood: Mood; source: 'rules' | 'model' } {
  if (!model || rules.confidence >= 0.75) return { mood: rules.mood, source: 'rules' };
  const w = Math.max(0.25, rules.confidence);
  const s = Object.fromEntries((Object.keys(rules.scores) as Mood[]).map((k) => [k, rules.scores[k] * w + model[k] * (1 - w)])) as MoodScores;
  const mood = bestMood(s);
  return { mood, source: mood === rules.mood ? 'rules' : 'model' };
}

/**
 * End `text` with the mark its meaning calls for in the language of `context` (the story so far; the text's own
 * language when the story has none): 「你是谁」→「你是谁？」, "where am I" → "where am I?". Text that already ends
 * a sentence is returned as typed.
 */
export function punctuate(text: string, context = '', modelScores?: MoodScores | null): Punctuated {
  const lang = detectLanguage(context)?.lang ?? detectLanguage(text)?.lang ?? 'en';
  const t = text.trim();
  if (!t || endsSentence(t, lang)) return { text: t, lang, mood: 'statement', source: 'typed' };
  // The words are read in their own language (English typed into a Chinese story), the marks follow the story's.
  const own = detectLanguage(t);
  const guess = guessMood(t, own && own.confidence >= 0.5 ? own.lang : lang);
  const { mood, source } = blendMood(guess, modelScores);
  return { text: terminate(t, lang, mood), lang, mood, source, guess };
}

/** `punctuate`, asking `model` when the words alone are not decisive. */
export async function punctuateWith(text: string, context: string, model?: MoodModel): Promise<Punctuated> {
  const quick = punctuate(text, context);
  if (!model || quick.source === 'typed' || (quick.guess?.confidence ?? 1) >= 0.75) return quick;
  try {
    const [scores] = await model([text.trim()], quick.lang);
    return punctuate(text, context, scores);
  } catch {
    return quick;
  }
}
