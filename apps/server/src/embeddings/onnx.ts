// The built-in ONNX engine: transformers.js on ONNX Runtime, installed into the data folder on request (it is
// not shipped with the app) and run in a child process, so a crash in a GPU or NPU driver can't take the server
// down with it.
import { fork, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { embeddingModel, type EmbeddingConfig, type OnnxDtype, type OnnxEmbeddingConfig } from '@novelwriter/core';
import { extractArchive } from './archive.ts';
import { download, type TaskContext } from './tasks.ts';

export const ORT_VERSION = '1.30.0';
export const TRANSFORMERS_VERSION = '4.3.1';

const PACKAGES: { name: string; version: string }[] = [
  { name: '@huggingface/transformers', version: TRANSFORMERS_VERSION },
  { name: 'onnxruntime-node', version: ORT_VERSION },
  { name: 'onnxruntime-common', version: ORT_VERSION },
];

const CUDA_LIBS = ['libonnxruntime_providers_cuda.so', 'libonnxruntime_providers_shared.so', 'libonnxruntime_providers_tensorrt.so'];

export interface OnnxRuntimeStatus {
  installed: boolean;
  version: string;
  dir: string;
  sizeMB: number;
  /** Linux x64: CUDA / TensorRT provider libraries installed. */
  cudaProviders: boolean;
  cudaAvailable: boolean;
}

export class OnnxRuntime {
  readonly dir: string;

  constructor(private readonly dataDir: string) {
    this.dir = join(dataDir, 'runtimes', `onnx-${ORT_VERSION}`);
  }

  private get binDir(): string {
    return join(this.dir, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', process.platform, process.arch);
  }

  installed(): boolean {
    return existsSync(join(this.dir, 'installed.json'));
  }

  status(): OnnxRuntimeStatus {
    return {
      installed: this.installed(),
      version: `onnxruntime ${ORT_VERSION} · transformers.js ${TRANSFORMERS_VERSION}`,
      dir: this.dir,
      sizeMB: this.installed() ? Math.round(dirSize(this.dir) / 1048576) : 0,
      cudaProviders: CUDA_LIBS.every((f) => existsSync(join(this.binDir, f))),
      cudaAvailable: process.platform === 'linux' && process.arch === 'x64',
    };
  }

  /** Download the runtime packages from the npm registry (checked against their published hashes). */
  async install(cfg: EmbeddingConfig, ctx: TaskContext): Promise<void> {
    const registry = cfg.npmRegistry.replace(/\/+$/, '') || 'https://registry.npmjs.org';
    const staging = `${this.dir}.staging`;
    rmSync(staging, { recursive: true, force: true });
    const nm = join(staging, 'node_modules');
    for (const p of PACKAGES) {
      ctx.setCurrent(`${p.name}@${p.version}`);
      const res = await fetch(`${registry}/${p.name.replace('/', '%2F')}/${p.version}`, { signal: ctx.signal });
      if (!res.ok) throw new Error(`npm registry: HTTP ${res.status} for ${p.name}`);
      const meta = (await res.json()) as { dist: { tarball: string; integrity?: string } };
      const tgz = join(staging, 'downloads', `${p.name.replace('/', '-')}-${p.version}.tgz`);
      await download(meta.dist.tarball, tgz, { ctx, integrity: meta.dist.integrity });
      // Native binaries of other platforms are most of onnxruntime-node's size.
      const own = `bin/napi-v6/${process.platform}/${process.arch}/`;
      await extractArchive(tgz, join(nm, ...p.name.split('/')), { strip: 1, filter: (n) => !n.startsWith('bin/') || n.startsWith(own) });
    }
    // transformers.js imports sharp for images; text embeddings never use it.
    mkdirSync(join(nm, 'sharp'), { recursive: true });
    writeFileSync(join(nm, 'sharp', 'package.json'), JSON.stringify({ name: 'sharp', version: '0.0.0', main: 'index.js' }));
    writeFileSync(join(nm, 'sharp', 'index.js'), "module.exports = function () { throw new Error('Images are not supported'); };\n");
    rmSync(join(staging, 'downloads'), { recursive: true, force: true });
    writeFileSync(join(staging, 'installed.json'), JSON.stringify({ ort: ORT_VERSION, transformers: TRANSFORMERS_VERSION, at: Date.now() }));
    rmSync(this.dir, { recursive: true, force: true });
    cpSync(staging, this.dir, { recursive: true, verbatimSymlinks: true });
    rmSync(staging, { recursive: true, force: true });
  }

  /** Linux x64: ONNX Runtime's CUDA and TensorRT providers, from Microsoft's NuGet package. */
  async installCuda(cfg: EmbeddingConfig, ctx: TaskContext): Promise<void> {
    if (!this.installed()) throw new Error('Install the ONNX runtime first.');
    if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('The CUDA provider is available on Linux x64. On Windows use DirectML.');
    const feed = cfg.nugetFeed.replace(/\/+$/, '') || 'https://api.nuget.org/v3-flatcontainer';
    const id = 'microsoft.ml.onnxruntime.gpu.linux';
    const pkg = join(this.dir, 'downloads', `${id}.${ORT_VERSION}.nupkg`);
    ctx.setCurrent(`Microsoft.ML.OnnxRuntime.Gpu.Linux ${ORT_VERSION}`);
    await download(`${feed}/${id}/${ORT_VERSION}/${id}.${ORT_VERSION}.nupkg`, pkg, { ctx });
    const tmp = join(this.dir, 'downloads', 'cuda');
    await extractArchive(pkg, tmp, { filter: (n) => CUDA_LIBS.some((f) => n === `runtimes/linux-x64/native/${f}`) });
    for (const f of CUDA_LIBS) cpSync(join(tmp, 'runtimes', 'linux-x64', 'native', f), join(this.binDir, f));
    rmSync(join(this.dir, 'downloads'), { recursive: true, force: true });
  }

  removeCuda(): void {
    for (const f of CUDA_LIBS) rmSync(join(this.binDir, f), { force: true });
  }

  remove(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }

  /**
   * The directory a worker runs from: the installed runtime, or, with a custom ONNX Runtime build (QNN and other
   * providers), a copy of it whose onnxruntime-node is that build.
   */
  workerDir(custom: string): string {
    if (!custom.trim()) return this.dir;
    const src = custom.trim();
    if (!existsSync(join(src, 'package.json')) || !existsSync(join(src, 'dist'))) throw new Error(`Not an onnxruntime-node package folder: ${src}`);
    const dir = join(this.dataDir, 'runtimes', 'onnx-custom');
    const stamp = `${src}|${statSync(join(src, 'package.json')).mtimeMs}`;
    const marker = join(dir, 'source.txt');
    if (!existsSync(marker) || readFileSync(marker, 'utf8') !== stamp) {
      rmSync(dir, { recursive: true, force: true });
      for (const p of ['@huggingface/transformers', 'onnxruntime-common', 'sharp']) cpSync(join(this.dir, 'node_modules', p), join(dir, 'node_modules', p), { recursive: true });
      cpSync(src, join(dir, 'node_modules', 'onnxruntime-node'), { recursive: true, dereference: true, filter: (f) => !relative(src, f).startsWith('node_modules') });
      writeFileSync(marker, stamp);
    }
    return dir;
  }
}

export function dirSize(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) total += statSync(p).size;
    }
  };
  walk(dir);
  return total;
}

