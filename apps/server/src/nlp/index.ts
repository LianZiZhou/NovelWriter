// Local text-analysis models (punctuation, sentence segmentation, language, named entities), set up like the
// embedding models: downloaded from Hugging Face on request into the models folder, run on the ONNX runtime the
// embeddings install, in a worker process. The rules in core's nlp/ answer whenever no model is set.
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  langFromLabel,
  NLP_MODELS,
  nlpModel,
  normalizeNlpConfig,
  type EntityResult,
  type LanguageResult,
  type ModelReading,
  type NlpConfig,
  type NlpConfigPatch,
  type NlpModelInfo,
  type NlpTask,
  type PunctuationResult,
} from '@novelwriter/core';
import type { Storage } from '../storage.ts';
import type { Embeddings } from '../embeddings/index.ts';
import { detectHardware } from '../embeddings/hardware.ts';
import { checkRepo } from '../embeddings/models.ts';
import { dirSize, sessionOptions, transformersDevice } from '../embeddings/onnx.ts';
import { download, type TaskContext } from '../embeddings/tasks.ts';
import { NlpWorker } from './worker.ts';

const FILE = 'nlp.json';
/** Files a model works without (not every converted repo has them). */
const OPTIONAL = new Set(['special_tokens_map.json', 'tokenizer_config.json']);
/** Segment any Text's threshold for its `-sm` models. */
const SAT_THRESHOLD = 0.25;

const localName = (f: NlpModelInfo['files'][number]) => f.as ?? f.path;

export class Nlp {
  private worker: NlpWorker | null = null;
  private workerSig = '';
  private loaded = new Map<string, Promise<unknown>>();

  constructor(
    private readonly storage: Storage,
    private readonly emb: Embeddings,
  ) {}

  /** Downloads share the embeddings' task list (and its ONNX runtime install). */
  get tasks() {
    return this.emb.tasks;
  }

  async config(): Promise<NlpConfig> {
    return normalizeNlpConfig(await this.storage.readJson<NlpConfigPatch>(FILE, {}));
  }

  async saveConfig(next: NlpConfigPatch): Promise<void> {
    const prev = await this.config();
    await this.storage.writeJson(FILE, normalizeNlpConfig({ ...prev, ...next, models: { ...prev.models, ...next.models } }));
  }

  /** Next to the embedding models, so one folder setting covers both. */
  async modelsDir(): Promise<string> {
    return join(this.emb.modelsDir(await this.emb.config()), 'nlp');
  }

  async installed(): Promise<{ id: string; sizeMB: number }[]> {
    const dir = await this.modelsDir();
    return NLP_MODELS.filter((m) => isInstalled(dir, m)).map((m) => ({ id: m.id, sizeMB: Math.round(dirSize(join(dir, m.id)) / 1048576) }));
  }

  async download(m: NlpModelInfo, ctx: TaskContext): Promise<void> {
    const c = await this.emb.config();
    const hf = (c.hfEndpoint || 'https://huggingface.co').replace(/\/+$/, '');
    const dir = join(await this.modelsDir(), m.id);
    for (const f of m.files) {
      const dest = join(dir, ...localName(f).split('/'));
      if (existsSync(dest)) continue;
      ctx.setCurrent(`${f.repo}/${f.path}`);
      try {
        await download(`${hf}/${checkRepo(f.repo)}/resolve/main/${f.path}`, dest, { ctx });
      } catch (e) {
        if (OPTIONAL.has(f.path) && !ctx.signal.aborted) continue;
        throw e;
      }
    }
  }

  async remove(m: NlpModelInfo): Promise<void> {
    this.stop();
    rmSync(join(await this.modelsDir(), m.id), { recursive: true, force: true });
  }

  /** The worker, restarted when the device settings or the models folder change. */
  private async ensureWorker(c: NlpConfig): Promise<{ worker: NlpWorker; device: string; options: Record<string, unknown> }> {
    const ec = await this.emb.config();
    let o = c.device === 'embeddings' ? ec.onnx : { ...ec.onnx, device: 'cpu' as const, customRuntime: '' };
    if (o.device === 'auto') {
      let device = (await detectHardware()).suggest.onnxDevice;
      if ((device === 'cuda' || device === 'tensorrt') && !this.emb.runtime.status().cudaProviders) device = 'cpu';
      o = { ...o, device };
    }
    const dir = await this.modelsDir();
    const sig = JSON.stringify([o, dir]);
    if (!this.worker?.alive() || sig !== this.workerSig) {
      this.stop();
      if (!this.emb.runtime.installed()) throw new Error('The ONNX runtime is not installed. Install it in Settings → Text Analysis.');
      this.worker = new NlpWorker(this.emb.runtime.workerDir(o.customRuntime), dir);
      this.workerSig = sig;
    }
    return { worker: this.worker, device: transformersDevice(o), options: sessionOptions(o) };
  }

  /** The worker with the task's model loaded, or null when the task has no model (or it isn't downloaded). */
  private async model(task: NlpTask, c?: NlpConfig): Promise<{ worker: NlpWorker; m: NlpModelInfo } | null> {
    c ??= await this.config();
    const m = nlpModel(c.models[task]);
    if (!m || !isInstalled(await this.modelsDir(), m)) return null;
    const { worker, device, options } = await this.ensureWorker(c);
    const key = `${this.workerSig}|${m.id}`;
    let p = this.loaded.get(key);
    if (!p) {
      p = worker.load({ model: m.id, task: m.task, runner: m.runner, dtype: m.dtype, device, sessionOptions: options });
      this.loaded.set(key, p);
      p.catch(() => this.loaded.delete(key));
    }
    await p;
    return { worker, m };
  }

