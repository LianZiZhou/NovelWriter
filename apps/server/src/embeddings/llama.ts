// A llama.cpp server for embeddings, run by NovelWriter: the prebuilt release for this machine's hardware is
// downloaded on request (CPU, CUDA, Vulkan, ROCm, SYCL, OpenVINO, Metal, Snapdragon…), or a binary the user has.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { LLAMA_VARIANTS, embeddingModel, type EmbeddingConfig, type LlamaVariant } from '@novelwriter/core';
import { extractArchive } from './archive.ts';
import { detectHardware } from './hardware.ts';
import { ggufPath } from './models.ts';
import { dirSize } from './onnx.ts';
import { download, type TaskContext } from './tasks.ts';

const REPO = 'ggml-org/llama.cpp';
const EXE = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

interface Asset {
  name: string;
  url: string;
  size?: number;
}

export interface LlamaBuild {
  tag: string;
  variant: string;
  dir: string;
  binDir: string;
  sizeMB: number;
  installedAt: number;
}

export interface LlamaStatus {
  running: boolean;
  starting: boolean;
  pid?: number;
  url?: string;
  model?: string;
  binary?: string;
  args?: string[];
  startedAt?: number;
  error?: string;
  log: string;
}

/** Split a command-line string into arguments, honouring quotes. */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : (m[2] ?? m[3]));
  return out;
}

function parseEnv(s: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of s.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

function findFile(dir: string, name: string): string | null {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name === name) return dir;
    if (e.isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    }
  }
  return null;
}

/** Servers still running when NovelWriter exits are stopped with it. */
const children = new Set<ChildProcess>();
let exitHook = false;
function track(child: ChildProcess) {
  children.add(child);
  child.once('exit', () => children.delete(child));
  if (exitHook) return;
  exitHook = true;
  process.once('exit', () => {
    for (const c of children) c.kill();
  });
}

