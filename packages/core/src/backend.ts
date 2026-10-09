import type { GenerationParams, SamplerId } from './types.ts';

/**
 * What kind of server a model is reached through. It decides which generation settings can actually be
 * sent: chat APIs only take a temperature, OpenAI-compatible clouds the OpenAI set, and local inference
 * servers (llama.cpp, vLLM, KoboldCpp, TabbyAPI) most of NovelAI's samplers under their own names.
 */
export type BackendFlavor = 'demo' | 'openai' | 'openrouter' | 'openai-compatible' | 'llama.cpp' | 'vllm' | 'koboldcpp' | 'tabbyapi' | 'chat-only';

export const BACKEND_FLAVORS: { id: BackendFlavor; label: string }[] = [
  { id: 'openai-compatible', label: 'OpenAI-compatible (generic)' },
  { id: 'llama.cpp', label: 'llama.cpp server' },
  { id: 'vllm', label: 'vLLM' },
  { id: 'koboldcpp', label: 'KoboldCpp' },
  { id: 'tabbyapi', label: 'TabbyAPI' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'openai', label: 'OpenAI' },
];

/** Generation settings that may or may not reach the model. */
export type ParamId =
  | SamplerId
  | 'rep_pen'
  | 'rep_pen_range'
  | 'rep_pen_slope'
  | 'presence'
  | 'frequency'
  | 'phrase_rep_pen'
  | 'min_length'
  | 'whitelist'
  | 'dynamic_range'
  | 'xtc'
  | 'banned_strings';

export interface BackendCaps {
  params: ParamId[];
  /** Sampler order is sent. */
  samplerOrder: boolean;
  /** Max top alternatives per token; 0 = no token probabilities. */
  logprobs: number;
  /** How phrase-bias / banned-token text becomes token ids for logit_bias. */
  tokenizer: 'o200k' | 'remote' | 'none';
  /** Max stop sequences sent to the API (others are applied client-side). */
  stop: number;
  /** The model continues a final assistant message (prefill) instead of answering it. */
  prefill?: boolean;
}

const OPENAI_SET: ParamId[] = ['temperature', 'top_p', 'presence', 'frequency'];
const ALL: ParamId[] = ['temperature', 'top_k', 'top_p', 'top_a', 'min_p', 'typical_p', 'tfs', 'mirostat', 'unified', 'rep_pen', 'rep_pen_range', 'rep_pen_slope', 'presence', 'frequency', 'phrase_rep_pen', 'min_length'];

export function backendCaps(flavor: BackendFlavor): BackendCaps {
  switch (flavor) {
    case 'demo':
      return { params: ALL, samplerOrder: true, logprobs: 10, tokenizer: 'none', stop: 99, prefill: true };
    case 'openai':
      return { params: OPENAI_SET, samplerOrder: false, logprobs: 20, tokenizer: 'o200k', stop: 4 };
    case 'openrouter':
      return { params: ['temperature', 'top_k', 'top_p', 'top_a', 'min_p', 'rep_pen', 'presence', 'frequency'], samplerOrder: false, logprobs: 20, tokenizer: 'none', stop: 16 };
    case 'openai-compatible':
      return { params: OPENAI_SET, samplerOrder: false, logprobs: 0, tokenizer: 'none', stop: 4 };
    case 'llama.cpp':
      return { params: ['temperature', 'top_k', 'top_p', 'min_p', 'typical_p', 'mirostat', 'rep_pen', 'rep_pen_range', 'presence', 'frequency', 'phrase_rep_pen', 'xtc'], samplerOrder: true, logprobs: 20, tokenizer: 'remote', stop: 99, prefill: true };
    case 'vllm':
      return { params: ['temperature', 'top_k', 'top_p', 'min_p', 'rep_pen', 'presence', 'frequency', 'min_length'], samplerOrder: false, logprobs: 20, tokenizer: 'remote', stop: 99 };
    case 'koboldcpp':
      return { params: ['temperature', 'top_k', 'top_p', 'top_a', 'min_p', 'typical_p', 'tfs', 'mirostat', 'unified', 'rep_pen', 'rep_pen_range', 'rep_pen_slope', 'presence', 'frequency', 'phrase_rep_pen', 'xtc', 'banned_strings'], samplerOrder: true, logprobs: 5, tokenizer: 'remote', stop: 99 };
    case 'tabbyapi':
      return { params: ['temperature', 'top_k', 'top_p', 'top_a', 'min_p', 'typical_p', 'tfs', 'mirostat', 'unified', 'rep_pen', 'rep_pen_range', 'presence', 'frequency', 'phrase_rep_pen', 'min_length', 'xtc', 'banned_strings'], samplerOrder: false, logprobs: 20, tokenizer: 'remote', stop: 99 };
    default:
      return { params: ['temperature'], samplerOrder: false, logprobs: 0, tokenizer: 'none', stop: 0 };
  }
}

