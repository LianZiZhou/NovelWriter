import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const dataDir = resolve(process.env.NOVELWRITER_DATA ?? resolve(here, '../../../data'));
const staticDir = resolve(here, '../../web/dist');
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

const password = process.env.NOVELWRITER_PASSWORD || undefined;
if (!password && host !== '127.0.0.1' && host !== 'localhost') {
  console.warn('WARNING: NovelWriter is listening on a non-local address without NOVELWRITER_PASSWORD. Anyone who can reach it can use your AI credentials.');
}

const app = await buildApp({ dataDir, staticDir, logger: true, password });
await app.listen({ port, host });
