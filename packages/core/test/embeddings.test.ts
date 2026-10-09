import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMBEDDING_CONFIG,
  EMBEDDING_MODELS,
  LLAMA_VARIANTS,
  embeddingInput,
  embeddingKey,
  finishVector,
  normalizeEmbeddingConfig,
  textHash,
} from '../src/embeddings.ts';
import { recallChunks, recallPassages } from '../src/recall.ts';
import { buildStoryRequest, calibrationRatio, requestTokenEstimate, updateCalibration } from '../src/prompts.ts';
import { newStory } from '../src/defaults.ts';
import { flatten } from '../src/history.ts';
import { loadTokenizer } from '../src/tokenizer.ts';

describe('embedding catalog', () => {
  it('has unique ids and consistent downloads', () => {
    expect(new Set(EMBEDDING_MODELS.map((m) => m.id)).size).toBe(EMBEDDING_MODELS.length);
    for (const m of EMBEDDING_MODELS) {
      expect(m.onnx || m.gguf, m.id).toBeTruthy();
      if (m.onnx) expect(m.onnx.sizes[m.onnx.recommended], m.id).toBeGreaterThan(0);
      if (m.gguf) expect(m.gguf.files.some((f) => f.quant === m.gguf!.recommended), m.id).toBe(true);
      if (m.mrl) expect(Math.max(...m.mrl)).toBeLessThanOrEqual(m.dims);
    }
    for (const v of LLAMA_VARIANTS) expect(() => new RegExp(v.pattern)).not.toThrow();
  });
  it('matches llama.cpp release asset names', () => {
    const asset = (id: string) => new RegExp(`^llama-(b\\d+)-bin-(${LLAMA_VARIANTS.find((v) => v.id === id)!.pattern})$`);
    expect(asset('win-cuda12-x64').test('llama-b11429-bin-win-cuda-12.4-x64.zip')).toBe(true);
    expect(asset('win-cuda12-x64').test('llama-b11429-bin-win-cuda-13.4-x64.zip')).toBe(false);
    expect(asset('linux-openvino-x64').test('llama-b11429-bin-ubuntu-openvino-2026.4.1-x64.tar.gz')).toBe(true);
    expect(asset('linux-rocm-x64').test('llama-b11429-bin-ubuntu-rocm-10.0-x64.tar.gz')).toBe(true);
    expect(asset('mac-metal-arm64').test('llama-b11429-bin-macos-arm64.tar.gz')).toBe(true);
    expect(asset('linux-cpu-x64').test('llama-b11429-bin-ubuntu-vulkan-x64.tar.gz')).toBe(false);
  });
});

describe('embedding settings', () => {
  it('fills in missing fields', () => {
    const c = normalizeEmbeddingConfig({ enabled: true, onnx: { device: 'coreml' } });
    expect(c.enabled).toBe(true);
    expect(c.onnx.device).toBe('coreml');
    expect(c.onnx.model).toBe(DEFAULT_EMBEDDING_CONFIG.onnx.model);
    expect(c.llama.gpuLayers).toBe(999);
  });
  it("adds the model's prefixes, unless overridden", () => {
    const c = normalizeEmbeddingConfig({ onnx: { model: 'multilingual-e5-small' } });
    expect(embeddingInput(c, 'x', 'query')).toBe('query: x');
    expect(embeddingInput(c, 'x', 'doc')).toBe('passage: x');
    expect(embeddingInput({ ...c, queryPrefix: '' }, 'x', 'query')).toBe('x');
    const gemma = normalizeEmbeddingConfig({ source: 'llamacpp', llama: { model: 'embeddinggemma-300m:Q8_0' } });
    expect(embeddingInput(gemma, 'x', 'doc')).toBe('title: none | text: x');
  });
  it('keys stored vectors by what changes them', () => {
    const a = normalizeEmbeddingConfig({});
    expect(embeddingKey(a)).toBe(embeddingKey(normalizeEmbeddingConfig({ queryPrefix: 'q: ' })));
    expect(embeddingKey(a)).not.toBe(embeddingKey(normalizeEmbeddingConfig({ docPrefix: 'p: ' })));
    expect(embeddingKey(a)).not.toBe(embeddingKey(normalizeEmbeddingConfig({ onnx: { model: 'bge-m3' } })));
    expect(embeddingKey(a)).not.toBe(embeddingKey(normalizeEmbeddingConfig({ dimensions: 256 })));
    expect(embeddingKey(a)).toMatch(/^onnx-[0-9a-z]+$/);
  });
  it('hashes and normalizes', () => {
    expect(textHash('abc')).toBe(textHash('abc'));
    expect(textHash('abc')).not.toBe(textHash('abd'));
    const v = finishVector([3, 4, 12], 2);
    expect(Array.from(v)).toEqual([0.6000000238418579, 0.800000011920929]);
  });
});