// ------------------------------------------------------------- session options

/** ONNX Runtime session options and execution providers for the settings. */
export function sessionOptions(o: OnnxEmbeddingConfig): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    graphOptimizationLevel: o.graphOptimization,
    executionMode: o.executionMode,
    enableCpuMemArena: o.memArena,
    enableMemPattern: o.memPattern,
    logSeverityLevel: o.logLevel,
  };
  if (o.intraOpThreads > 0) opts.intraOpNumThreads = o.intraOpThreads;
  if (o.interOpThreads > 0) opts.interOpNumThreads = o.interOpThreads;
  const providers = executionProviders(o);
  if (providers) opts.executionProviders = providers;
  return opts;
}

export function executionProviders(o: OnnxEmbeddingConfig): unknown[] | undefined {
  const cpu = o.cpuFallback ? [{ name: 'cpu', useArena: o.memArena }] : [];
  switch (o.device) {
    case 'auto':
      return undefined;
    case 'cpu':
      return [{ name: 'cpu', useArena: o.memArena }];
    case 'webgpu':
      return [{ name: 'webgpu', preferredLayout: o.webgpuLayout }, ...cpu];
    case 'dml':
    case 'cuda':
      return [{ name: o.device, deviceId: o.deviceId }, ...cpu];
    case 'tensorrt':
      // TensorRT falls back to CUDA for what it can't build an engine for.
      return [{ name: 'tensorrt', deviceId: o.deviceId }, { name: 'cuda', deviceId: o.deviceId }, ...cpu];
    case 'coreml': {
      let flags = 0;
      if (o.coremlUnits === 'cpu') flags |= 0x001;
      if (o.coremlSubgraphs) flags |= 0x002;
      if (o.coremlUnits === 'ane') flags |= 0x004;
      if (o.coremlStaticShapes) flags |= 0x008;
      if (o.coremlMlProgram) flags |= 0x010;
      if (o.coremlUnits === 'cpu-gpu') flags |= 0x020;
      return [{ name: 'coreml', coreMlFlags: flags }, ...cpu];
    }
    case 'qnn':
      return [
        o.qnnBackendPath.trim() ? { name: 'qnn', backendPath: o.qnnBackendPath.trim(), enableFp16Precision: o.qnnFp16 } : { name: 'qnn', backendType: o.qnnBackend, enableFp16Precision: o.qnnFp16 },
        ...cpu,
      ];
    case 'custom': {
      const list = JSON.parse(o.customProviders || '[]') as unknown;
      if (!Array.isArray(list) || !list.length) throw new Error('Custom execution providers must be a JSON array, e.g. [{"name":"qnn","backendType":"htp"},"cpu"]');
      return list;
    }
  }
}

