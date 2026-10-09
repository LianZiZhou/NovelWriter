// Passage vectors per story, kept in one file per story and embedding setup. A novel of a million characters is
// about 2,500 passages, a few MB: searched by brute force in milliseconds, no vector database needed.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dot } from '@novelwriter/core';

export interface StoryIndex {
  key: string;
  dims: number;
  vectors: Map<string, Float32Array>;
  updatedAt: number;
}

function check(id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error('Invalid id');
  return id;
}

export class VectorStore {
  private cache = new Map<string, StoryIndex>();

  constructor(readonly dir: string) {}

  private file(storyId: string, key: string): string {
    return join(this.dir, check(storyId), `${check(key)}.json`);
  }

  get(storyId: string, key: string): StoryIndex {
    const k = `${storyId}/${key}`;
    let idx = this.cache.get(k);
    if (idx) return idx;
    idx = { key, dims: 0, vectors: new Map(), updatedAt: 0 };
    const f = this.file(storyId, key);
    if (existsSync(f)) {
      try {
        const raw = JSON.parse(readFileSync(f, 'utf8')) as { dims: number; updatedAt: number; vectors: Record<string, string> };
        idx.dims = raw.dims;
        idx.updatedAt = raw.updatedAt;
        for (const [h, b64] of Object.entries(raw.vectors)) {
          const buf = Buffer.from(b64, 'base64');
          idx.vectors.set(h, new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
        }
      } catch {
        /* corrupt index: rebuild */
      }
    }
    this.cache.set(k, idx);
    // Only the latest few stories stay in memory.
    if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
    return idx;
  }

  async save(storyId: string, idx: StoryIndex): Promise<void> {
    const f = this.file(storyId, idx.key);
    mkdirSync(join(this.dir, check(storyId)), { recursive: true });
    const vectors: Record<string, string> = {};
    for (const [h, v] of idx.vectors) vectors[h] = Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
    const tmp = `${f}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ dims: idx.dims, updatedAt: idx.updatedAt, vectors }));
    await rename(tmp, f);
  }

  search(idx: StoryIndex, query: Float32Array, topK: number, minScore: number): { hash: string; score: number }[] {
    const out: { hash: string; score: number }[] = [];
    for (const [hash, v] of idx.vectors) {
      if (v.length !== query.length) continue;
      const score = dot(query, v);
      if (score >= minScore) out.push({ hash, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  drop(storyId: string): void {
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${storyId}/`)) this.cache.delete(k);
    rmSync(join(this.dir, check(storyId)), { recursive: true, force: true });
  }

  clear(): void {
    this.cache.clear();
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** Stories with an index, and the indexes' total size. */
  stories(): string[] {
    return existsSync(this.dir) ? readdirSync(this.dir) : [];
  }
}
