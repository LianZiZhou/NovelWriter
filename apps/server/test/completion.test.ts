import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';

// A fake llama.cpp server: a Llama 3 chat template on /props, text completions, and a chat endpoint that
// refuses a final assistant message (like a model that takes no prefill).
let mock: Server;
let mockUrl = '';
const hits: { url: string; body: Record<string, unknown> }[] = [];
let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  mock = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      hits.push({ url: req.url ?? '', body });
      if (req.url === '/props') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ chat_template: '{{ "<|start_header_id|>" + role + "<|end_header_id|>" }}' }));
        return;
      }
      if (req.url === '/v1/chat/completions') {
        const msgs = body.messages as { role: string }[];
        if (msgs.at(-1)?.role === 'assistant') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'This model does not support assistant message prefill.' } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content: 'chat ok' }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ text: ' the door', finish_reason: null, logprobs: { tokens: [' the'], token_logprobs: [-0.2], top_logprobs: [{ ' the': -0.2, ' a': -1.9 }] } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ text: ' creaked.', finish_reason: 'stop' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`;
  dir = await mkdtemp(join(tmpdir(), 'nw-'));
  app = await buildApp({ dataDir: dir });
  await app.inject({
    method: 'PUT',
    url: '/api/custom-providers',
    payload: [
      { id: 'inst', name: 'Instruct', baseUrl: mockUrl, flavor: 'llama.cpp', completion: 'instruct', template: 'auto', models: [{ id: 'some-model' }] },
      { id: 'raw', name: 'Raw', baseUrl: mockUrl, flavor: 'tabbyapi', completion: 'raw', models: [{ id: 'base' }] },
      { id: 'chat', name: 'Chat', baseUrl: mockUrl, flavor: 'openai-compatible', models: [{ id: 'c' }] },
    ],
  });
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

describe('text completion', () => {
  it('lists the completion mode and takes a prefill', async () => {
    const models = (await app.inject({ url: '/api/models?provider=inst' })).json() as { completion?: string; caps: { prefill?: boolean } }[];
    expect(models[0].completion).toBe('instruct');
    expect(models[0].caps.prefill).toBe(true);
  });

  it("renders the request in the server's template and continues an open reply", async () => {
    hits.length = 0;
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: { model: { provider: 'inst', id: 'some-model' }, system: 'Sys', messages: [{ role: 'user', content: 'Story' }, { role: 'assistant', content: 'She opened' }], maxTokens: 50, logprobs: 2 },
    });
    const ev = events(res.payload);
    expect(ev.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe(' the door creaked.');
    expect(ev.find((e) => e.type === 'logprobs')?.tokens?.[0]).toMatchObject({ token: ' the', top: [{ token: ' the' }, { token: ' a' }] });
    const call = hits.find((h) => h.url === '/v1/completions')!;
    expect(call.body.prompt).toBe(
      '<|start_header_id|>system<|end_header_id|>\n\nSys<|eot_id|><|start_header_id|>user<|end_header_id|>\n\nStory<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\nShe opened',
    );
    expect(call.body.stop).toEqual(expect.arrayContaining(['<|eot_id|>']));
    expect(call.body.logprobs).toBe(2);
    expect(call.body).not.toHaveProperty('top_logprobs');
  });

  it('sends the plain story text in raw mode, and banned strings', async () => {
    hits.length = 0;
    await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: { model: { provider: 'raw', id: 'base' }, system: 'Sys', messages: [{ role: 'user', content: 'x' }], prompt: 'Once upon a time', banned: ['shivers'] },
    });
    const call = hits.find((h) => h.url === '/v1/completions')!;
    expect(call.body.prompt).toBe('Once upon a time');
    expect(call.body.banned_strings).toEqual(['shivers']);
  });

  it('retries without the prefill when a chat model refuses it, and remembers', async () => {
    hits.length = 0;
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: {
        model: { provider: 'chat', id: 'c' },
        messages: [{ role: 'user', content: 'Head' }, { role: 'assistant', content: 'Tail' }],
        fallbackMessages: [{ role: 'user', content: 'Head Tail' }],
      },
    });
    expect(events(res.payload).filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe('chat ok');
    expect(hits.filter((h) => h.url === '/v1/chat/completions')).toHaveLength(2);
    const models = (await app.inject({ url: '/api/models?provider=chat' })).json() as { caps: { prefill?: boolean } }[];
    expect(models[0].caps.prefill).toBe(false);
  });
});