/** What the server knows about a model beyond its flavor. */
export interface ModelTraits {
  provider: string;
  /** pi-ai API id, e.g. `openai-responses`, `openai-codex-responses`, `anthropic-messages`. */
  api: string;
  id: string;
  reasoning: boolean;
  /** The model always thinks (its thinking can't be turned off), so we run it at the lowest level. */
  thinkingForced: boolean;
}

/** Capabilities of one model: its flavor's, minus what the model itself rejects. */
export interface ModelCaps extends BackendCaps {
  /** Why sampling settings are off for this model, when they are. */
  restricted?: 'reasoning' | 'learned';
}

/** OpenAI reasoning models under any host's naming: o3, openai/o4-mini, openai.gpt-5.4, gpt-5.3-codex… */
const OPENAI_REASONING = /(^|[/.:])(o\d+(-|$)|gpt-5|[\w.-]*codex)/i;

/**
 * Per-model capabilities. Reasoning models fix their own sampling: OpenAI's o-series / GPT-5 / Codex
 * reject temperature, top_p, penalties and logprobs, and most models that always think (Claude with
 * extended thinking, Kimi and DeepSeek thinking, Grok reasoning…) reject or ignore temperature.
 * `rejected` are parameter names a provider has refused for this model at runtime.
 */
export function modelCaps(flavor: BackendFlavor, m: ModelTraits, rejected: Iterable<string> = []): ModelCaps {
  const caps: ModelCaps = { ...backendCaps(flavor) };
  // Claude continues a final assistant message; with thinking on it refuses one.
  if (m.api === 'anthropic-messages') caps.prefill = !m.thinkingForced;
  const fixedSampling =
    m.api === 'openai-codex-responses' ||
    (m.reasoning && OPENAI_REASONING.test(m.id)) ||
    (m.thinkingForced && !m.api.startsWith('google'));
  if (fixedSampling) {
    caps.params = [];
    caps.samplerOrder = false;
    caps.logprobs = 0;
    caps.tokenizer = 'none';
    // Stop sequences aren't a sampler; Chat Completions still takes them, the Responses API never did.
    if (m.api !== 'openai-completions') caps.stop = 0;
    caps.restricted = 'reasoning';
  }
  const learned = new Set(rejected);
  if (learned.size) {
    const before = caps.params.length;
    caps.params = caps.params.filter((p) => !PARAM_FIELDS[p].some((f) => learned.has(f)));
    if (learned.has('logprobs') || learned.has('top_logprobs')) caps.logprobs = 0;
    if (learned.has('logit_bias')) caps.tokenizer = 'none';
    if (learned.has('stop')) caps.stop = 0;
    if (learned.has('prefill')) caps.prefill = false;
    if (caps.params.length < before) caps.restricted ??= 'learned';
  }
  return caps;
}

/** Request fields each setting is sent as (any backend), to map a provider's complaint back to a setting. */
const PARAM_FIELDS: Record<ParamId, string[]> = {
  temperature: ['temperature'],
  top_k: ['top_k'],
  top_p: ['top_p'],
  top_a: ['top_a'],
  min_p: ['min_p'],
  typical_p: ['typical_p', 'typical'],
  tfs: ['tfs'],
  mirostat: ['mirostat', 'mirostat_mode', 'mirostat_tau', 'mirostat_eta'],
  unified: ['smoothing_factor', 'smoothing_curve'],
  rep_pen: ['repetition_penalty', 'repeat_penalty', 'rep_pen'],
  rep_pen_range: ['penalty_range', 'repeat_last_n', 'rep_pen_range'],
  rep_pen_slope: ['rep_pen_slope'],
  presence: ['presence_penalty'],
  frequency: ['frequency_penalty'],
  phrase_rep_pen: ['dry_multiplier', 'dry_base', 'dry_allowed_length'],
  min_length: ['min_tokens'],
  whitelist: [],
  dynamic_range: [],
  xtc: ['xtc_threshold', 'xtc_probability'],
  banned_strings: ['banned_strings', 'banned_tokens'],
};

