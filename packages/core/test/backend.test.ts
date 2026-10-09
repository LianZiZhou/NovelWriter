import { describe, expect, it } from 'vitest';
import { defaultParams } from '../src/defaults.ts';
import { modelCaps, rejectedFields, samplerPayload, type ModelTraits } from '../src/backend.ts';

const traits = (t: Partial<ModelTraits>): ModelTraits => ({ provider: 'x', api: 'openai-completions', id: 'm', reasoning: false, thinkingForced: false, ...t });
const params = () => {
  const p = defaultParams({});
  // Turn on the samplers the OpenAI set can take, with non-neutral values.
  p.order = p.order.map((s) => ({ ...s, enabled: ['temperature', 'top_p'].includes(s.id) ? true : s.enabled }));
  p.topP = 0.9;
  p.repetitionPenaltyPresence = 0.2;
  p.repetitionPenaltyFrequency = 0.1;
  return p;
};
const payload = (flavor: Parameters<typeof modelCaps>[0], t: Partial<ModelTraits>, rejected: string[] = []) =>
  samplerPayload(params(), flavor, { logprobs: 5, stop: ['\n\n'] }, modelCaps(flavor, traits(t), rejected));

describe('per-model parameters', () => {
  it('sends Codex no sampling settings at all', () => {
    const r = payload('chat-only', { provider: 'openai-codex', api: 'openai-codex-responses', id: 'gpt-5.5', reasoning: true });
    expect(r).toEqual({ temperature: undefined, body: {} });
    expect(modelCaps('chat-only', traits({ api: 'openai-codex-responses' })).restricted).toBe('reasoning');
  });

  it('sends OpenAI reasoning models no temperature, top_p, penalties or logprobs', () => {
    for (const t of [
      { provider: 'openai', api: 'openai-responses', id: 'gpt-5.4', reasoning: true },
      { provider: 'openai', api: 'openai-responses', id: 'o4-mini', reasoning: true },
      { provider: 'github-copilot', api: 'openai-responses', id: 'gpt-5.3-codex', reasoning: true },
      { provider: 'openai', api: 'openai-completions', id: 'gpt-5-mini', reasoning: true },
      { provider: 'amazon-bedrock', api: 'bedrock-converse-stream', id: 'openai.gpt-5.4', reasoning: true },
      { provider: 'openrouter', api: 'openai-completions', id: 'openai/o4-mini', reasoning: true },
    ]) {
      const r = payload('openai', t);
      expect(r.temperature, t.id).toBeUndefined();
      expect(r.body, t.id).toEqual(t.api === 'openai-completions' ? { stop: ['\n\n'] } : {});
    }
  });

  it('does not mistake other models for OpenAI reasoning models', () => {
    for (const id of ['openai/gpt-oss-120b', 'gpt-4o', 'mistral-large', 'llama-3.3-70b', 'gemma-3-4b-it'])
      expect(modelCaps('openai-compatible', traits({ id, reasoning: true })).restricted, id).toBeUndefined();
  });

  it('keeps the OpenAI set for non-reasoning OpenAI models', () => {
    const r = payload('openai', { provider: 'openai', api: 'openai-completions', id: 'gpt-4.1' });
    expect(r.temperature).toBeGreaterThan(0);
    expect(r.body).toMatchObject({ top_p: 0.9, presence_penalty: 0.2, frequency_penalty: 0.1, logprobs: true, top_logprobs: 5 });
  });

  it('drops temperature when the model always thinks, except on Gemini', () => {
    expect(payload('chat-only', { provider: 'anthropic', api: 'anthropic-messages', id: 'claude-x', reasoning: true, thinkingForced: true }).temperature).toBeUndefined();
    expect(payload('openai-compatible', { provider: 'moonshotai', id: 'kimi-k3', reasoning: true, thinkingForced: true }).temperature).toBeUndefined();
    expect(payload('chat-only', { provider: 'google', api: 'google-generative-ai', id: 'gemini-3-pro', reasoning: true, thinkingForced: true }).temperature).toBeGreaterThan(0);
    // Reasoning models that can switch thinking off run with it off and keep their samplers.
    expect(payload('chat-only', { provider: 'anthropic', api: 'anthropic-messages', id: 'claude-y', reasoning: true }).temperature).toBeGreaterThan(0);
  });

  it('leaves local servers alone', () => {
    const r = payload('llama.cpp', {});
    expect(r.temperature).toBeGreaterThan(0);
    expect(r.body).toMatchObject({ top_p: 0.9, logprobs: true });
  });

  it('never sends temperature when the preset turns it off or the backend lacks it', () => {
    const p = params();
    p.order = p.order.map((s) => (s.id === 'temperature' ? { ...s, enabled: false } : s));
    expect(samplerPayload(p, 'chat-only').temperature).toBeUndefined();
    expect(samplerPayload(params(), 'chat-only', {}, { ...modelCaps('chat-only', traits({})), params: [] }).temperature).toBeUndefined();
  });

  it('applies parameters a provider rejected at runtime', () => {
    const caps = modelCaps('openai-compatible', traits({}), ['temperature', 'presence_penalty']);
    expect(caps.params).not.toContain('temperature');
    expect(caps.params).not.toContain('presence');
    expect(caps.params).toContain('top_p');
    expect(caps.restricted).toBe('learned');
    const r = payload('openai-compatible', {}, ['temperature', 'presence_penalty']);
    expect(r.temperature).toBeUndefined();
    expect(r.body).toEqual({ top_p: 0.9, frequency_penalty: 0.1, stop: ['\n\n'] });
  });
});

describe('provider rejections', () => {
  const sent = ['temperature', 'top_p', 'presence_penalty', 'stop', 'logprobs', 'top_logprobs'];
  it('finds the fields an error complains about', () => {
    expect(rejectedFields("Unsupported parameter: 'temperature' is not supported with this model.", sent)).toEqual(['temperature']);
    expect(rejectedFields('400 {"detail":"Unsupported parameter: temperature"}', sent)).toEqual(['temperature']);
    expect(rejectedFields("Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported.", sent)).toEqual(['temperature']);
    expect(rejectedFields('logprobs is not supported for reasoning models; top_logprobs too', sent)).toEqual(['logprobs', 'top_logprobs']);
    expect(rejectedFields('Unrecognized request argument supplied: presence_penalty', sent)).toEqual(['presence_penalty']);
  });
  it('ignores errors that are not about a sent field', () => {
    expect(rejectedFields('Rate limit exceeded', sent)).toEqual([]);
    expect(rejectedFields('Invalid API key', sent)).toEqual([]);
    expect(rejectedFields('Unsupported parameter: reasoning_effort', sent)).toEqual([]);
    // "top_p" inside "top_probability" is not a mention.
    expect(rejectedFields('unknown field top_probability', sent)).toEqual([]);
  });
});
