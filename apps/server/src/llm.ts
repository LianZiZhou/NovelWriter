import {
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  getSupportedThinkingLevels,
  type Api,
  type Context,
  type Message,
  type Model,
  type MutableModels,
} from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import {
  backendCaps,
  chunkLogprobs,
  defaultParams,
  loadTokenizer,
  samplerPayload,
  tokenIds,
  type BackendFlavor,
  type GenerateRequest,
  type TokenLogprob,
} from '@novelwriter/core';
import { demoContinuation } from './demo.ts';
import { FileCredentialStore } from './credentials.ts';

export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  /** Which server software this is, so the right sampler names are sent. */
  flavor?: BackendFlavor;
  models: { id: string; name?: string; contextWindow?: number; maxTokens?: number }[];
}

export type GenerateEvent =
  | { type: 'delta'; text: string }
  | { type: 'logprobs'; tokens: TokenLogprob[] }
  | { type: 'done'; stopReason: string; usage?: unknown };

export const DEMO_PROVIDER = 'demo';

const demoModels: Model<'openai-completions'>[] = [
  {
    id: 'markov',
    name: 'Demo (offline, no key)',
    api: 'openai-completions',
    provider: DEMO_PROVIDER,
    baseUrl: 'http://localhost/demo',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 4096,
  },
];

export class LLM {
  readonly models: MutableModels;
  private customIds = new Set<string>();
  private custom = new Map<string, CustomProviderConfig>();

  constructor(readonly credentials: FileCredentialStore) {
    this.models = builtinModels({ credentials });
    this.models.setProvider(
      createProvider({
        id: DEMO_PROVIDER,
        name: 'NovelWriter Demo',
        auth: { apiKey: { name: 'No key needed', resolve: async () => ({ auth: {}, source: 'built-in' }) } },
        models: demoModels,
        api: openAICompletionsApi(),
      }),
    );
  }