const REJECTION = /unsupported|not supported|does not support|doesn't support|unknown|unrecognized|not allowed|not permitted|only the default|invalid/i;

/**
 * Request fields a provider error complains about, among the ones we sent. Used to drop them and retry,
 * e.g. "Unsupported parameter: 'temperature' is not supported with this model."
 */
export function rejectedFields(message: string, sent: Iterable<string>): string[] {
  if (!REJECTION.test(message)) return [];
  const out: string[] = [];
  for (const f of sent) {
    if (new RegExp(`(^|[^\\w])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`).test(message)) out.push(f);
  }
  return out;
}

export function supports(flavor: BackendFlavor, p: ParamId): boolean {
  return backendCaps(flavor).params.includes(p);
}

/** DRY settings standing in for NovelAI's Phrase Repetition Penalty levels. */
const DRY: Record<GenerationParams['phraseRepPen'], number> = { off: 0, very_light: 0.4, light: 0.6, medium: 0.8, aggressive: 1.0, very_aggressive: 1.25 };
const KOBOLD_ORDER: Partial<Record<SamplerId | 'rep_pen', number>> = { top_k: 0, top_a: 1, top_p: 2, tfs: 3, typical_p: 4, temperature: 5 };
const LLAMA_ORDER: Partial<Record<SamplerId, string>> = { top_k: 'top_k', typical_p: 'typ_p', top_p: 'top_p', min_p: 'min_p', temperature: 'temperature' };

export interface PayloadExtras {
  /** token id -> bias (already merged). */
  logitBias?: Record<number, number>;
  /** Number of top alternatives to return per token. */
  logprobs?: number;
  stop?: string[];
  /** Phrases the server should never let through (it backtracks and resamples). */
  banned?: string[];
}

/**
 * Request-body fields for a backend: temperature plus everything else it understands, under its own names.
 * Settings the backend can't take are left out (they stay saved in the preset).
 */
export function samplerPayload(
  p: GenerationParams,
  flavor: BackendFlavor,
  extras: PayloadExtras = {},
  caps: BackendCaps = backendCaps(flavor),
): { temperature?: number; body: Record<string, unknown> } {
  const can = (x: ParamId) => caps.params.includes(x);
  const on = new Set(p.order.filter((s) => s.enabled).map((s) => s.id));
  const b: Record<string, unknown> = {};
  const kobold = flavor === 'koboldcpp';
  const llama = flavor === 'llama.cpp';
  const tabby = flavor === 'tabbyapi';
  if (can('top_p') && on.has('top_p') && p.topP < 1) b.top_p = p.topP;
  if (can('top_k') && on.has('top_k') && p.topK > 0) b.top_k = p.topK;
  if (can('min_p') && on.has('min_p') && p.minP > 0) b.min_p = p.minP;
  if (can('top_a') && on.has('top_a') && p.topA > 0) b.top_a = p.topA;
  if (can('typical_p') && on.has('typical_p') && p.typicalP < 1) b[kobold || tabby ? 'typical' : 'typical_p'] = p.typicalP;
  if (can('tfs') && on.has('tfs') && p.tailFreeSampling < 1) b.tfs = p.tailFreeSampling;
  if (can('mirostat') && on.has('mirostat') && p.mirostatTau > 0) {
    b[tabby ? 'mirostat_mode' : 'mirostat'] = 2;
    b.mirostat_tau = p.mirostatTau;
    b.mirostat_eta = p.mirostatLr;
  }
  if (can('unified') && on.has('unified') && (p.unifiedQuad > 0 || p.unifiedConf > 0)) {
    // Quadratic ("smoothing") sampling is the closest thing these servers have to Unified.
    b.smoothing_factor = p.unifiedQuad;
    if (p.unifiedConf > 0) b.smoothing_curve = 1 + p.unifiedConf;
  }
  if (can('rep_pen') && p.repetitionPenalty !== 1) b[kobold ? 'rep_pen' : llama ? 'repeat_penalty' : 'repetition_penalty'] = p.repetitionPenalty;
  if (can('rep_pen_range') && p.repetitionPenaltyRange > 0) b[kobold ? 'rep_pen_range' : llama ? 'repeat_last_n' : 'penalty_range'] = p.repetitionPenaltyRange;
  if (can('rep_pen_slope') && p.repetitionPenaltySlope > 0) b.rep_pen_slope = p.repetitionPenaltySlope;
  if (can('presence') && p.repetitionPenaltyPresence) b.presence_penalty = p.repetitionPenaltyPresence;
  if (can('frequency') && p.repetitionPenaltyFrequency) b.frequency_penalty = p.repetitionPenaltyFrequency;
  if (can('phrase_rep_pen') && p.phraseRepPen !== 'off') {
    b.dry_multiplier = DRY[p.phraseRepPen];
    b.dry_base = 1.75;
    b.dry_allowed_length = 2;
  }
  if (can('min_length') && p.minLength > 1) b.min_tokens = Math.ceil(p.minLength / 4);
  if (can('xtc') && (p.xtcProbability ?? 0) > 0) {
    b.xtc_probability = p.xtcProbability;
    b.xtc_threshold = p.xtcThreshold ?? 0.1;
  }
  const banned = (extras.banned ?? []).map((x) => x.replace(/^\{([\s\S]*)\}$/, '$1')).filter((x) => x.trim() && !/^\s*\[[\d,\s]+\]\s*$/.test(x));
  if (can('banned_strings') && banned.length) b[kobold ? 'banned_tokens' : 'banned_strings'] = banned;
  if (caps.samplerOrder) {
    if (kobold) {
      const ids = p.order.filter((s) => s.enabled).map((s) => KOBOLD_ORDER[s.id]).filter((x): x is number => x !== undefined);
      // KoboldCpp wants all seven ids; append the ones not in our order (rep pen first, as its default).
      b.sampler_order = [...new Set([6, ...ids, 0, 1, 2, 3, 4, 5])];
    } else if (llama) {
      b.samplers = [...(p.phraseRepPen !== 'off' ? ['dry'] : []), ...p.order.filter((s) => s.enabled).map((s) => LLAMA_ORDER[s.id]).filter(Boolean)];
    }
  }
  if (extras.logitBias && Object.keys(extras.logitBias).length && caps.tokenizer !== 'none') {
    // llama.cpp also accepts the object form, but its native form is a list of [id, bias] pairs.
    b.logit_bias = llama ? Object.entries(extras.logitBias).map(([id, v]) => [Number(id), v]) : extras.logitBias;
  }
  if (extras.logprobs && caps.logprobs) {
    b.logprobs = true;
    b.top_logprobs = Math.min(extras.logprobs, caps.logprobs);
  }
  if (extras.stop?.length && caps.stop) b.stop = extras.stop.slice(0, caps.stop);
  return { temperature: can('temperature') && on.has('temperature') ? p.temperature : undefined, body: b };
}

