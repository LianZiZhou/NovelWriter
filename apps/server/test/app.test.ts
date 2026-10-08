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

import { createServer, type Server } from 'node:http';

describe('custom OpenAI-compatible provider', () => {
  let fake: Server;
  let port = 0;
  const bodies: Record<string, unknown>[] = [];
  beforeAll(async () => {
    fake = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (req.url?.endsWith('/models')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }));
          return;
        }
        bodies.push(JSON.parse(raw));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (content: string, finish: string | null = null) =>
          `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [{ index: 0, delta: { content }, finish_reason: finish }] })}\n\n`;
        res.write(chunk(' The door'));
        res.write(chunk(' creaked open.'));
        res.write(chunk('', 'stop'));
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
    port = (fake.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => fake.close(() => r())));

  it('probes models and streams a generation with sampling params', async () => {
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    const probe = await app.inject({ method: 'POST', url: '/api/custom-providers/probe', payload: { baseUrl } });
    expect(probe.json()).toEqual([{ id: 'fake-model' }]);
    await app.inject({ method: 'PUT', url: '/api/custom-providers', payload: [{ id: 'fake', name: 'Fake', baseUrl, models: [{ id: 'fake-model' }] }] });
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: {
        model: { provider: 'fake', id: 'fake-model' },
        system: 'sys',
        messages: [{ role: 'user', content: 'Once' }],
        params: { temperature: 0.7, topP: 0.9, minP: 0.05, maxLength: 400, order: [{ id: 'temperature', enabled: true }, { id: 'top_p', enabled: true }, { id: 'min_p', enabled: true }] },
        stop: ['\n\n'],
      },
    });
    const events = res.body.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
    expect(events.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe(' The door creaked open.');
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'stop' });
    const body = bodies[0];
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
    expect(body.min_p).toBe(0.05);
    expect(body.max_tokens).toBe(100);
    expect(body.stop).toEqual(['\n\n']);
    expect((body.messages as { role: string }[])[0].role).toBe('system');
  });
});

describe('password protection', () => {
  it('requires basic auth when a password is set', async () => {
    const d = await mkdtemp(join(tmpdir(), 'nw-'));
    const locked = await buildApp({ dataDir: d, password: 's3cret' });
    expect((await locked.inject({ url: '/api/stories' })).statusCode).toBe(401);
    const ok = await locked.inject({ url: '/api/stories', headers: { authorization: `Basic ${Buffer.from('me:s3cret').toString('base64')}` } });
    expect(ok.statusCode).toBe(200);
    const bad = await locked.inject({ url: '/api/stories', headers: { authorization: `Basic ${Buffer.from('me:nope').toString('base64')}` } });
    expect(bad.statusCode).toBe(401);
    await locked.close();
    await rm(d, { recursive: true, force: true });
  });
});

import WebSocket from 'ws';

describe('OAuth login bridge', () => {
  it('replaces an abandoned login instead of failing on the callback port', async () => {
    const d = await mkdtemp(join(tmpdir(), 'nw-'));
    const srv = await buildApp({ dataDir: d });
    await srv.listen({ port: 0, host: '127.0.0.1' });
    const port = (srv.server.address() as { port: number }).port;
    const firstMessage = (ws: WebSocket) => new Promise<{ type: string; event?: { type: string } }>((r) => ws.once('message', (m) => r(JSON.parse(String(m)))));
    const url = `ws://127.0.0.1:${port}/api/auth/login?provider=anthropic&type=oauth`;
    const a = new WebSocket(url);
    const ma = await firstMessage(a);
    expect(ma.event?.type).toBe('auth_url');
    // Second login while the first is still pending (e.g. a dropped tab).
    const b = new WebSocket(url);
    const mb = await firstMessage(b);
    expect(mb, JSON.stringify(mb)).toMatchObject({ type: 'notify', event: { type: 'auth_url' } });
    b.send(JSON.stringify({ type: 'cancel' }));
    a.close();
    b.close();
    await srv.close();
    await rm(d, { recursive: true, force: true });
  });
});
