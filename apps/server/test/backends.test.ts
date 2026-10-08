import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { defaultParams } from '@novelwriter/core';
import { buildApp } from '../src/app.ts';

// A fake llama.cpp server: records request bodies, tokenizes by character code, streams two tokens with logprobs.
let mock: Server;
let mockUrl = '';
const bodies: Record<string, unknown>[] = [];
let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  mock = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === '/tokenize') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ tokens: [...String(body.content)].map((c) => c.charCodeAt(0)) }));
        return;
      }
      bodies.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (content: string, logprob: number) => ({
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'm',
        choices: [{ index: 0, delta: { content }, logprobs: { content: [{ token: content, logprob, top_logprobs: [{ token: content, logprob }, { token: ' other', logprob: -2.3 }] }] }, finish_reason: null }],
      });
      res.write(`data: ${JSON.stringify(chunk('Hello', -0.1))}\n\n`);
      res.write(`data: ${JSON.stringify(chunk(' world', -0.7))}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`;
  dir = await mkdtemp(join(tmpdir(), 'nw-'));
  app = await buildApp({ dataDir: dir });
  await app.inject({ method: 'PUT', url: '/api/custom-providers', payload: [{ id: 'local', name: 'Local', baseUrl: mockUrl, flavor: 'llama.cpp', models: [{ id: 'm' }] }] });
});
afterAll(async () => {
  await app.close();
  mock.close();
  await rm(dir, { recursive: true, force: true });
});

function events(payload: string) {
  return payload
    .split('\n\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as { type: string; text?: string; tokens?: { token: string; top: unknown[] }[] });
}

describe('backend parameters', () => {
  it('reports the flavor with the model list', async () => {
    const models = (await app.inject({ url: '/api/models?provider=local' })).json() as { id: string; flavor: string }[];
    expect(models[0]).toMatchObject({ id: 'm', flavor: 'llama.cpp' });
  });

  it('sends llama.cpp samplers, sampler order, logit bias and logprobs, and returns token probabilities', async () => {
    const params = defaultParams({ topK: 40, minP: 0.05, repetitionPenalty: 1.1, repetitionPenaltyRange: 512, phraseRepPen: 'medium' });
    params.order = params.order.map((o) => ({ ...o, enabled: ['temperature', 'top_k', 'top_p', 'min_p'].includes(o.id) }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: {
        model: { provider: 'local', id: 'm' },
        messages: [{ role: 'user', content: 'Once' }],
        params,
        bias: [{ phrases: ['{A}', '[7, 8]'], bias: 1.5 }],
        banned: ['Z'],
        logprobs: 5,
        stop: ['\n\n'],
      },
    });
    const body = bodies[bodies.length - 1];
    expect(body).toMatchObject({ top_k: 40, min_p: 0.05, repeat_penalty: 1.1, repeat_last_n: 512, logprobs: true, top_logprobs: 5, stop: ['\n\n'] });
    const names: Record<string, string> = { temperature: 'temperature', top_k: 'top_k', top_p: 'top_p', min_p: 'min_p' };
    expect(body.samplers).toEqual(['dry', ...params.order.filter((o) => o.enabled).map((o) => names[o.id])]);
    expect(body.dry_multiplier).toBe(0.8);
    // "A" -> 65 (biased), "[7, 8]" -> 7 (first id), "Z" banned -> -100
    expect(body.logit_bias).toEqual(expect.arrayContaining([[65, 1.5], [7, 1.5], [90, -100]]));
    const ev = events(res.payload);
    expect(ev.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe('Hello world');
    const toks = ev.filter((e) => e.type === 'logprobs').flatMap((e) => e.tokens!);
    expect(toks.map((t) => t.token)).toEqual(['Hello', ' world']);
    expect(toks[0].top.length).toBe(2);
  });

  it('sends only OpenAI fields to a generic OpenAI-compatible endpoint', async () => {
    await app.inject({ method: 'PUT', url: '/api/custom-providers', payload: [{ id: 'local', name: 'Local', baseUrl: mockUrl, flavor: 'openai-compatible', models: [{ id: 'm' }] }] });
    await app.inject({ method: 'POST', url: '/api/generate', payload: { model: { provider: 'local', id: 'm' }, messages: [{ role: 'user', content: 'x' }], params: defaultParams({ topK: 40, topP: 0.9, repetitionPenaltyPresence: 0.3 }) } });
    const body = bodies[bodies.length - 1];
    expect(body.top_k).toBeUndefined();
    expect(body.presence_penalty).toBe(0.3);
    expect(body.logit_bias).toBeUndefined();
  });
});