/** transformers.js `device`: the stock runtime refuses providers it was not told about, so pass the closest one. */
function transformersDevice(o: OnnxEmbeddingConfig): string {
  if (o.device === 'auto') return 'auto';
  if (o.device === 'dml' || o.device === 'cuda' || o.device === 'coreml' || o.device === 'webgpu') return o.device;
  if (o.device === 'tensorrt') return 'cuda';
  return 'cpu';
}

export function resolveDtype(o: OnnxEmbeddingConfig): OnnxDtype {
  if (o.dtype !== 'auto') return o.dtype;
  const m = embeddingModel(o.model);
  if (m?.onnx) return m.onnx.recommended;
  return 'fp32';
}

/** Hugging Face repo of the configured ONNX model. */
export function onnxRepo(o: OnnxEmbeddingConfig): string {
  return embeddingModel(o.model)?.onnx?.repo ?? o.model;
}

// ------------------------------------------------------------- worker

const WORKER = `// Written by NovelWriter: runs text embedding models for the server.
const t = await import('./node_modules/@huggingface/transformers/dist/transformers.node.mjs');
let tok = null;
let model = null;
let info = null;
const reply = (m) => process.send(m);

function pool(out, mask, pooling) {
  if (out.sentence_embedding && pooling === 'auto') return out.sentence_embedding.to('float32').tolist();
  let h = out.last_hidden_state ?? out.token_embeddings ?? out.logits;
  if (!h) throw new Error('The model has no hidden-state output');
  if (h.type !== 'float32') h = h.to('float32');
  const [B, L, D] = h.dims;
  const data = h.data;
  const m = mask.tolist().map((r) => r.map(Number));
  const mode = pooling === 'auto' ? info.pooling : pooling;
  const out2 = [];
  for (let b = 0; b < B; b++) {
    const v = new Float32Array(D);
    if (mode === 'cls') v.set(data.subarray(b * L * D, b * L * D + D));
    else if (mode === 'last') {
      let idx = 0;
      for (let i = 0; i < L; i++) if (m[b][i]) idx = i;
      v.set(data.subarray((b * L + idx) * D, (b * L + idx + 1) * D));
    } else {
      let n = 0;
      for (let i = 0; i < L; i++) {
        if (!m[b][i]) continue;
        n++;
        const o = (b * L + i) * D;
        for (let d = 0; d < D; d++) v[d] += data[o + d];
      }
      for (let d = 0; d < D; d++) v[d] /= n || 1;
    }
    out2.push(v);
  }
  return out2;
}

process.on('message', async (msg) => {
  try {
    if (msg.type === 'load') {
      t.env.allowRemoteModels = false;
      t.env.allowLocalModels = true;
      t.env.localModelPath = msg.modelsDir;
      t.env.useFSCache = false;
      t.env.useBrowserCache = false;
      if (t.env.backends?.onnx) t.env.backends.onnx.logSeverityLevel = msg.logLevel;
      tok = await t.AutoTokenizer.from_pretrained(msg.repo);
      model = await t.AutoModel.from_pretrained(msg.repo, {
        dtype: msg.dtype,
        device: msg.device,
        session_options: msg.sessionOptions,
        use_external_data_format: msg.externalData ? 1 : undefined,
      });
      info = { pooling: msg.pooling };
      reply({ id: msg.id, ok: true });
    } else if (msg.type === 'embed') {
      const inp = tok(msg.texts, { padding: true, truncation: true, max_length: msg.maxLength });
      const out = await model(inp);
      const vectors = pool(out, inp.attention_mask, msg.pooling).map((v) => Float32Array.from(v));
      reply({ id: msg.id, ok: true, vectors });
    } else if (msg.type === 'count') {
      reply({ id: msg.id, ok: true, counts: msg.texts.map((x) => tok.encode(x).length) });
    }
  } catch (e) {
    reply({ id: msg.id, ok: false, error: String(e && e.message || e) });
  }
});
reply({ type: 'ready' });
`;

