// Downloads the user started (runtimes, llama.cpp builds, models): progress, cancel, resume.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface TaskInfo {
  id: string;
  /** What it installs, e.g. `onnx-runtime`, `model:bge-m3`. */
  key: string;
  label: string;
  status: 'running' | 'done' | 'error' | 'canceled';
  /** Bytes so far and in total, across all files of the task. */
  received: number;
  total: number;
  /** File being fetched now. */
  current?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface TaskContext {
  signal: AbortSignal;
  /** Add to the expected total once a file's size is known. */
  expect(bytes: number): void;
  progress(bytes: number): void;
  setCurrent(name: string): void;
}

export class Tasks {
  private tasks = new Map<string, TaskInfo & { controller: AbortController }>();

  list(): TaskInfo[] {
    return [...this.tasks.values()].map(({ controller: _c, ...t }) => t).sort((a, b) => b.startedAt - a.startedAt);
  }

  running(key: string): TaskInfo | undefined {
    return this.list().find((t) => t.key === key && t.status === 'running');
  }

  /** Start `run` in the background unless a task with the same key is running; returns the task. */
  start(key: string, label: string, run: (ctx: TaskContext) => Promise<void>): TaskInfo {
    const existing = this.running(key);
    if (existing) return existing;
    // Keep only recent finished tasks.
    for (const [id, t] of this.tasks) if (t.status !== 'running' && Date.now() - (t.endedAt ?? 0) > 10 * 60_000) this.tasks.delete(id);
    const controller = new AbortController();
    const task: TaskInfo & { controller: AbortController } = { id: randomUUID(), key, label, status: 'running', received: 0, total: 0, startedAt: Date.now(), controller };
    this.tasks.set(task.id, task);
    const ctx: TaskContext = {
      signal: controller.signal,
      expect: (n) => void (task.total += n),
      progress: (n) => void (task.received += n),
      setCurrent: (name) => void (task.current = name),
    };
    void run(ctx).then(
      () => {
        task.status = 'done';
        task.endedAt = Date.now();
      },
      (e: Error) => {
        task.status = controller.signal.aborted ? 'canceled' : 'error';
        task.error = controller.signal.aborted ? undefined : e.message;
        task.endedAt = Date.now();
      },
    );
    return this.list().find((t) => t.id === task.id)!;
  }

  cancel(id: string): boolean {
    const t = this.tasks.get(id);
    if (!t || t.status !== 'running') return false;
    t.controller.abort();
    return true;
  }

  /** Wait for a task to end (tests and installs that chain). */
  async wait(id: string): Promise<TaskInfo> {
    for (;;) {
      const t = this.list().find((x) => x.id === id);
      if (!t || t.status !== 'running') return t!;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

export interface DownloadOptions {
  ctx?: TaskContext;
  headers?: Record<string, string>;
  /** Expected size, when known ahead (counted into the task total). */
  size?: number;
  /** `sha256` hex or an npm `sha512-<base64>` integrity string to verify. */
  integrity?: string;
}

/**
 * Download `url` to `dest`. Data goes to `dest.part` first, so an interrupted download resumes from where it
 * stopped (when the server allows ranges) and `dest` only appears once it is complete.
 */
export async function download(url: string, dest: string, opts: DownloadOptions = {}): Promise<void> {
  const part = `${dest}.part`;
  mkdirSync(dirname(dest), { recursive: true });
  let have = existsSync(part) ? statSync(part).size : 0;
  const headers: Record<string, string> = { 'user-agent': 'NovelWriter', ...opts.headers };
  if (have) headers.range = `bytes=${have}-`;
  const res = await fetch(url, { headers, signal: opts.ctx?.signal, redirect: 'follow' });
  if (res.status === 416 && have) {
    // Already complete.
  } else if (!res.ok) {
    throw new Error(`Download failed (HTTP ${res.status}): ${url}`);
  } else {
    if (have && res.status !== 206) have = 0;
    const len = Number(res.headers.get('content-length') ?? 0);
    const total = have + (len || opts.size || 0);
    opts.ctx?.expect(total);
    opts.ctx?.progress(have);
    if (!res.body) throw new Error(`Empty response: ${url}`);
    const body = Readable.fromWeb(res.body as never);
    body.on('data', (c: Buffer) => opts.ctx?.progress(c.length));
    await pipeline(body, createWriteStream(part, { flags: have ? 'a' : 'w' }), { signal: opts.ctx?.signal });
  }
  if (opts.integrity) {
    const ok = await verify(part, opts.integrity);
    if (!ok) {
      await rm(part, { force: true });
      throw new Error(`Checksum mismatch: ${url}`);
    }
  }
  await rename(part, dest);
}

async function verify(file: string, integrity: string): Promise<boolean> {
  const [algo, expected] = integrity.includes('-') ? [integrity.slice(0, integrity.indexOf('-')), integrity.slice(integrity.indexOf('-') + 1)] : ['sha256', integrity];
  const h = createHash(algo);
  await pipeline(createReadStream(file), h);
  const digest = h.digest();
  return integrity.includes('-') ? digest.toString('base64') === expected : digest.toString('hex') === expected.toLowerCase();
}