export class LlamaManager {
  readonly dir: string;
  private child: ChildProcess | null = null;
  private state: LlamaStatus = { running: false, starting: false, log: '' };
  private ready: Promise<string> | null = null;
  /** Settings the running server was started with, to restart when they change. */
  private signature = '';
  private lastUsed = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'runtimes', 'llama.cpp');
  }

  async variant(cfg: EmbeddingConfig): Promise<LlamaVariant> {
    let id = cfg.llama.variant;
    if (id === 'auto') id = (await detectHardware()).suggest.llamaVariant;
    const v = LLAMA_VARIANTS.find((x) => x.id === id);
    if (!v) throw new Error(`No llama.cpp build "${id}" for ${process.platform}/${process.arch}.`);
    return v;
  }

  builds(): LlamaBuild[] {
    if (!existsSync(this.dir)) return [];
    const out: LlamaBuild[] = [];
    for (const d of readdirSync(this.dir)) {
      const marker = join(this.dir, d, 'build.json');
      if (!existsSync(marker)) continue;
      try {
        const b = JSON.parse(readFileSync(marker, 'utf8')) as Omit<LlamaBuild, 'dir' | 'sizeMB'>;
        out.push({ ...b, dir: join(this.dir, d), sizeMB: Math.round(dirSize(join(this.dir, d)) / 1048576) });
      } catch {
        /* broken install */
      }
    }
    return out.sort((a, b) => b.installedAt - a.installedAt);
  }

  private mirror(cfg: EmbeddingConfig, url: string): string {
    const m = cfg.llama.mirror.trim();
    return m ? `${m.replace(/\/?$/, '/')}${url}` : url;
  }

  /** The release asset (and CUDA runtime) for a build: the pinned tag, or the newest release that has one. */
  async resolve(cfg: EmbeddingConfig, v: LlamaVariant, signal?: AbortSignal): Promise<{ tag: string; asset: Asset; cudart?: Asset }> {
    const re = new RegExp(`^llama-(b\\d+)-bin-(${v.pattern})$`);
    const pick = (tag: string, assets: Asset[]) => {
      const asset = assets.find((a) => re.test(a.name));
      if (!asset) return null;
      const middle = re.exec(asset.name)![2].replace(/\.(zip|tar\.gz)$/, '');
      const cudart = v.cudart ? assets.find((a) => a.name.startsWith('cudart-') && a.name.includes(middle)) : undefined;
      return { tag, asset, cudart };
    };
    const tag = cfg.llama.release.trim();
    const api = async (path: string) => {
      const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'NovelWriter' };
      // Unauthenticated requests are limited to 60 an hour per address; a token raises that.
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, { headers, signal });
      if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
      return res.json() as Promise<unknown>;
    };
    type Release = { tag_name: string; assets: { name: string; browser_download_url: string; size: number }[] };
    const assetsOf = (r: Release): Asset[] => r.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
    if (tag && tag !== 'latest') {
      try {
        const r = (await api(`releases/tags/${encodeURIComponent(tag)}`)) as Release;
        const found = pick(r.tag_name, assetsOf(r));
        if (found) return found;
        throw new Error(`Release ${tag} has no ${v.label} build.`);
      } catch (e) {
        if (signal?.aborted || /has no/.test((e as Error).message)) throw e;
        // No API access (rate limit, blocked): read the release's asset list page instead.
        const res = await fetch(this.mirror(cfg, `https://github.com/${REPO}/releases/expanded_assets/${encodeURIComponent(tag)}`), { signal });
        const html = res.ok ? await res.text() : '';
        const names = [...html.matchAll(/releases\/download\/[^/"]+\/([^"?]+)"/g)].map((m) => decodeURIComponent(m[1]));
        const found = pick(tag, [...new Set(names)].map((name) => ({ name, url: `https://github.com/${REPO}/releases/download/${tag}/${name}` })));
        if (found) return found;
        throw new Error(`Couldn't read release ${tag} from GitHub (${(e as Error).message}).`);
      }
    }
    const releases = (await api('releases?per_page=30')) as Release[];
    for (const r of releases) {
      const found = pick(r.tag_name, assetsOf(r));
      if (found) return found;
    }
    throw new Error(`No recent llama.cpp release has a ${v.label} build for this system. Pin a release tag in the settings.`);
  }

  async install(cfg: EmbeddingConfig, ctx: TaskContext): Promise<LlamaBuild> {
    const v = await this.variant(cfg);
    ctx.setCurrent('GitHub releases');
    const r = await this.resolve(cfg, v, ctx.signal);
    const dir = join(this.dir, `${r.tag}-${v.id}`);
    const staging = `${dir}.staging`;
    rmSync(staging, { recursive: true, force: true });
    for (const a of [r.asset, r.cudart].filter((x): x is Asset => !!x)) {
      ctx.setCurrent(a.name);
      const file = join(staging, 'downloads', a.name);
      await download(this.mirror(cfg, a.url), file, { ctx, size: a.size });
      await extractArchive(file, join(staging, a === r.asset ? 'bin' : 'cudart'));
    }
    const binDir = findFile(join(staging, 'bin'), EXE);
    if (!binDir) throw new Error(`${r.asset.name} has no ${EXE}.`);
    // The CUDA runtime libraries go next to the server binary, where it looks for them.
    if (existsSync(join(staging, 'cudart'))) {
      const copyAll = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) copyAll(p);
          else cpSync(p, join(binDir, e.name), { verbatimSymlinks: true });
        }
      };
      copyAll(join(staging, 'cudart'));
    }
    if (process.platform !== 'win32') {
      for (const f of readdirSync(binDir)) {
        const p = join(binDir, f);
        try {
          if (statSync(p).isFile() && (f.startsWith('llama-') || f.includes('.so') || f.endsWith('.dylib'))) chmodSync(p, 0o755);
        } catch {
          /* dangling link */
        }
      }
    }
    if (process.platform === 'darwin') await new Promise((res) => execFile('xattr', ['-dr', 'com.apple.quarantine', staging], () => res(null)));
    rmSync(join(staging, 'downloads'), { recursive: true, force: true });
    const rel = binDir.slice(staging.length + 1);
    const build = { tag: r.tag, variant: v.id, binDir: rel, installedAt: Date.now() };
    writeFileSync(join(staging, 'build.json'), JSON.stringify(build));
    this.stop();
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    cpSync(staging, dir, { recursive: true, verbatimSymlinks: true });
    rmSync(staging, { recursive: true, force: true });
    return { ...build, dir, binDir: join(dir, rel), sizeMB: Math.round(dirSize(dir) / 1048576) };
  }

  remove(tag: string, variant: string): void {
    if (!/^[\w.-]+$/.test(tag) || !/^[\w.-]+$/.test(variant)) throw new Error('Invalid build');
    this.stop();
    rmSync(join(this.dir, `${tag}-${variant}`), { recursive: true, force: true });
  }

  /** The llama-server binary the settings point to. */
  async binary(cfg: EmbeddingConfig): Promise<string> {
    if (cfg.llama.binary === 'custom') {
      const p = cfg.llama.customBinary.trim();
      if (!p || !existsSync(p)) throw new Error(`llama-server not found at "${p}".`);
      return p;
    }
    const v = await this.variant(cfg);
    const tag = cfg.llama.release.trim();
    const b = this.builds().find((x) => x.variant === v.id && (!tag || tag === 'latest' || x.tag === tag));
    if (!b) throw new Error(`The llama.cpp ${v.label} build is not installed. Install it in Settings → Vector Search.`);
    return join(b.dir, b.binDir, EXE);
  }

  /** The GGUF file the settings point to. */
  modelPath(cfg: EmbeddingConfig, modelsDir: string): string {
    const m = cfg.llama.model;
    if (m.startsWith('path:')) {
      const p = m.slice(5).trim();
      if (!existsSync(p)) throw new Error(`Model file not found: ${p}`);
      return p;
    }
    const [id, quant] = m.split(':');
    const info = embeddingModel(id);
    const file = info?.gguf?.files.find((f) => f.quant === quant) ?? info?.gguf?.files.find((f) => f.quant === info.gguf!.recommended);
    if (!info?.gguf || !file) throw new Error(`Unknown GGUF model ${m}.`);
    const p = ggufPath(modelsDir, info.gguf.repo, file.file);
    if (!existsSync(p)) throw new Error(`${info.name} ${file.quant} is not downloaded. Download it in Settings → Vector Search.`);
    return p;
  }

  args(cfg: EmbeddingConfig, model: string, port: number): string[] {
    const l = cfg.llama;
    const a = ['-m', model, '--embedding', '--host', '127.0.0.1', '--port', String(port)];
    if (l.gpuLayers >= 0) a.push('-ngl', String(l.gpuLayers));
    if (l.device.trim()) a.push('--device', l.device.trim());
    if (l.splitMode !== 'default') a.push('-sm', l.splitMode);
    if (l.mainGpu > 0) a.push('-mg', String(l.mainGpu));
    if (l.tensorSplit.trim()) a.push('-ts', l.tensorSplit.trim());
    if (l.threads > 0) a.push('-t', String(l.threads));
    if (l.threadsBatch > 0) a.push('-tb', String(l.threadsBatch));
    if (l.ctxSize > 0) a.push('-c', String(l.ctxSize));
    if (l.batchSize > 0) a.push('-b', String(l.batchSize));
    // Embedding models without causal attention need a whole input in one micro-batch.
    if (l.ubatchSize > 0) a.push('-ub', String(l.ubatchSize));
    if (l.parallel > 0) a.push('-np', String(l.parallel));
    if (l.pooling !== 'auto') a.push('--pooling', l.pooling);
    if (l.flashAttn !== 'auto') a.push('-fa', l.flashAttn);
    if (l.mlock) a.push('--mlock');
    if (!l.mmap) a.push('--no-mmap');
    a.push(...splitArgs(l.extraArgs));
    return a;
  }

  private env(cfg: EmbeddingConfig, binary: string): NodeJS.ProcessEnv {
    const dir = join(binary, '..');
    const env: NodeJS.ProcessEnv = { ...process.env, ...parseEnv(cfg.llama.env) };
    // Shared libraries ship next to the binary.
    if (process.platform === 'linux') env.LD_LIBRARY_PATH = [dir, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = [dir, env.DYLD_LIBRARY_PATH].filter(Boolean).join(':');
    if (process.platform === 'win32') env.PATH = [dir, env.PATH].filter(Boolean).join(';');
    return env;
  }

  /** Devices the configured build can use (`--list-devices`). */
  async listDevices(cfg: EmbeddingConfig): Promise<string> {
    const bin = await this.binary(cfg);
    return new Promise((resolve) => {
      execFile(bin, ['--list-devices'], { env: this.env(cfg, bin), timeout: 30000, windowsHide: true, cwd: join(bin, '..') }, (err, stdout, stderr) =>
        resolve(`${stdout}${stderr}`.trim() || (err ? err.message : '')),
      );
    });
  }

  status(): LlamaStatus {
    return { ...this.state, running: this.child !== null && !this.state.starting };
  }

  /** The server's base URL, starting it (or restarting it with new settings) when needed. */
  async ensure(cfg: EmbeddingConfig, modelsDir: string): Promise<string> {
    const binary = await this.binary(cfg);
    const model = this.modelPath(cfg, modelsDir);
    const sig = JSON.stringify([binary, model, cfg.llama]);
    if (this.ready && sig === this.signature && this.child) {
      this.touch(cfg);
      return this.ready;
    }
    this.stop();
    this.signature = sig;
    this.ready = this.start(cfg, binary, model);
    this.ready.catch(() => {
      this.ready = null;
      this.signature = '';
    });
    this.touch(cfg);
    return this.ready;
  }

  private touch(cfg: EmbeddingConfig) {
    this.lastUsed = Date.now();
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    const minutes = cfg.llama.idleMinutes;
    if (minutes > 0) {
      this.idleTimer = setInterval(() => {
        if (Date.now() - this.lastUsed > minutes * 60_000) this.stop();
      }, 30_000);
      this.idleTimer.unref();
    }
  }

  private async start(cfg: EmbeddingConfig, binary: string, model: string): Promise<string> {
    const port = cfg.llama.port > 0 ? cfg.llama.port : await freePort();
    const args = this.args(cfg, model, port);
    const url = `http://127.0.0.1:${port}`;
    this.state = { running: false, starting: true, binary, model, args, url, startedAt: Date.now(), log: '' };
    const child = spawn(binary, args, { cwd: join(binary, '..'), env: this.env(cfg, binary), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    track(child);
    const append = (d: Buffer) => {
      this.state.log = (this.state.log + d.toString()).slice(-20000);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    let exited: string | null = null;
    child.on('error', (e) => (exited = e.message));
    child.on('exit', (code, signal) => {
      exited = `llama-server stopped (${signal ?? `exit code ${code}`})`;
      if (this.child === child) {
        this.child = null;
        this.state = { ...this.state, running: false, starting: false, error: exited };
        this.ready = null;
        this.signature = '';
      }
    });
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      if (exited) throw new Error(`${exited}. ${this.state.log.trim().split('\n').slice(-4).join(' ')}`);
      try {
        const r = await fetch(`${url}/health`);
        if (r.ok) {
          this.state = { ...this.state, starting: false, running: true, error: undefined };
          return url;
        }
      } catch {
        /* not listening yet */
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    this.stop();
    throw new Error('llama-server did not become ready in time.');
  }

  stop(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.ready = null;
    this.signature = '';
    this.state = { ...this.state, running: false, starting: false };
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
  }
}
