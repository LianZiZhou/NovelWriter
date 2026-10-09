// Embeddings for recalling earlier passages by meaning: settings, engines, downloads and the vector index.
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  activeEmbeddingModel,
  embeddingInput,
  embeddingKey,
  embeddingModel,
  finishVector,
  normalizeEmbeddingConfig,
  recallChunks,
  type EmbeddingConfig,
  type EmbeddingConfigPatch,
  type OnnxDtype,
} from '@novelwriter/core';
import type { Storage } from '../storage.ts';
import { detectHardware } from './hardware.ts';
import { LlamaManager } from './llama.ts';
import { deleteGguf, deleteOnnx, downloadGguf, downloadOnnx, installedModels, onnxDir, onnxInstalled } from './models.ts';
import { OnnxRuntime, OnnxWorker, onnxRepo, resolveDtype } from './onnx.ts';
import { embedEndpoint, endpointCall } from './remote.ts';
import { VectorStore } from './store.ts';
import { Tasks } from './tasks.ts';

const MASK = '••••';
const FILE = 'embeddings.json';

export interface IndexStatus {
  key: string;
  /** Passages in the story, and how many have vectors. */
  total: number;
  indexed: number;
  running: boolean;
  error?: string;
  updatedAt: number;
}

export class Embeddings {
  readonly tasks = new Tasks();
  readonly runtime: OnnxRuntime;
  readonly llama: LlamaManager;
  readonly store: VectorStore;
  private worker: OnnxWorker | null = null;
  /** The suggested accelerator failed to load: "Automatic" uses the CPU from then on. */
  private autoCpu = false;
  private workerSig = '';
  private indexing = new Map<string, { status: IndexStatus; next?: string }>();

  constructor(
    private readonly dataDir: string,
    private readonly storage: Storage,
  ) {
    this.runtime = new OnnxRuntime(dataDir);
    this.llama = new LlamaManager(dataDir);
    this.store = new VectorStore(join(dataDir, 'vectors'));
  }

  async config(): Promise<EmbeddingConfig> {
    return normalizeEmbeddingConfig(await this.storage.readJson<EmbeddingConfigPatch>(FILE, {}));
  }

  async publicConfig(): Promise<EmbeddingConfig> {
    const c = await this.config();
    return { ...c, endpoint: { ...c.endpoint, apiKey: c.endpoint.apiKey ? MASK : '' } };
  }

  async saveConfig(next: EmbeddingConfigPatch): Promise<void> {
    const prev = await this.config();
    const merged = normalizeEmbeddingConfig({ ...prev, ...next, onnx: { ...prev.onnx, ...next.onnx }, llama: { ...prev.llama, ...next.llama }, endpoint: { ...prev.endpoint, ...next.endpoint } });
    if (merged.endpoint.apiKey === MASK) merged.endpoint.apiKey = prev.endpoint.apiKey;
    await this.storage.writeJson(FILE, merged);
  }

  modelsDir(c: EmbeddingConfig): string {
    return c.modelsDir.trim() || join(this.dataDir, 'models');
  }

  /** Longest input, in characters (CJK text runs about one token per character with these tokenizers). */
  private limit(c: EmbeddingConfig): number {
    return c.maxTokens || Math.min(activeEmbeddingModel(c)?.maxTokens ?? 512, 1024);
  }

  private async onnxWorker(c: EmbeddingConfig): Promise<OnnxWorker> {
    // "Automatic" is this machine's suggestion: ONNX Runtime's own choice tries CUDA on every Linux PC and fails
    // where the CUDA libraries are missing.
    if (c.onnx.device === 'auto') {
      let device = this.autoCpu ? 'cpu' : (await detectHardware()).suggest.onnxDevice;
      if ((device === 'cuda' || device === 'tensorrt') && !this.runtime.status().cudaProviders) device = 'cpu';
      c = { ...c, onnx: { ...c.onnx, device } };
    }
    const sig = JSON.stringify([c.onnx, this.modelsDir(c)]);
    if (this.worker && this.worker.alive() && sig === this.workerSig) return this.worker;
    this.worker?.stop();
    const repo = onnxRepo(c.onnx);
    const dtype = resolveDtype(c.onnx);
    if (!onnxInstalled(this.modelsDir(c), repo, dtype)) throw new Error(`${repo} (${dtype}) is not downloaded. Download it in Settings → Vector Search.`);
    this.worker = new OnnxWorker(this.runtime, c, onnxDir(this.modelsDir(c)));
    this.workerSig = sig;
    return this.worker;
  }

