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
  detectTemplate,
  INSTRUCT_TEMPLATES,
  renderInstruct,
  type ChatMessage,
  type InstructTemplateId,
  loadTokenizer,
  modelCaps,
  rejectedFields,
  samplerPayload,
  tokenIds,
  type BackendCaps,
  type BackendFlavor,
  type ModelCaps,
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
  /**
   * Run the models as text completion (`/completions`) instead of chat: `instruct` renders requests in the
   * model's chat template, `raw` sends story continuations as plain text (base models, NovelAI style).
   */
  completion?: 'off' | 'instruct' | 'raw';
  /** Instruct template; `auto` reads the server's chat template (llama.cpp) or goes by the model name. */
  template?: InstructTemplateId | 'auto';
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
  /** Request fields providers refused per model ("provider/id"), learned from their errors this run. */
  private rejected = new Map<string, Set<string>>();
  /** Instruct templates found for `auto` ("provider/id"). */
  private templates = new Map<string, InstructTemplateId>();

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
    this.templates.clear();
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

  /** What a model accepts: its flavor's settings minus what the model itself (or its provider) rejects. */
  capsOf(model: Model<Api>): ModelCaps {
    const levels = model.reasoning ? getSupportedThinkingLevels(model) : [];
    const thinkingForced = Boolean(model.reasoning && levels.length && !levels.includes('off'));
    const traits = { provider: model.provider, api: model.api, id: model.id, reasoning: Boolean(model.reasoning), thinkingForced };
    const caps = modelCaps(this.flavorOf(model), traits, this.rejected.get(`${model.provider}/${model.id}`) ?? []);
    // As text completion the reply is left open in the prompt, so a prefill is always continued.
    if (this.completionMode(model.provider) !== 'off') caps.prefill = true;
    return caps;
  }

  /** Whether a provider's models run as text completion, and how. */
  completionMode(provider: string): 'off' | 'instruct' | 'raw' {
    return this.custom.get(provider)?.completion ?? 'off';
  }

  listModels(provider?: string) {
    return this.models.getModels(provider).map((m) => ({
      flavor: this.flavorOf(m),
      caps: this.capsOf(m as Model<Api>),
      provider: m.provider,
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning,
      api: m.api,
      completion: this.completionMode(m.provider) === 'off' ? undefined : this.completionMode(m.provider),
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
    const toMessages = (list: ChatMessage[]): Message[] => list.map((m) =>
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
    const context: Context = { systemPrompt: req.system, messages: toMessages(req.messages) };
    const maxTokens = Math.min(req.maxTokens ?? Math.ceil(params.maxLength / 4), model.maxTokens || 4096);

    if (model.provider === DEMO_PROVIDER) {
      yield* this.demo(req, maxTokens * 4, signal);
      return;
    }
    const custom = this.custom.get(model.provider);
    if (custom && this.completionMode(model.provider) !== 'off') {
      yield* this.complete(model as Model<Api>, custom, req, params, maxTokens, signal);
      return;
    }

    const flavor = this.flavorOf(model);
    const key = `${model.provider}/${model.id}`;
    let fellBack = false;
    // A provider may still refuse a setting we thought it takes; drop what it names and retry (twice at most).
    for (let attempt = 0; ; attempt++) {
      const caps = this.capsOf(model as Model<Api>);
      const logitBias = await this.logitBias(req, flavor, model.provider, caps).catch(() => undefined);
      const { temperature, body } = samplerPayload(params, flavor, { logitBias, logprobs: req.logprobs, stop: req.stop, banned: req.banned }, caps);
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
      const sendsBody = Object.keys(body).length > 0 && model.api === 'openai-completions';
      if (sendsBody) options.samplingParams = body;
      const sent = [...(temperature !== undefined ? ['temperature'] : []), ...(sendsBody ? Object.keys(body) : [])];
      // Token probabilities aren't surfaced by the adapter; read them from the raw stream.
      const probs: TokenLogprob[] = [];
      if (sendsBody && body.logprobs) options.fetch = tapLogprobs((t) => probs.push(...t));

      let emitted = false;
      const retryWithout = (message: string): boolean => {
        if (emitted || attempt >= 3) return false;
        const set = this.rejected.get(key) ?? new Set<string>();
        const bad = rejectedFields(message, sent);
        if (!bad.length) {
          // A model that won't continue the story's last lines (prefill) gets the request without them.
          if (!req.fallbackMessages || fellBack) return false;
          fellBack = true;
          context.messages = toMessages(req.fallbackMessages);
          bad.push('prefill');
        }
        for (const f of bad) set.add(f);
        this.rejected.set(key, set);
        return true;
      };
      const flush = function* (): Generator<GenerateEvent> {
        if (probs.length) yield { type: 'logprobs', tokens: probs.splice(0) };
      };
      try {
        const s = this.models.streamSimple(model as Model<Api>, context, options);
        let retry = false;
        for await (const ev of s) {
          if (ev.type === 'text_delta') {
            emitted = true;
            yield* flush();
            yield { type: 'delta', text: ev.delta };
          } else if (ev.type === 'error') {
            if (ev.reason === 'aborted') {
              yield { type: 'done', stopReason: 'aborted' };
              return;
            }
            const message = ev.error.errorMessage || 'Generation failed';
            if (retryWithout(message)) {
              retry = true;
              break;
            }
            throw new Error(message);
          } else if (ev.type === 'done') {
            const msg = await s.result();
            // The tapped copy of the stream may finish parsing a moment after the adapter.
            await new Promise((r) => setTimeout(r, 30));
            yield* flush();
            yield { type: 'done', stopReason: msg.stopReason, usage: msg.usage };
            return;
          }
        }
        if (!retry) return;
      } catch (e) {
        if (signal.aborted || !retryWithout((e as Error).message ?? String(e))) throw e;
      }
    }
  }

  /**
   * Text completion against an OpenAI-compatible `/completions` endpoint (llama.cpp, KoboldCpp, TabbyAPI, vLLM):
   * the request is rendered in the model's instruct template, or sent as the plain story text in raw mode.
   */
  private async *complete(
    model: Model<Api>,
    c: CustomProviderConfig,
    req: GenerateRequest,
    params: ReturnType<typeof defaultParams>,
    maxTokens: number,
    signal: AbortSignal,
  ): AsyncGenerator<GenerateEvent> {
    const flavor = c.flavor ?? 'openai-compatible';
    const key = `${model.provider}/${model.id}`;
    // Raw mode sends story continuations as they are; other requests (titles, lore…) still need instructions.
    const plain = c.completion === 'raw' && typeof req.prompt === 'string';
    const tpl = INSTRUCT_TEMPLATES[c.completion === 'raw' ? 'alpaca' : c.template && c.template !== 'auto' ? c.template : await this.autoTemplate(c, model.id)];
    const prompt = plain ? req.prompt! : renderInstruct(tpl, req.system, req.messages, { modelId: model.id });
    const stop = [...(plain ? [] : tpl.stop), ...(req.stop ?? [])];
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (c.apiKey) headers.authorization = `Bearer ${c.apiKey}`;
    for (let attempt = 0; ; attempt++) {
      const caps = this.capsOf(model);
      const logitBias = await this.logitBias(req, flavor, model.provider, caps).catch(() => undefined);
      const { temperature, body } = samplerPayload(params, flavor, { logitBias, logprobs: req.logprobs, stop, banned: req.banned }, { ...caps, stop: Math.max(caps.stop, 16) });
      // Text completions take the number of alternatives as `logprobs`.
      if (body.logprobs) {
        body.logprobs = body.top_logprobs;
        delete body.top_logprobs;
      }
      const payload: Record<string, unknown> = { model: model.id, prompt, max_tokens: maxTokens, stream: true, ...body };
      if (temperature !== undefined) payload.temperature = temperature;
      let res: Response;
      try {
        res = await fetch(`${c.baseUrl.replace(/\/+$/, '')}/completions`, { method: 'POST', headers, body: JSON.stringify(payload), signal });
      } catch (e) {
        if (signal.aborted) return void (yield { type: 'done', stopReason: 'aborted' });
        throw e;
      }
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        const bad = attempt < 3 ? rejectedFields(text, Object.keys(payload).filter((k) => !['model', 'prompt', 'max_tokens', 'stream'].includes(k))) : [];
        if (bad.length) {
          const set = this.rejected.get(key) ?? new Set<string>();
          for (const f of bad) set.add(f);
          this.rejected.set(key, set);
          continue;
        }
        throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let stopReason = 'stop';
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
            let chunk: { choices?: { text?: string; finish_reason?: string | null }[]; content?: string };
            try {
              chunk = JSON.parse(line.slice(5));
            } catch {
              continue;
            }
            const probs = chunkLogprobs(chunk);
            if (probs.length) yield { type: 'logprobs', tokens: probs };
            const text = chunk.choices?.[0]?.text ?? chunk.content ?? '';
            if (text) yield { type: 'delta', text };
            const fin = chunk.choices?.[0]?.finish_reason;
            if (fin) stopReason = fin === 'length' ? 'length' : 'stop';
          }
        }
      } catch (e) {
        if (signal.aborted) return void (yield { type: 'done', stopReason: 'aborted' });
        throw e;
      }
      yield { type: 'done', stopReason };
      return;
    }
  }

  /** The instruct template for `auto`: from the server's chat template (llama.cpp `/props`), else the model name. */
  private async autoTemplate(c: CustomProviderConfig, modelId: string): Promise<InstructTemplateId> {
    const key = `${c.id}/${modelId}`;
    const known = this.templates.get(key);
    if (known) return known;
    let jinja = '';
    try {
      const root = c.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
      const r = await fetch(`${root}/props`, { headers: c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}, signal: AbortSignal.timeout(3000) });
      if (r.ok) jinja = String(((await r.json()) as { chat_template?: unknown }).chat_template ?? '');
    } catch {
      /* not llama.cpp, or unreachable: go by the name */
    }
    const id = detectTemplate(modelId, jinja);
    this.templates.set(key, id);
    return id;
  }

  /** Phrase bias and single-token banned phrases as token-id logit biases, when the backend can tokenize. */
  private async logitBias(req: GenerateRequest, flavor: BackendFlavor, provider: string, caps: BackendCaps): Promise<Record<number, number> | undefined> {
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
    // The model's own tokenizer, even when it takes no logit bias (reasoning models).
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