  setCustomProviders(list: CustomProviderConfig[]): void {
    for (const id of this.customIds) if (!list.some((c) => c.id === id)) this.models.deleteProvider(id);
    this.customIds = new Set(list.map((c) => c.id));
    this.custom = new Map(list.map((c) => [c.id, c]));
    for (const c of list) {
      const key = c.apiKey;
      this.models.setProvider(
        createProvider({
          id: c.id,
          name: c.name,
          baseUrl: c.baseUrl,
          auth: { apiKey: { name: `${c.name} API key`, resolve: async () => ({ auth: { apiKey: key || 'no-key' }, source: key ? 'custom key' : 'no key' }) } },
          models: c.models.map(
            (m): Model<'openai-completions'> => ({
              id: m.id,
              name: m.name ?? m.id,
              api: 'openai-completions',
              provider: c.id,
              baseUrl: c.baseUrl,
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: m.contextWindow ?? 32768,
              maxTokens: m.maxTokens ?? 4096,
              compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsStore: false, maxTokensField: 'max_tokens' },
            }),
          ),
          api: openAICompletionsApi(),
        }),
      );
    }
  }

  isCustom(id: string): boolean {
    return this.customIds.has(id);
  }

  /** Providers with auth capabilities and whether they are configured. */
  async listProviders() {
    const out = [];
    for (const p of this.models.getProviders()) {
      let configured = false;
      let source: string | undefined;
      let error: string | undefined;
      try {
        const check = await this.models.checkAuth(p.id);
        configured = Boolean(check);
        source = check?.source;
      } catch (e) {
        error = (e as Error).message;
      }
      const stored = await this.credentials.read(p.id);
      out.push({
        id: p.id,
        name: p.name,
        apiKey: p.auth.apiKey ? { name: p.auth.apiKey.name, interactive: Boolean(p.auth.apiKey.login) } : null,
        oauth: p.auth.oauth ? { name: p.auth.oauth.name, label: p.auth.oauth.loginLabel ?? null, subscription: Boolean(p.auth.oauth.isSubscription) } : null,
        configured,
        source,
        stored: stored?.type ?? null,
        error,
        custom: this.customIds.has(p.id),
        modelCount: p.getModels().length,
      });
    }
    return out;
  }

  /** The kind of server behind a model; decides which generation settings are sent. */
  flavorOf(model: { provider: string; api: string }): BackendFlavor {
    if (model.provider === DEMO_PROVIDER) return 'demo';
    const custom = this.custom.get(model.provider);
    if (custom) return custom.flavor ?? 'openai-compatible';
    if (model.provider === 'openrouter') return 'openrouter';
    if (model.api === 'openai-completions') return model.provider === 'openai' ? 'openai' : 'openai-compatible';
    return 'chat-only';
  }

  listModels(provider?: string) {
    return this.models.getModels(provider).map((m) => ({
      flavor: this.flavorOf(m),
      provider: m.provider,
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning,
      api: m.api,
    }));
  }

  /**
   * Stream a generation. Yields text deltas; resolves the final stop reason.
   */
  async *generate(req: GenerateRequest, signal: AbortSignal): AsyncGenerator<GenerateEvent> {
    const model = this.models.getModel(req.model.provider, req.model.id);
    if (!model) throw new Error(`Unknown model ${req.model.provider}/${req.model.id}`);
    const params = defaultParams(req.params ?? {});
    const now = Date.now();
    const messages: Message[] = req.messages.map((m) =>
      m.role === 'user'
        ? { role: 'user', content: m.content, timestamp: now }
        : {
            role: 'assistant',
            content: [{ type: 'text', text: m.content }],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: 'stop',
            timestamp: now,
          },
    );
    const context: Context = { systemPrompt: req.system, messages };
    const maxTokens = Math.min(req.maxTokens ?? Math.ceil(params.maxLength / 4), model.maxTokens || 4096);

    if (model.provider === DEMO_PROVIDER) {
      yield* this.demo(req, maxTokens * 4, signal);
      return;
    }

    const flavor = this.flavorOf(model);
    const caps = backendCaps(flavor);
    const logitBias = await this.logitBias(req, flavor, model.provider).catch(() => undefined);
    const { temperature, body } = samplerPayload(params, flavor, { logitBias, logprobs: req.logprobs, stop: req.stop });
    const options: Record<string, unknown> = { maxTokens, signal };
    // Story continuation wants no (or minimal) thinking. Models that cannot turn
    // thinking off get the lowest level and extra budget so output isn't starved.
    if (model.reasoning) {
      const levels = getSupportedThinkingLevels(model);
      if (!levels.includes('off') && levels.length) {
        options.reasoning = levels[0];
        options.maxTokens = maxTokens + 2048;
      }
    }
    if (temperature !== undefined) options.temperature = temperature;
    if (Object.keys(body).length && model.api === 'openai-completions') options.samplingParams = body;
    // Token probabilities aren't surfaced by the adapter; read them from the raw stream.
    const probs: TokenLogprob[] = [];
    if (req.logprobs && caps.logprobs && model.api === 'openai-completions') options.fetch = tapLogprobs((t) => probs.push(...t));

    const s = this.models.streamSimple(model as Model<Api>, context, options);
    const flush = function* (): Generator<GenerateEvent> {
      if (probs.length) yield { type: 'logprobs', tokens: probs.splice(0) };
    };
    for await (const ev of s) {
      if (ev.type === 'text_delta') {
        yield* flush();
        yield { type: 'delta', text: ev.delta };
      } else if (ev.type === 'error') {
        if (ev.reason === 'aborted') {
          yield { type: 'done', stopReason: 'aborted' };
          return;
        }
        throw new Error(ev.error.errorMessage || 'Generation failed');
      } else if (ev.type === 'done') {
        const msg = await s.result();
        // The tapped copy of the stream may finish parsing a moment after the adapter.
        await new Promise((r) => setTimeout(r, 30));
        yield* flush();
        yield { type: 'done', stopReason: msg.stopReason, usage: msg.usage };
        return;
      }
    }
  }

  /** Phrase bias and single-token banned phrases as token-id logit biases, when the backend can tokenize. */
  private async logitBias(req: GenerateRequest, flavor: BackendFlavor, provider: string): Promise<Record<number, number> | undefined> {
    const caps = backendCaps(flavor);
    if (caps.tokenizer === 'none') return undefined;
    const encode = async (text: string): Promise<number[]> => {
      const ids = /^\s*\[([\d,\s]+)\]\s*$/.exec(text);
      if (ids) return ids[1].split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
      const t = /^\{([\s\S]*)\}$/.exec(text.trim())?.[1] ?? text;
      if (caps.tokenizer === 'o200k') {
        await loadTokenizer();
        return tokenIds(t);
      }
      return this.remoteTokenize(provider, flavor, t);
    };
    const out: Record<number, number> = {};
    for (const g of req.bias ?? []) {
      for (const phrase of g.phrases) {
        const ids = await encode(phrase);
        // Like NovelAI on chat models: only the first token of a sequence is biased.
        if (ids.length) out[ids[0]] = Math.max(-100, Math.min(100, (out[ids[0]] ?? 0) + g.bias));
      }
    }
    for (const phrase of req.banned ?? []) {
      const ids = await encode(phrase);
      if (ids.length === 1) out[ids[0]] = -100;
    }
    return Object.keys(out).length ? out : undefined;
  }

  /** Token ids for `text` with the model's own tokenizer when we can reach it, else none. */
  async tokenize(ref: { provider: string; id: string }, text: string): Promise<{ tokenizer: 'o200k' | 'remote' | 'none'; ids: number[] }> {
    const model = this.models.getModel(ref.provider, ref.id);
    if (!model) throw new Error(`Unknown model ${ref.provider}/${ref.id}`);
    const flavor = this.flavorOf(model);
    const kind = backendCaps(flavor).tokenizer;
    if (kind === 'o200k') {
      await loadTokenizer();
      return { tokenizer: kind, ids: tokenIds(text) };
    }
    if (kind === 'remote') return { tokenizer: kind, ids: await this.remoteTokenize(model.provider, flavor, text) };
    return { tokenizer: 'none', ids: [] };
  }

  /** Tokenize with the inference server's own tokenizer (llama.cpp, vLLM, KoboldCpp, TabbyAPI). */
  private async remoteTokenize(provider: string, flavor: BackendFlavor, text: string): Promise<number[]> {
    const c = this.custom.get(provider);
    if (!c) return [];
    const root = c.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (c.apiKey) headers.authorization = `Bearer ${c.apiKey}`;
    const post = async (path: string, body: unknown) => {
      const r = await fetch(root + path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`tokenize: HTTP ${r.status}`);
      return (await r.json()) as Record<string, unknown>;
    };
    if (flavor === 'llama.cpp') return ((await post('/tokenize', { content: text, add_special: false })).tokens as number[]) ?? [];
    if (flavor === 'vllm') return ((await post('/tokenize', { model: c.models[0]?.id, prompt: text, add_special_tokens: false })).tokens as number[]) ?? [];
    if (flavor === 'koboldcpp') return ((await post('/api/extra/tokencount', { prompt: text })).ids as number[]) ?? [];
    if (flavor === 'tabbyapi') return ((await post('/v1/token/encode', { text, add_bos_token: false })).tokens as number[]) ?? [];
    return [];
  }

  private async *demo(req: GenerateRequest, maxChars: number, signal: AbortSignal) {
    const ctx = req.messages.map((m) => m.content).join('\n');
    const isAux = /HypeBot|lorebook entries|titles for stories|fiction editor/.test(req.system ?? '');
    const text = isAux ? auxDemo(req.system ?? '', ctx) : demoContinuation(ctx, Math.min(maxChars, 600));
    const faux = fauxProvider({ provider: DEMO_PROVIDER, tokensPerSecond: 80 });
    faux.setResponses([fauxAssistantMessage([fauxText(text)])]);
    const s = faux.provider.streamSimple(faux.getModel(), { messages: [] } as never, { signal });
    for await (const ev of s) {
      if (signal.aborted) {
        yield { type: 'done' as const, stopReason: 'aborted' };
        return;
      }
      if (ev.type === 'text_delta') yield { type: 'delta' as const, text: ev.delta };
    }
    if (req.logprobs && !isAux) yield { type: 'logprobs' as const, tokens: demoLogprobs(text, ctx, req.logprobs) };
    yield { type: 'done' as const, stopReason: 'stop' };
  }
}