  async punctuate(texts: string[], c?: NlpConfig): Promise<PunctuationResult[] | null> {
    const w = await this.model('punctuation', c);
    if (!w) return null;
    return (await w.worker.call({ type: 'punctuate', model: w.m.id, texts })).results as PunctuationResult[];
  }

  async segment(text: string, c?: NlpConfig): Promise<string[] | null> {
    const w = await this.model('segmentation', c);
    if (!w) return null;
    return ((await w.worker.call({ type: 'segment', model: w.m.id, text, threshold: SAT_THRESHOLD })).result as { sentences: string[] }).sentences;
  }

  async language(texts: string[], c?: NlpConfig): Promise<LanguageResult[][] | null> {
    const w = await this.model('language', c);
    if (!w) return null;
    const res = (await w.worker.call({ type: 'classify', model: w.m.id, texts, topK: 3 })).results as { label: string; score: number }[][];
    return res.map((top) => (Array.isArray(top) ? top : [top]).map((r) => ({ label: r.label, lang: langFromLabel(r.label), score: r.score })));
  }

  async entities(text: string, c?: NlpConfig): Promise<EntityResult[] | null> {
    const w = await this.model('entities', c);
    if (!w) return null;
    return ((await w.worker.call({ type: 'entities', model: w.m.id, text })).result as { entities: EntityResult[] }).entities;
  }

  /** What the models make of short typed lines (adventure input): question or not, and the language. */
  async read(texts: string[]): Promise<(ModelReading | null)[]> {
    const c = await this.config();
    const [punct, langs] = await Promise.all([this.punctuate(texts, c), this.language(texts, c)]);
    return texts.map((_, i) => {
      if (!punct && !langs) return null;
      const top = langs?.[i]?.[0];
      return { question: punct?.[i]?.question, lang: top && top.score >= 0.5 ? top.lang : undefined };
    });
  }

  stop(): void {
    this.worker?.stop();
    this.worker = null;
    this.loaded.clear();
  }
}

function isInstalled(dir: string, m: NlpModelInfo): boolean {
  return m.files.every((f) => OPTIONAL.has(f.path) || (existsSync(join(dir, m.id, ...localName(f).split('/'))) && statSync(join(dir, m.id, ...localName(f).split('/'))).size > 0));
}

const SAMPLE: Record<NlpTask, string> = {
  punctuation: '他到底想干什么我们还能回去吗 where did she go i hope everything is fine',
  segmentation: '我推开门外面在下雨他站在那里看着我 this is a test this is another test',
  language: '我推开门，外面在下雨。',
  entities: '林远带着阿兰从长安出发，一路向西去了敦煌。Anna met Mr. Smith in Berlin.',
};

export function registerNlpRoutes(app: FastifyInstance, nlp: Nlp): void {
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown, code = 400) => reply.code(code).send({ error: (e as Error).message });
  const find = (id: string) => {
    const m = nlpModel(id);
    if (!m) throw new Error(`Unknown model: ${id}`);
    return m;
  };

  app.get('/api/nlp/config', async () => nlp.config());
  app.put<{ Body: NlpConfigPatch }>('/api/nlp/config', async (req) => {
    await nlp.saveConfig(req.body ?? {});
    return { ok: true };
  });

  app.get('/api/nlp/status', async () => ({ installed: await nlp.installed(), modelsDir: await nlp.modelsDir() }));

  app.post<{ Body: { id: string } }>('/api/nlp/models', async (req, reply) => {
    try {
      const m = find(req.body?.id);
      return nlp.tasks.start(`nlp:${m.id}`, m.name, (ctx) => nlp.download(m, ctx));
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.delete<{ Body: { id: string } }>('/api/nlp/models', async (req, reply) => {
    try {
      await nlp.remove(find(req.body?.id));
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  /** Run one task's model on a text (the sample when none is given): checks the setup and shows the speed. */
  app.post<{ Body: { task: NlpTask; text?: string } }>('/api/nlp/test', async (req, reply) => {
    const task = req.body?.task;
    const text = String(req.body?.text || SAMPLE[task] || '').slice(0, 20000);
    const t0 = Date.now();
    try {
      const result =
        task === 'punctuation' ? await nlp.punctuate([text]).then((r) => r?.[0])
        : task === 'segmentation' ? await nlp.segment(text)
        : task === 'language' ? await nlp.language([text]).then((r) => r?.[0])
        : task === 'entities' ? await nlp.entities(text)
        : undefined;
      if (result === undefined) throw new Error(`Unknown task: ${task}`);
      if (result === null) throw new Error('No model is set for this, or it is not downloaded.');
      return { text, result, ms: Date.now() - t0 };
    } catch (e) {
      return fail(reply, e, 502);
    }
  });

  // The client asks this about adventure input; nulls (the rules decide alone) when no model is set or one fails.
  app.post<{ Body: { texts: string[] } }>('/api/nlp/read', async (req) => {
    const texts = (req.body?.texts ?? []).slice(0, 32).map((t) => String(t).slice(0, 500));
    try {
      return { readings: await nlp.read(texts) };
    } catch (e) {
      return { readings: texts.map(() => null), error: (e as Error).message };
    }
  });

  app.addHook('onClose', async () => nlp.stop());
}
