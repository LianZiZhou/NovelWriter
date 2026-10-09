// The model side of the text-analysis pipeline (see packages/core/src/nlp): a sentence's mood judged by the
// embedding model set up for recall, from the examples of each mood it sits closest to. It runs on the same engine
// and hardware as recall, and answers nothing (the words decide alone) when embeddings are off or fail.
import type { FastifyInstance } from 'fastify';
import { embeddingKey, MOOD_EXEMPLARS, type Lang, type Mood, type MoodScores } from '@novelwriter/core';
import type { Embeddings } from './embeddings/index.ts';

const MOODS = Object.keys(MOOD_EXEMPLARS) as Mood[];
/** Nearest examples averaged per mood. */
const K = 3;
/** Softmax temperature over cosine similarities (they differ by hundredths between moods). */
const TEMPERATURE = 0.02;

export class Nlp {
  /** Example vectors per embedding setup. */
  private examples = new Map<string, Promise<Record<Mood, Float32Array[]>>>();

  constructor(private readonly emb: Embeddings) {}

  /** Mood scores for each text from the embedding model, or nulls when there is none to ask. */
  async moodScores(texts: string[], _lang?: Lang, signal?: AbortSignal): Promise<(MoodScores | null)[]> {
    const c = await this.emb.config();
    if (!c.enabled || !texts.length) return texts.map(() => null);
    const key = embeddingKey(c);
    let ex = this.examples.get(key);
    if (!ex) {
      const all = MOODS.flatMap((m) => MOOD_EXEMPLARS[m]);
      ex = this.emb.embed(all, 'doc', c, signal).then((vecs) => {
        const out = {} as Record<Mood, Float32Array[]>;
        let i = 0;
        for (const m of MOODS) out[m] = MOOD_EXEMPLARS[m].map(() => vecs[i++]);
        return out;
      });
      this.examples.set(key, ex);
      ex.catch(() => this.examples.delete(key));
    }
    const examples = await ex;
    const vecs = await this.emb.embed(texts.map((t) => t.trim().replace(/[\p{P}\s]+$/u, '')), 'doc', c, signal);
    return vecs.map((v) => moodFromExamples(v, examples));
  }
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

export function moodFromExamples(v: Float32Array, examples: Record<Mood, Float32Array[]>): MoodScores {
  const sim = {} as Record<Mood, number>;
  for (const m of MOODS) {
    const top = examples[m].map((e) => dot(v, e)).sort((a, b) => b - a).slice(0, K);
    sim[m] = top.reduce((a, b) => a + b, 0) / top.length;
  }
  const max = Math.max(...MOODS.map((m) => sim[m]));
  const exp = MOODS.map((m) => Math.exp((sim[m] - max) / TEMPERATURE));
  const total = exp.reduce((a, b) => a + b, 0);
  return Object.fromEntries(MOODS.map((m, i) => [m, exp[i] / total])) as MoodScores;
}

export function registerNlpRoutes(app: FastifyInstance, nlp: Nlp): void {
  // Mood scores from the embedding model; the client blends them with what the words say.
  app.post<{ Body: { texts: string[]; lang?: Lang } }>('/api/nlp/mood', async (req) => {
    const texts = (req.body?.texts ?? []).slice(0, 32).map((t) => String(t).slice(0, 500));
    try {
      return { scores: await nlp.moodScores(texts, req.body?.lang) };
    } catch (e) {
      return { scores: texts.map(() => null), error: (e as Error).message };
    }
  });
}
