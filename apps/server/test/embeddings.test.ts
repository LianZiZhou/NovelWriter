import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { normalizeEmbeddingConfig, recallChunks, zipFiles, LLAMA_VARIANTS } from '@novelwriter/core';
import { buildApp } from '../src/app.ts';
import { extractArchive } from '../src/embeddings/archive.ts';
import { LlamaManager, splitArgs } from '../src/embeddings/llama.ts';
import { executionProviders, sessionOptions } from '../src/embeddings/onnx.ts';

// A fake OpenAI-compatible embedding endpoint: one dimension per topic, so related text is easy to tell apart.
function topicVector(text: string): number[] {
  return [/木箱|钥匙|藏/.test(text) ? 1 : 0, /雨|书店/.test(text) ? 1 : 0, 0.1, 0];
}

let mock: Server;
let mockUrl = '';
const requests: Record<string, unknown>[] = [];
let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  mock = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as { input: string[]; encoding_format?: string };
      requests.push({ ...body, auth: req.headers.authorization });
      const data = body.input.map((t, index) => {
        const v = topicVector(t);
        return { index, embedding: body.encoding_format === 'base64' ? Buffer.from(new Float32Array(v).buffer).toString('base64') : v };
      });
      res.setHeader('content-type', 'application/json');
      // Out of order on purpose: results are matched by index.
      res.end(JSON.stringify({ data: data.reverse() }));
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`;
  dir = await mkdtemp(join(tmpdir(), 'nw-emb-'));
  app = await buildApp({ dataDir: dir });
});

afterAll(async () => {
  await app.close();
  mock.close();
  await rm(dir, { recursive: true, force: true });
});

const call = async <T = Record<string, unknown>>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => {
  const r = await app.inject({ method, url, payload });
  return { status: r.statusCode, body: r.json() as T };
};

describe('embedding endpoint and story index', () => {
  const filler = (i: number) => `第${i}段：${'雨一直下，街道上的行人匆匆走过，没有人注意到角落里的那家旧书店。'.repeat(14)}`;
  const hidden = '她把那把钥匙藏进了祖母留下的木箱底层，又在上面压了几件旧衣服。'.repeat(7);
  const text = Array.from({ length: 12 }, (_, i) => (i === 4 ? hidden : filler(i))).join('\n\n');

  it('keeps the key on the server', async () => {
    await call('PUT', '/api/embeddings/config', { enabled: true, source: 'endpoint', endpoint: { preset: 'custom', baseUrl: mockUrl, apiKey: 'sk-test', model: 'm', encodingFormat: 'base64' } });
    const { body } = await call<{ endpoint: { apiKey: string; baseUrl: string } }>('GET', '/api/embeddings/config');
    expect(body.endpoint.apiKey).toBe('••••');
    // Saving the mask back keeps the stored key.
    await call('PUT', '/api/embeddings/config', { endpoint: { apiKey: '••••' } });
    const t = await call<{ related: number; unrelated: number; dims: number }>('POST', '/api/embeddings/test');
    expect(t.status).toBe(200);
    expect(t.body.dims).toBe(4);
    expect(t.body.related).toBeGreaterThan(t.body.unrelated);
    expect(requests.at(-1)?.auth).toBe('Bearer sk-test');
  });

  it('indexes a story and finds passages by meaning', async () => {
    const synced = await call<{ running: boolean }>('POST', '/api/vectors/story1/sync', { text });
    expect(synced.status).toBe(200);
    let status = synced.body as { running: boolean; indexed: number; total: number; error?: string };
    for (let i = 0; i < 100 && status.running; i++) {
      await new Promise((r) => setTimeout(r, 20));
      status = (await call<typeof status>('POST', '/api/vectors/story1/status', { text })).body;
    }
    expect(status.error).toBeUndefined();
    expect(status.indexed).toBe(recallChunks(text).length);
    expect(status.total).toBe(status.indexed);
    const found = await call<{ hashes: string[]; scores: number[] }>('POST', '/api/vectors/story1/search', { query: '他想起那枚钥匙不知藏在哪里' });
    const target = recallChunks(text).find((c) => c.text === hidden)!;
    expect(found.body.hashes[0]).toBe(target.hash);
    expect(found.body.scores[0]).toBeGreaterThan(0.9);
    // Only new passages are embedded when the story grows.
    const before = requests.length;
    await call('POST', '/api/vectors/story1/sync', { text: `${text}\n\n${filler(99)}` });
    for (let i = 0; i < 100; i++) {
      const s = (await call<{ running: boolean }>('POST', '/api/vectors/story1/status')).body;
      if (!s.running) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const sent = requests.slice(before).flatMap((r) => r.input as string[]);
    expect(sent).toHaveLength(1);
  });

  it('drops the index with the story', async () => {
    await call('DELETE', '/api/stories/story1');
    const s = await call<{ indexed: number }>('POST', '/api/vectors/story1/status', { text });
    expect(s.body.indexed).toBe(0);
    expect(existsSync(join(dir, 'vectors', 'story1'))).toBe(false);
  });

  it('reports a missing model instead of downloading it', async () => {
    await call('PUT', '/api/embeddings/config', { source: 'onnx' });
    const t = await call<{ error: string }>('POST', '/api/embeddings/test');
    expect(t.status).toBe(502);
    expect(t.body.error).toMatch(/not downloaded|not installed/);
    expect(existsSync(join(dir, 'models'))).toBe(false);
    expect(existsSync(join(dir, 'runtimes'))).toBe(false);
  });
});

describe('archives', () => {
  it('extracts tar.gz with long names and links, and zip files', async () => {
    const src = join(dir, 'src');
    const long = 'a'.repeat(120);
    mkdirSync(join(src, 'pkg', 'lib'), { recursive: true });
    writeFileSync(join(src, 'pkg', 'lib', 'libx.so.1'), 'lib');
    writeFileSync(join(src, 'pkg', `${long}.txt`), 'long');
    execFileSync('ln', ['-s', 'libx.so.1', join(src, 'pkg', 'lib', 'libx.so')]);
    execFileSync('tar', ['czf', join(dir, 't.tar.gz'), '-C', src, 'pkg']);
    const out = join(dir, 'out');
    const files = await extractArchive(join(dir, 't.tar.gz'), out, { strip: 1 });
    expect(files).toContain(`${long}.txt`);
    expect(readFileSync(join(out, `${long}.txt`), 'utf8')).toBe('long');
    expect(lstatSync(join(out, 'lib', 'libx.so')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(out, 'lib', 'libx.so'))).toBe('libx.so.1');

    writeFileSync(join(dir, 'z.zip'), zipFiles([{ name: 'bin/llama-server.exe', data: 'exe' }, { name: 'bin/ggml.dll', data: new Uint8Array([1, 2, 3]) }]));
    expect(await extractArchive(join(dir, 'z.zip'), join(dir, 'zout'), { filter: (n) => n.endsWith('.exe') })).toEqual(['bin/llama-server.exe']);
    expect(readFileSync(join(dir, 'zout', 'bin', 'llama-server.exe'), 'utf8')).toBe('exe');
  });
  it('refuses paths outside the target', async () => {
    writeFileSync(join(dir, 'bad.zip'), zipFiles([{ name: '../evil.txt', data: 'x' }]));
    await expect(extractArchive(join(dir, 'bad.zip'), join(dir, 'bad'))).rejects.toThrow(/Unsafe/);
  });
});

describe('engine options', () => {
  it('maps execution providers', () => {
    const o = normalizeEmbeddingConfig({}).onnx;
    expect(executionProviders({ ...o, device: 'auto' })).toBeUndefined();
    expect(executionProviders({ ...o, device: 'dml', deviceId: 1 })).toEqual([{ name: 'dml', deviceId: 1 }, { name: 'cpu', useArena: true }]);
    expect(executionProviders({ ...o, device: 'tensorrt', cpuFallback: false })).toEqual([{ name: 'tensorrt', deviceId: 0 }, { name: 'cuda', deviceId: 0 }]);
    expect(executionProviders({ ...o, device: 'coreml', coremlUnits: 'ane', coremlMlProgram: true, cpuFallback: false })).toEqual([{ name: 'coreml', coreMlFlags: 0x004 | 0x010 }]);
    expect(executionProviders({ ...o, device: 'qnn', cpuFallback: false })).toEqual([{ name: 'qnn', backendType: 'htp', enableFp16Precision: true }]);
    expect(executionProviders({ ...o, device: 'custom', customProviders: '[{"name":"qnn"},"cpu"]' })).toEqual([{ name: 'qnn' }, 'cpu']);
    expect(() => executionProviders({ ...o, device: 'custom', customProviders: '{}' })).toThrow();
    expect(sessionOptions({ ...o, intraOpThreads: 4 })).toMatchObject({ intraOpNumThreads: 4, graphOptimizationLevel: 'all', executionMode: 'sequential' });
  });

  it('builds the llama-server command line', () => {
    expect(splitArgs(`--foo "a b" 'c d' e\\ f`)).toEqual(['--foo', 'a b', 'c d', 'e\\', 'f']);
    const m = new LlamaManager(dir);
    const c = normalizeEmbeddingConfig({ llama: { device: 'Vulkan0', pooling: 'cls', flashAttn: 'on', mmap: false, extraArgs: '--verbose' } });
    const args = m.args(c, '/m.gguf', 1234);
    expect(args.slice(0, 7)).toEqual(['-m', '/m.gguf', '--embedding', '--host', '127.0.0.1', '--port', '1234']);
    expect(args).toEqual(expect.arrayContaining(['-ngl', '999', '--device', 'Vulkan0', '--pooling', 'cls', '-fa', 'on', '--no-mmap', '--verbose']));
    expect(args).not.toContain('-sm');
  });

  it('finds the newest release with the chosen build and its CUDA runtime', async () => {
    const releases = [
      { tag_name: 'b3', assets: [{ name: 'llama-b3-bin-ubuntu-x64.tar.gz', browser_download_url: 'u3', size: 1 }] },
      {
        tag_name: 'b2',
        assets: [
          { name: 'llama-b2-bin-win-cuda-12.4-x64.zip', browser_download_url: 'u2', size: 1 },
          { name: 'cudart-llama-bin-win-cuda-12.4-x64.zip', browser_download_url: 'c2', size: 1 },
          { name: 'cudart-llama-bin-win-cuda-13.1-x64.zip', browser_download_url: 'c2b', size: 1 },
        ],
      },
    ];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(releases), { status: 200 }));
    try {
      const m = new LlamaManager(dir);
      const v = LLAMA_VARIANTS.find((x) => x.id === 'win-cuda12-x64')!;
      const r = await m.resolve(normalizeEmbeddingConfig({}), v);
      expect(r.tag).toBe('b2');
      expect(r.asset.url).toBe('u2');
      expect(r.cudart?.url).toBe('c2');
      await expect(m.resolve(normalizeEmbeddingConfig({}), LLAMA_VARIANTS.find((x) => x.id === 'mac-metal-arm64')!)).rejects.toThrow(/No recent llama.cpp release/);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
