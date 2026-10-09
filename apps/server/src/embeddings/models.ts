// Embedding model files: downloaded from Hugging Face (or a mirror) only when the user asks.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { embeddingModel, type EmbeddingConfig, type OnnxDtype } from '@novelwriter/core';
import { dirSize } from './onnx.ts';
import { download, type TaskContext } from './tasks.ts';

export const DTYPE_SUFFIX: Record<OnnxDtype, string> = {
  fp32: '',
  fp16: '_fp16',
  int8: '_int8',
  uint8: '_uint8',
  quantized: '_quantized',
  q4: '_q4',
  q4f16: '_q4f16',
  bnb4: '_bnb4',
};

const REPO = /^[\w.-]+\/[\w.-]+$/;

export function checkRepo(repo: string): string {
  if (!REPO.test(repo)) throw new Error(`Not a Hugging Face model id: ${repo}`);
  return repo;
}

function checkFile(file: string): string {
  if (!/^[\w.+-]+$/.test(file)) throw new Error(`Invalid file name: ${file}`);
  return file;
}

export function onnxDir(modelsDir: string): string {
  return join(modelsDir, 'onnx');
}

export function ggufPath(modelsDir: string, repo: string, file: string): string {
  return join(modelsDir, 'gguf', ...checkRepo(repo).split('/'), checkFile(file));
}

const hfBase = (c: EmbeddingConfig) => (c.hfEndpoint || 'https://huggingface.co').replace(/\/+$/, '');

interface TreeEntry {
  type: string;
  path: string;
  size?: number;
  lfs?: { size: number };
}

async function tree(c: EmbeddingConfig, repo: string, dir: string, signal?: AbortSignal): Promise<TreeEntry[] | null> {
  try {
    const res = await fetch(`${hfBase(c)}/api/models/${repo}/tree/main${dir ? `/${dir}` : ''}`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as TreeEntry[];
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}

/** Files of one ONNX model in one precision: the configs and tokenizer, the graph and its external data. */
export async function onnxFiles(c: EmbeddingConfig, repo: string, dtype: OnnxDtype, signal?: AbortSignal): Promise<{ path: string; size?: number }[]> {
  checkRepo(repo);
  const base = `model${DTYPE_SUFFIX[dtype]}.onnx`;
  const [root, onnx] = await Promise.all([tree(c, repo, '', signal), tree(c, repo, 'onnx', signal)]);
  if (root && onnx) {
    const configs = root.filter((f) => f.type === 'file' && f.path.endsWith('.json'));
    const graph = onnx.filter((f) => f.type === 'file' && (f.path === `onnx/${base}` || f.path.startsWith(`onnx/${base}_data`)));
    if (!graph.some((f) => f.path === `onnx/${base}`)) throw new Error(`${repo} has no ${dtype} version (onnx/${base}).`);
    return [...configs, ...graph].map((f) => ({ path: f.path, size: f.lfs?.size ?? f.size }));
  }
  // The listing API is unavailable (some mirrors): the usual transformers.js layout.
  const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', `onnx/${base}`];
  if (embeddingModel(repo)?.onnx?.externalData) files.push(`onnx/${base}_data`);
  return files.map((path) => ({ path }));
}

export async function downloadOnnx(c: EmbeddingConfig, modelsDir: string, repo: string, dtype: OnnxDtype, ctx: TaskContext): Promise<void> {
  const files = await onnxFiles(c, repo, dtype, ctx.signal);
  const dir = join(onnxDir(modelsDir), ...repo.split('/'));
  for (const f of files) {
    const dest = join(dir, ...f.path.split('/'));
    if (existsSync(dest) && (!f.size || statSync(dest).size === f.size)) continue;
    ctx.setCurrent(f.path);
    try {
      await download(`${hfBase(c)}/${repo}/resolve/main/${f.path}`, dest, { ctx, size: f.size });
    } catch (e) {
      // Optional files of the fallback layout.
      if (f.path === 'special_tokens_map.json' || f.path === 'tokenizer_config.json') continue;
      throw e;
    }
  }
}

export async function downloadGguf(c: EmbeddingConfig, modelsDir: string, repo: string, file: string, ctx: TaskContext): Promise<void> {
  ctx.setCurrent(file);
  await download(`${hfBase(c)}/${checkRepo(repo)}/resolve/main/${checkFile(file)}`, ggufPath(modelsDir, repo, file), { ctx });
}

export interface InstalledModels {
  onnx: { repo: string; dtypes: OnnxDtype[]; sizeMB: number }[];
  gguf: { repo: string; file: string; sizeMB: number }[];
  totalMB: number;
}

function repos(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const org of readdirSync(dir, { withFileTypes: true })) {
    if (!org.isDirectory()) continue;
    for (const name of readdirSync(join(dir, org.name), { withFileTypes: true })) if (name.isDirectory()) out.push(`${org.name}/${name.name}`);
  }
  return out;
}

export function installedModels(modelsDir: string): InstalledModels {
  const result: InstalledModels = { onnx: [], gguf: [], totalMB: 0 };
  const od = onnxDir(modelsDir);
  for (const repo of repos(od)) {
    const dir = join(od, ...repo.split('/'));
    const graphs = existsSync(join(dir, 'onnx')) ? readdirSync(join(dir, 'onnx')) : [];
    const dtypes = (Object.keys(DTYPE_SUFFIX) as OnnxDtype[]).filter((d) => graphs.includes(`model${DTYPE_SUFFIX[d]}.onnx`));
    if (!dtypes.length || !existsSync(join(dir, 'tokenizer.json'))) continue;
    result.onnx.push({ repo, dtypes, sizeMB: Math.round(dirSize(dir) / 1048576) });
  }
  const gd = join(modelsDir, 'gguf');
  for (const repo of repos(gd)) {
    for (const file of readdirSync(join(gd, ...repo.split('/')))) {
      if (!file.endsWith('.gguf')) continue;
      result.gguf.push({ repo, file, sizeMB: Math.round(statSync(join(gd, ...repo.split('/'), file)).size / 1048576) });
    }
  }
  result.totalMB = Math.round(dirSize(modelsDir) / 1048576);
  return result;
}

export function onnxInstalled(modelsDir: string, repo: string, dtype: OnnxDtype): boolean {
  const dir = join(onnxDir(modelsDir), ...checkRepo(repo).split('/'));
  return existsSync(join(dir, 'tokenizer.json')) && existsSync(join(dir, 'onnx', `model${DTYPE_SUFFIX[dtype]}.onnx`));
}

export function deleteOnnx(modelsDir: string, repo: string, dtype?: OnnxDtype): void {
  const dir = join(onnxDir(modelsDir), ...checkRepo(repo).split('/'));
  if (!dtype) return rmSync(dir, { recursive: true, force: true });
  const base = `model${DTYPE_SUFFIX[dtype]}.onnx`;
  for (const f of existsSync(join(dir, 'onnx')) ? readdirSync(join(dir, 'onnx')) : []) if (f === base || f.startsWith(`${base}_data`)) rmSync(join(dir, 'onnx', f), { force: true });
  if (!readdirSync(join(dir, 'onnx')).some((f) => f.endsWith('.onnx'))) rmSync(dir, { recursive: true, force: true });
}

export function deleteGguf(modelsDir: string, repo: string, file: string): void {
  rmSync(ggufPath(modelsDir, repo, file), { force: true });
}
