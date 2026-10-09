// Checks the embedding engines on this machine end to end: installs the ONNX runtime and a llama.cpp CPU build into
// a temporary data folder, downloads a small model for each, and embeds a few sentences on every device to try.
// CI runs it on Windows, macOS and Linux. Usage: tsx apps/server/scripts/check-embeddings.ts [--keep]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.ts';

const dir = mkdtempSync(join(tmpdir(), 'nw-embed-'));
const app = await buildApp({ dataDir: dir });
const call = async <T = Record<string, unknown>>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object): Promise<T> => {
  const r = await app.inject({ method, url, payload });
  const body = r.json() as T & { error?: string };
  if (r.statusCode >= 400) throw new Error(`${url}: ${body.error ?? r.statusCode}`);
  return body;
};
const waitTask = async (task: { id: string; label: string }) => {
  for (;;) {
    const t = (await call<{ id: string; status: string; error?: string }[]>('GET', '/api/embeddings/tasks')).find((x) => x.id === task.id)!;
    if (t.status === 'done') return console.log(`  installed ${task.label}`);
    if (t.status !== 'running') throw new Error(`${task.label}: ${t.error ?? t.status}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};
const failures: string[] = [];
const test = async (name: string, required: boolean) => {
  try {
    const r = await call<{ dims: number; ms: number; related: number; unrelated: number }>('POST', '/api/embeddings/test');
    const ok = r.related > r.unrelated;
    console.log(`  ${ok ? 'ok' : 'WRONG'} ${name}: ${r.dims}d, ${r.ms} ms, related ${r.related} > unrelated ${r.unrelated}`);
    if (!ok && required) failures.push(name);
  } catch (e) {
    console.log(`  ${required ? 'FAIL' : 'skip'} ${name}: ${(e as Error).message.slice(0, 300)}`);
    if (required) failures.push(name);
  }
};

try {
  const hw = await call<{ suggest: { onnxDevice: string; llamaVariant: string }; gpus: { name: string }[]; npus: { name: string }[] }>('GET', '/api/embeddings/hardware');
  console.log(`hardware: GPUs [${hw.gpus.map((g) => g.name).join(', ')}], NPUs [${hw.npus.map((n) => n.name).join(', ')}], suggested ${JSON.stringify(hw.suggest)}`);

  console.log('ONNX engine');
  await call('PUT', '/api/embeddings/config', { enabled: true, source: 'onnx', onnx: { model: 'bge-small-zh-v1.5', device: 'cpu' } });
  await waitTask(await call('POST', '/api/embeddings/runtime/onnx'));
  await waitTask(await call('POST', '/api/embeddings/models', { kind: 'onnx', repo: 'bge-small-zh-v1.5' }));
  await test('onnx cpu', true);
  const extra = process.platform === 'win32' ? ['dml', 'webgpu'] : process.platform === 'darwin' ? ['coreml', 'webgpu'] : ['webgpu'];
  for (const device of extra) {
    await call('PUT', '/api/embeddings/config', { onnx: { device } });
    await test(`onnx ${device}`, false);
  }

  console.log('llama.cpp engine');
  const variant = process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac-metal-arm64' : 'mac-x64') : `${process.platform === 'win32' ? 'win' : 'linux'}-cpu-${process.arch}`;
  await call('PUT', '/api/embeddings/config', { source: 'llamacpp', llama: { variant, model: 'bge-small-zh-v1.5:Q8_0', ctxSize: 2048, parallel: 2, ubatchSize: 1024, batchSize: 1024 } });
  await waitTask(await call('POST', '/api/embeddings/runtime/llama'));
  await waitTask(await call('POST', '/api/embeddings/models', { kind: 'gguf', model: 'bge-small-zh-v1.5', quant: 'Q8_0' }));
  await test(`llama.cpp ${variant}`, true);
} catch (e) {
  failures.push((e as Error).message);
  console.log(`  FAIL ${(e as Error).message}`);
} finally {
  await app.close();
  // Windows keeps a stopped server's files locked for a moment.
  if (!process.argv.includes('--keep')) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
if (failures.length) {
  console.error(`embedding check failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('embedding check passed');
