import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { newStory } from '@novelwriter/core';
import { buildApp } from '../src/app.ts';

let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nw-'));
  app = await buildApp({ dataDir: dir });
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe('server', () => {
  it('stores and lists stories', async () => {
    const s = newStory({ title: 'Saved', doc: [{ text: 'Hello', origin: 'prompt' }] });
    const put = await app.inject({ method: 'PUT', url: `/api/stories/${s.id}`, payload: s });
    expect(put.statusCode).toBe(200);
    const list = (await app.inject({ url: '/api/stories' })).json();
    expect(list[0]).toMatchObject({ id: s.id, title: 'Saved', preview: 'Hello' });
    const got = (await app.inject({ url: `/api/stories/${s.id}` })).json();
    expect(got.doc[0].text).toBe('Hello');
    await app.inject({ method: 'DELETE', url: `/api/stories/${s.id}` });
    expect((await app.inject({ url: `/api/stories/${s.id}` })).statusCode).toBe(404);
  });

  it('rejects path traversal ids', async () => {
    const res = await app.inject({ url: '/api/stories/..%2Fauth' });
    expect(res.statusCode).toBe(500);
  });

  it('lists providers including demo and OAuth-capable ones', async () => {
    const list = (await app.inject({ url: '/api/providers' })).json() as { id: string; oauth: unknown; configured: boolean }[];
    expect(list.find((p) => p.id === 'demo')?.configured).toBe(true);
    expect(list.find((p) => p.id === 'anthropic')?.oauth).toBeTruthy();
    const models = (await app.inject({ url: '/api/models?provider=demo' })).json();
    expect(models[0].id).toBe('markov');
  });

  it('streams a demo generation over SSE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: { model: { provider: 'demo', id: 'markov' }, system: 'continue', messages: [{ role: 'user', content: 'The rain fell on the old bridge.' }], params: { maxLength: 200 } },
    });
    const events = res.body.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
    const text = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
    expect(text.length).toBeGreaterThan(10);
    expect(events.at(-1).type).toBe('done');
  });

  it('stores api keys and custom providers', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/auth/openai/key', payload: { key: 'sk-test' } })).statusCode).toBe(200);
    const p = (await app.inject({ url: '/api/providers' })).json().find((x: { id: string }) => x.id === 'openai');
    expect(p.configured).toBe(true);
    await app.inject({ method: 'DELETE', url: '/api/auth/openai' });
    await app.inject({ method: 'PUT', url: '/api/custom-providers', payload: [{ id: '', name: 'Local LLM', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'k', models: [{ id: 'llama' }] }] });
    const masked = (await app.inject({ url: '/api/custom-providers' })).json();
    expect(masked[0]).toMatchObject({ id: 'custom-local-llm', apiKey: '••••' });
    const models = (await app.inject({ url: '/api/models?provider=custom-local-llm' })).json();
    expect(models[0].id).toBe('llama');
  });
});