describe('hybrid recall', () => {
  // Paragraphs long enough to be passages of their own.
  const filler = (i: number) => `第${i}段：${i === 3 ? '灯塔守望人提着油灯走上石阶。' : ''}${'雨一直下，街道上的行人匆匆走过，没有人注意到角落里的那家旧书店。店主坐在柜台后面翻着账本，偶尔抬头看看门口。'.repeat(8)}`;
  const hidden = '她把那件东西藏进了祖母留下的木箱底层，又在上面压了几件旧衣服。'.repeat(6);
  const earlier = Array.from({ length: 30 }, (_, i) => (i === 9 ? hidden : filler(i))).join('\n\n');
  const hiddenHash = () => recallChunks(earlier).find((c) => c.text === hidden)!.hash;
  it('recalls a passage found by meaning that shares no words with the latest text', async () => {
    await loadTokenizer();
    const query = '他想起那枚盘着龙的钥匙。';
    expect(recallPassages(earlier, query, 600)).toEqual([]);
    expect(recallPassages(earlier, query, 600, { hashes: ['not-in-text', hiddenHash()] })).toEqual([hidden]);
  });
  it('fuses both rankings, in story order', async () => {
    await loadTokenizer();
    const got = recallPassages(earlier, '灯塔守望人', 4000, { hashes: [hiddenHash()] });
    expect(got).toHaveLength(2);
    expect(got[0]).toContain('灯塔守望人');
    expect(got[1]).toBe(hidden);
  });
});

describe('token calibration', () => {
  it('learns a ratio from reported input tokens', () => {
    expect(updateCalibration(undefined, 100, 50)).toBeUndefined();
    const first = updateCalibration(undefined, 1300, 1000, 1)!;
    expect(first).toEqual({ ratio: 1.3, samples: 1, source: 'usage', at: 1 });
    const second = updateCalibration(first, 1100, 1000, 2)!;
    expect(second.ratio).toBeCloseTo(1.2, 5);
    expect(second.samples).toBe(2);
    // A ratio from the server's tokenizer is replaced by the first measurement.
    expect(updateCalibration({ ratio: 2, samples: 0, source: 'tokenizer', at: 0 }, 1000, 1000)!.ratio).toBe(1);
    expect(calibrationRatio(9)).toBe(3);
    expect(calibrationRatio(undefined)).toBe(1);
    expect(requestTokenEstimate('', [], 'hello world')).toBeGreaterThan(0);
  });
  it("sizes the context and output in the model's tokens", async () => {
    await loadTokenizer();
    const text = '夜色渐深，城墙上的火把在风中摇曳。林舟握紧了手中的长剑。\n'.repeat(400);
    const doc = [{ text, origin: 'prompt' as const }];
    const s = newStory({ doc, history: flatten(doc) });
    const plain = buildStoryRequest(s, { maxContextTokens: 4000 });
    const scaled = buildStoryRequest(s, { maxContextTokens: 4000, tokenRatio: 2 });
    expect(scaled.context.usedTokens).toBeLessThan(plain.context.usedTokens * 0.55);
    expect(scaled.maxTokens).toBe(plain.maxTokens * 2);
  });
});
