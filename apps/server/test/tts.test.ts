import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';

// A fake OpenAI-compatible speech server.
let mock: Server;
let mockUrl = '';
const seen: { url: string; auth?: string; body: Record<string, unknown> }[] = [];
let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  mock = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ url: req.url ?? '', auth: req.headers.authorization, body: raw ? JSON.parse(raw) : {} });
      if (req.url === '/v1/audio/voices') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ voices: ['af_bella', 'am_adam'] }));
      }
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      res.end(Buffer.from('ID3fake-mp3'));
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  const addr = mock.address();
  mockUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/v1`;
  dir = await mkdtemp(join(tmpdir(), 'nw-tts-'));
  app = await buildApp({ dataDir: dir });
});

afterAll(async () => {
  await app.close();
  mock.close();
  await rm(dir, { recursive: true, force: true });
});

describe('tts proxy', () => {
  it('keeps the key on the server and proxies /audio/speech', async () => {
    await app.inject({ method: 'PUT', url: '/api/tts/config', payload: { baseUrl: mockUrl, apiKey: 'sk-secret', model: 'kokoro', voice: 'af_bella' } });
    const cfg = (await app.inject({ method: 'GET', url: '/api/tts/config' })).json();
    expect(cfg.apiKey).toBe('••••');
    // Saving the mask back keeps the real key.
    await app.inject({ method: 'PUT', url: '/api/tts/config', payload: { ...cfg, voice: 'am_adam' } });
    const voices = (await app.inject({ method: 'GET', url: '/api/tts/voices' })).json();
    expect(voices).toEqual(['af_bella', 'am_adam']);
    const res = await app.inject({ method: 'POST', url: '/api/tts', payload: { text: 'Hello there.', speed: 1.2 } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.rawPayload.toString()).toBe('ID3fake-mp3');
    const speech = seen.find((s) => s.url === '/v1/audio/speech')!;
    expect(speech.auth).toBe('Bearer sk-secret');
    expect(speech.body).toMatchObject({ model: 'kokoro', voice: 'am_adam', input: 'Hello there.', response_format: 'mp3', speed: 1.2 });
  });
});