  /** Embed texts as queries or passages with the configured engine; unit-length vectors. */
  async embed(texts: string[], kind: 'query' | 'doc', c?: EmbeddingConfig, signal?: AbortSignal): Promise<Float32Array[]> {
    c ??= await this.config();
    const limit = this.limit(c);
    // Queries keep their end (the latest text), passages their start.
    const inputs = texts.map((t) => embeddingInput(c, kind === 'query' ? t.slice(-limit) : t.slice(0, limit), kind));
    const out: Float32Array[] = [];
    const batch = Math.max(1, c.batchSize);
    const run = async (part: string[]): Promise<Float32Array[]> => {
      if (c.source === 'onnx') {
        try {
          return await (await this.onnxWorker(c)).embed(part, c.pooling, limit);
        } catch (e) {
          if (c.onnx.device !== 'auto' || this.autoCpu || this.worker?.info.device === 'cpu') throw e;
          this.autoCpu = true;
          return (await this.onnxWorker(c)).embed(part, c.pooling, limit);
        }
      }
      if (c.source === 'llamacpp') {
        const url = await this.llama.ensure(c, this.modelsDir(c));
        return embedEndpoint(part, { baseUrl: `${url}/v1`, model: 'embedding', timeoutMs: 120000, signal });
      }
      return embedEndpoint(part, endpointCall(c, kind, signal));
    };
    const parts: string[][] = [];
    for (let i = 0; i < inputs.length; i += batch) parts.push(inputs.slice(i, i + batch));
    const concurrency = c.source === 'endpoint' ? Math.max(1, c.endpoint.concurrency) : 1;
    const results: Float32Array[][] = new Array(parts.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, parts.length) }, async () => {
        while (next < parts.length) {
          const i = next++;
          if (signal?.aborted) throw new Error('Canceled');
          results[i] = await run(parts[i]);
        }
      }),
    );
    for (const r of results) out.push(...r.map((v) => finishVector(v, c.dimensions)));
    return out;
  }

  // ------------------------------------------------------------- story index

  indexStatus(storyId: string, c: EmbeddingConfig, text?: string): IndexStatus {
    const key = embeddingKey(c);
    const live = this.indexing.get(storyId);
    if (live && live.status.key === key) return { ...live.status };
    const idx = this.store.get(storyId, key);
    const total = text === undefined ? idx.vectors.size : recallChunks(text).length;
    const indexed = text === undefined ? idx.vectors.size : recallChunks(text).filter((ch) => idx.vectors.has(ch.hash)).length;
    return { key, total, indexed, running: false, updatedAt: idx.updatedAt };
  }

  /** Bring a story's index up to date with its text, in the background. */
  sync(storyId: string, text: string, c: EmbeddingConfig): IndexStatus {
    const key = embeddingKey(c);
    const live = this.indexing.get(storyId);
    if (live?.status.running) {
      live.next = text;
      return { ...live.status };
    }
    const status: IndexStatus = { key, total: 0, indexed: 0, running: true, updatedAt: Date.now() };
    const entry: { status: IndexStatus; next?: string } = { status };
    this.indexing.set(storyId, entry);
    void (async () => {
      let current: string | undefined = text;
      while (current !== undefined) {
        entry.next = undefined;
        try {
          await this.index(storyId, current, c, status);
          status.error = undefined;
        } catch (e) {
          status.error = (e as Error).message;
          break;
        }
        current = entry.next;
      }
      status.running = false;
    })();
    return { ...status };
  }

  private async index(storyId: string, text: string, c: EmbeddingConfig, status: IndexStatus): Promise<void> {
    const idx = this.store.get(storyId, status.key);
    const chunks = recallChunks(text);
    const wanted = new Set(chunks.map((ch) => ch.hash));
    for (const h of [...idx.vectors.keys()]) if (!wanted.has(h)) idx.vectors.delete(h);
    const missing = chunks.filter((ch, i) => !idx.vectors.has(ch.hash) && chunks.findIndex((x) => x.hash === ch.hash) === i);
    status.total = wanted.size;
    status.indexed = wanted.size - missing.length;
    const step = Math.max(1, c.batchSize) * 4;
    for (let i = 0; i < missing.length; i += step) {
      const part = missing.slice(i, i + step);
      const vecs = await this.embed(
        part.map((p) => p.text),
        'doc',
        c,
      );
      part.forEach((p, j) => idx.vectors.set(p.hash, vecs[j]));
      idx.dims = vecs[0]?.length ?? idx.dims;
      status.indexed += part.length;
      idx.updatedAt = status.updatedAt = Date.now();
      // Save as it goes: a long story is indexed over several minutes on a CPU.
      if ((i / step) % 10 === 9) await this.store.save(storyId, idx);
    }
    idx.updatedAt = status.updatedAt = Date.now();
    await this.store.save(storyId, idx);
  }

  async search(storyId: string, query: string, c: EmbeddingConfig, signal?: AbortSignal): Promise<{ hashes: string[]; scores: number[]; indexed: number }> {
    const idx = this.store.get(storyId, embeddingKey(c));
    if (!idx.vectors.size || !query.trim()) return { hashes: [], scores: [], indexed: idx.vectors.size };
    const [q] = await this.embed([query.slice(-c.queryChars)], 'query', c, signal);
    const hits = this.store.search(idx, q, c.topK, c.minScore);
    return { hashes: hits.map((h) => h.hash), scores: hits.map((h) => Math.round(h.score * 1000) / 1000), indexed: idx.vectors.size };
  }

  dropStory(storyId: string): void {
    this.indexing.delete(storyId);
    this.store.drop(storyId);
  }

  stop(): void {
    this.worker?.stop();
    this.worker = null;
    this.llama.stop();
  }
}