function auxDemo(system: string, ctx: string): string {
  if (system.includes('HypeBot')) {
    const lines = ['Ooh, the tension! I did NOT see that coming.', 'Okay but what if the stranger knows more than they let on?', 'This is getting good. Somebody should open that door!', 'I love the atmosphere here. Rain makes everything better.'];
    return lines[Math.floor(Math.random() * lines.length)];
  }
  if (system.includes('titles for stories')) {
    const t = ['The Quiet Hour', 'Lanterns in the Mist', 'What the River Kept', 'The Last Bridge', 'A Map of Small Fires'];
    return t[Math.floor(Math.random() * t.length)];
  }
  if (system.includes('lorebook entries')) {
    const m = /entry for: ([^\n]+)/.exec(ctx);
    const subject = (m?.[1] ?? 'The subject').trim();
    return `${subject} is a figure spoken of in hushed tones along the river towns. Few have met them in person, yet everyone seems to know a story — most of them contradictory, all of them strange.`;
  }
  const p = /Passage:\n"""\n([\s\S]*?)\n"""/.exec(ctx);
  return p ? p[1].replace(/\bvery\b/g, 'truly').replace(/\./g, ', and the moment lingered.').slice(0, 2000) : ctx.slice(0, 200);
}

/**
 * A fetch that hands the response to the adapter unchanged while parsing a copy of the SSE stream for
 * `choices[0].logprobs` (the adapter drops them).
 */
