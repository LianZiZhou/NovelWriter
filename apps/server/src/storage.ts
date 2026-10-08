import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { docText, migrateStory, type Preset, type Shelf, type Story, type StoryMeta } from '@novelwriter/core';

/** JSON-file persistence under a data directory. Writes are atomic (temp + rename). */
export class Storage {
  constructor(readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(join(this.dir, 'stories'), { recursive: true });
  }

  private path(...p: string[]): string {
    return join(this.dir, ...p);
  }

  async readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(this.path(file), 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  async writeJson(file: string, data: unknown): Promise<void> {
    const p = this.path(file);
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, p);
  }

  // ------------------------------------------------------------- stories

  private storyFile(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error('Invalid story id');
    return join('stories', `${id}.json`);
  }

  async listStories(): Promise<StoryMeta[]> {
    const files = existsSync(this.path('stories')) ? await readdir(this.path('stories')) : [];
    const metas: StoryMeta[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const s = await this.readJson<Story | null>(join('stories', f), null);
      if (s) metas.push(toMeta(s));
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getStory(id: string): Promise<Story | null> {
    const s = await this.readJson<Story | null>(this.storyFile(id), null);
    return s ? migrateStory(s) : null;
  }

  async putStory(story: Story): Promise<StoryMeta> {
    await this.writeJson(this.storyFile(story.id), story);
    return toMeta(story);
  }

  async deleteStory(id: string): Promise<void> {
    await rm(this.path(this.storyFile(id)), { force: true });
  }

  // ------------------------------------------------------------- misc collections

  getSettings(): Promise<Record<string, unknown>> {
    return this.readJson('settings.json', {});
  }
  putSettings(s: Record<string, unknown>): Promise<void> {
    return this.writeJson('settings.json', s);
  }
  getPresets(): Promise<Preset[]> {
    return this.readJson('presets.json', []);
  }
  putPresets(p: Preset[]): Promise<void> {
    return this.writeJson('presets.json', p);
  }
  getShelves(): Promise<Shelf[]> {
    return this.readJson('shelves.json', []);
  }
  putShelves(s: Shelf[]): Promise<void> {
    return this.writeJson('shelves.json', s);
  }
}

export function toMeta(s: Story): StoryMeta {
  const text = docText(s.doc ?? []);
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    preview: text.slice(0, 200),
    tags: s.tags,
    favorite: s.favorite,
    shelf: s.shelf,
    mode: s.mode,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}