const SAMPLE = ['那把刻着龙纹的铜器被她藏进了箱底。', '钥匙上刻着一条盘绕的龙，她一直贴身收着。', 'The weather was fine all week.'];

export function registerEmbeddingRoutes(app: FastifyInstance, emb: Embeddings): void {
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown, code = 400) => reply.code(code).send({ error: (e as Error).message });

  app.get('/api/embeddings/config', async () => emb.publicConfig());
  app.put<{ Body: EmbeddingConfigPatch }>('/api/embeddings/config', async (req) => {
    await emb.saveConfig(req.body ?? {});
    return { ok: true };
  });

  app.get<{ Querystring: { refresh?: string } }>('/api/embeddings/hardware', async (req) => detectHardware(req.query.refresh === '1'));

  app.get('/api/embeddings/status', async () => {
    const c = await emb.config();
    return {
      runtime: emb.runtime.status(),
      llamaBuilds: emb.llama.builds(),
      llama: emb.llama.status(),
      models: installedModels(emb.modelsDir(c)),
      modelsDir: emb.modelsDir(c),
      tasks: emb.tasks.list(),
      key: embeddingKey(c),
    };
  });

  app.get('/api/embeddings/tasks', async () => emb.tasks.list());
  app.delete<{ Params: { id: string } }>('/api/embeddings/tasks/:id', async (req) => ({ ok: emb.tasks.cancel(req.params.id) }));

  // Runtimes
  app.post('/api/embeddings/runtime/onnx', async () => {
    const c = await emb.config();
    return emb.tasks.start('runtime:onnx', 'ONNX Runtime', (ctx) => emb.runtime.install(c, ctx));
  });
  app.delete('/api/embeddings/runtime/onnx', async () => {
    emb.stop();
    emb.runtime.remove();
    return { ok: true };
  });
  app.post('/api/embeddings/runtime/onnx-cuda', async () => {
    const c = await emb.config();
    return emb.tasks.start('runtime:onnx-cuda', 'ONNX Runtime CUDA / TensorRT', (ctx) => emb.runtime.installCuda(c, ctx));
  });
  app.delete('/api/embeddings/runtime/onnx-cuda', async () => {
    emb.stop();
    emb.runtime.removeCuda();
    return { ok: true };
  });
  app.post('/api/embeddings/runtime/llama', async (_req, reply) => {
    const c = await emb.config();
    try {
      const v = await emb.llama.variant(c);
      return emb.tasks.start(`runtime:llama:${v.id}`, `llama.cpp ${v.label}`, async (ctx) => void (await emb.llama.install(c, ctx)));
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.delete<{ Params: { tag: string; variant: string } }>('/api/embeddings/runtime/llama/:tag/:variant', async (req, reply) => {
    try {
      emb.llama.remove(req.params.tag, req.params.variant);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.get('/api/embeddings/llama/devices', async (_req, reply) => {
    try {
      return { output: await emb.llama.listDevices(await emb.config()) };
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.post('/api/embeddings/llama/start', async (_req, reply) => {
    const c = await emb.config();
    try {
      return { url: await emb.llama.ensure(c, emb.modelsDir(c)) };
    } catch (e) {
      return fail(reply, e, 502);
    }
  });
  app.post('/api/embeddings/llama/stop', async () => {
    emb.llama.stop();
    return { ok: true };
  });

  // Models
  app.post<{ Body: { kind: 'onnx' | 'gguf'; repo?: string; dtype?: OnnxDtype; model?: string; quant?: string } }>('/api/embeddings/models', async (req, reply) => {
    const c = await emb.config();
    const dir = emb.modelsDir(c);
    const b = req.body;
    try {
      if (b.kind === 'onnx') {
        const info = embeddingModel(b.repo ?? '');
        const repo = info?.onnx?.repo ?? b.repo ?? '';
        const dtype = b.dtype ?? info?.onnx?.recommended ?? 'fp32';
        return emb.tasks.start(`model:onnx:${repo}:${dtype}`, `${info?.name ?? repo} (${dtype})`, (ctx) => downloadOnnx(c, dir, repo, dtype, ctx));
      }
      const info = embeddingModel(b.model ?? '');
      const file = info?.gguf?.files.find((f) => f.quant === b.quant);
      if (!info?.gguf || !file) throw new Error('Unknown GGUF model');
      return emb.tasks.start(`model:gguf:${info.gguf.repo}:${file.file}`, `${info.name} ${file.quant}`, (ctx) => downloadGguf(c, dir, info.gguf!.repo, file.file, ctx));
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.delete<{ Body: { kind: 'onnx' | 'gguf'; repo: string; dtype?: OnnxDtype; file?: string } }>('/api/embeddings/models', async (req, reply) => {
    const c = await emb.config();
    try {
      emb.stop();
      if (req.body.kind === 'onnx') deleteOnnx(emb.modelsDir(c), req.body.repo, req.body.dtype);
      else deleteGguf(emb.modelsDir(c), req.body.repo, req.body.file ?? '');
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  /** Embed a few sample sentences: checks the setup and shows speed and whether related text scores higher. */
  app.post('/api/embeddings/test', async (_req, reply) => {
    const c = await emb.config();
    const t0 = Date.now();
    try {
      const [a, b, d] = await emb.embed(SAMPLE, 'doc', c);
      const ms = Date.now() - t0;
      const t1 = Date.now();
      await emb.embed([SAMPLE[1]], 'query', c);
      const dot = (x: Float32Array, y: Float32Array) => x.reduce((s, v, i) => s + v * y[i], 0);
      return { dims: a.length, ms, queryMs: Date.now() - t1, related: Math.round(dot(a, b) * 1000) / 1000, unrelated: Math.round(dot(a, d) * 1000) / 1000 };
    } catch (e) {
      return fail(reply, e, 502);
    }
  });

  // Story indexes
  app.post<{ Params: { id: string }; Body: { text: string } }>('/api/vectors/:id/sync', async (req, reply) => {
    const c = await emb.config();
    if (!c.enabled) return fail(reply, new Error('Vector search is off.'));
    try {
      return emb.sync(req.params.id, String(req.body?.text ?? ''), c);
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.post<{ Params: { id: string }; Body: { text?: string } }>('/api/vectors/:id/status', async (req, reply) => {
    try {
      return emb.indexStatus(req.params.id, await emb.config(), req.body?.text);
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.post<{ Params: { id: string }; Body: { query: string } }>('/api/vectors/:id/search', async (req, reply) => {
    const c = await emb.config();
    if (!c.enabled) return { hashes: [], scores: [], indexed: 0 };
    const t0 = Date.now();
    try {
      return { ...(await emb.search(req.params.id, String(req.body?.query ?? ''), c)), ms: Date.now() - t0 };
    } catch (e) {
      return fail(reply, e, 502);
    }
  });
  app.delete<{ Params: { id: string } }>('/api/vectors/:id', async (req, reply) => {
    try {
      emb.dropStory(req.params.id);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.delete('/api/vectors', async () => {
    emb.store.clear();
    return { ok: true };
  });

  app.addHook('onClose', async () => emb.stop());
}