export interface OnnxLoadInfo {
  repo: string;
  dtype: OnnxDtype;
  device: string;
}

/** One loaded model in a worker process. */
export class OnnxWorker {
  private child: ChildProcess | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private stderr = '';
  readonly loaded: Promise<void>;
  readonly info: OnnxLoadInfo;

  constructor(runtime: OnnxRuntime, cfg: EmbeddingConfig, modelsDir: string) {
    const o = cfg.onnx;
    const m = embeddingModel(o.model);
    const info = { repo: onnxRepo(o), dtype: resolveDtype(o), device: o.device };
    this.info = info;
    this.loaded = (async () => {
      if (!runtime.installed()) throw new Error('The ONNX runtime is not installed. Install it in Settings → Vector Search.');
      const dir = runtime.workerDir(o.customRuntime);
      const file = join(dir, 'embed-worker.mjs');
      writeFileSync(file, WORKER);
      const child = fork(file, [], {
        cwd: dir,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      this.child = child;
      child.stderr?.on('data', (d: Buffer) => {
        this.stderr = (this.stderr + d.toString()).slice(-4000);
      });
      child.on('message', (msg: Record<string, unknown>) => {
        const p = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined;
        if (!p) return;
        this.pending.delete(msg.id as number);
        if (msg.ok) p.resolve(msg);
        else p.reject(new Error(String(msg.error)));
      });
      child.on('exit', (code, signal) => {
        const err = new Error(`The embedding worker stopped (${signal ?? `exit code ${code}`}). ${this.stderr.trim().split('\n').slice(-3).join(' ')}`.trim());
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.child = null;
      });
      await this.call({
        type: 'load',
        modelsDir: `${modelsDir.replace(/[\\/]+$/, '')}/`,
        repo: info.repo,
        dtype: info.dtype,
        device: transformersDevice(o),
        sessionOptions: sessionOptions(o),
        externalData: Boolean(m?.onnx?.externalData),
        pooling: m?.pooling ?? 'mean',
        logLevel: o.logLevel,
      });
    })();
    this.loaded.catch(() => this.stop());
  }

  private call(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('The embedding worker is not running.'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.send({ ...msg, id });
    });
  }

  async embed(texts: string[], pooling: string, maxLength: number): Promise<Float32Array[]> {
    await this.loaded;
    return (await this.call({ type: 'embed', texts, pooling, maxLength })).vectors as Float32Array[];
  }

  alive(): boolean {
    return this.child !== null;
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }
}
