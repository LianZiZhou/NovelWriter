import { readFile, rename, writeFile, chmod } from 'node:fs/promises';
import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai';

/**
 * pi-ai CredentialStore persisted to a JSON file (same layout as pi's
 * auth.json). Writes are serialized per process through a promise chain.
 */
export class FileCredentialStore implements CredentialStore {
  private chain: Promise<unknown> = Promise.resolve();
  private cache: Record<string, Credential> | null = null;

  constructor(private readonly file: string) {}

  private async load(): Promise<Record<string, Credential>> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, Credential>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private async save(data: Record<string, Credential>): Promise<void> {
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(tmp, this.file);
    await chmod(this.file, 0o600).catch(() => {});
    this.cache = data;
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return (await this.load())[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const data = await this.load();
    return Object.entries(data).map(([providerId, c]) => ({ providerId, type: c.type }));
  }

  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
    return this.serialize(async () => {
      const data = { ...(await this.load()) };
      const next = await fn(data[providerId]);
      if (next === undefined) return data[providerId];
      data[providerId] = next;
      await this.save(data);
      return next;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.serialize(async () => {
      const data = { ...(await this.load()) };
      delete data[providerId];
      await this.save(data);
    });
  }
}