/** One generated token with the most likely alternatives (natural-log probabilities). */
export interface TokenLogprob {
  token: string;
  logprob: number;
  top: { token: string; logprob: number }[];
}

/** Read OpenAI-style `choices[0].logprobs.content` (or the text-completion layout) from a stream chunk. */
export function chunkLogprobs(chunk: unknown): TokenLogprob[] {
  const lp = (chunk as { choices?: { logprobs?: { content?: unknown[]; tokens?: unknown[]; token_logprobs?: unknown[]; top_logprobs?: unknown[] } }[] })?.choices?.[0]?.logprobs;
  const c = lp?.content;
  if (!Array.isArray(c) && Array.isArray(lp?.tokens) && Array.isArray(lp?.token_logprobs)) {
    // Text completions: parallel arrays, alternatives as { token: logprob } objects.
    return lp.tokens.flatMap((token, i) => {
      const logprob = lp.token_logprobs![i];
      if (typeof token !== 'string' || typeof logprob !== 'number') return [];
      const alts = (lp.top_logprobs?.[i] ?? {}) as Record<string, unknown>;
      const top = Object.entries(alts).filter((e): e is [string, number] => typeof e[1] === 'number').map(([t, l]) => ({ token: t, logprob: l })).sort((a, b) => b.logprob - a.logprob);
      return [{ token, logprob, top }];
    });
  }
  if (!Array.isArray(c)) return [];
  const out: TokenLogprob[] = [];
  for (const raw of c) {
    const t = raw as { token?: unknown; logprob?: unknown; top_logprobs?: unknown[] };
    if (typeof t.token !== 'string' || typeof t.logprob !== 'number') continue;
    const top = (Array.isArray(t.top_logprobs) ? t.top_logprobs : [])
      .map((x) => x as { token?: unknown; logprob?: unknown })
      .filter((x) => typeof x.token === 'string' && typeof x.logprob === 'number')
      .map((x) => ({ token: x.token as string, logprob: x.logprob as number }));
    out.push({ token: t.token, logprob: t.logprob, top });
  }
  return out;
}