function tapLogprobs(onTokens: (t: TokenLogprob[]) => void): typeof fetch {
  return async (input, init) => {
    const res = await fetch(input, init);
    if (!res.body || !(res.headers.get('content-type') ?? '').includes('event-stream')) return res;
    const [mine, theirs] = res.body.tee();
    void (async () => {
      const reader = mine.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
            try {
              const t = chunkLogprobs(JSON.parse(line.slice(5)));
              if (t.length) onTokens(t);
            } catch {
              /* not JSON */
            }
          }
        }
      } catch {
        /* aborted */
      }
    })();
    return new Response(theirs, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

/** Plausible-looking token probabilities for the offline demo model (words from the context as alternatives). */
function demoLogprobs(text: string, ctx: string, n: number): TokenLogprob[] {
  const vocab = [...new Set(ctx.match(/[A-Za-z']{3,}/g) ?? ['the', 'rain', 'door'])].slice(0, 400);
  let seed = text.length * 7919;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return (text.match(/\s*[^\s]+|\s+/g) ?? []).map((token) => {
    const p = 0.25 + rnd() * 0.7;
    const lead = token.match(/^\s*/)?.[0] ?? '';
    const alts = [...new Set(Array.from({ length: Math.max(0, Math.min(n, 10) - 1) * 2 }, () => lead + vocab[Math.floor(rnd() * vocab.length)]))].filter((a) => a !== token).slice(0, Math.max(0, Math.min(n, 10) - 1));
    let rest = 1 - p;
    const top = [{ token, logprob: Math.log(p) }, ...alts.map((a) => {
      const q = rest * (0.2 + rnd() * 0.5);
      rest -= q;
      return { token: a, logprob: Math.log(Math.max(q, 1e-6)) };
    })];
    return { token, logprob: Math.log(p), top };
  });
}
