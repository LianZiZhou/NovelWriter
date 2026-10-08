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
import { samplingParams, defaultParams, type GenerateRequest } from '@novelwriter/core';
import { demoContinuation } from './demo.ts';
import { FileCredentialStore } from './credentials.ts';

export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: { id: string; name?: string; contextWindow?: number; maxTokens?: number }[];
}

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

  listModels(provider?: string) {
    return this.models.getModels(provider).map((m) => ({
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
  async *generate(req: GenerateRequest, signal: AbortSignal): AsyncGenerator<{ type: 'delta'; text: string } | { type: 'done'; stopReason: string; usage?: unknown }> {
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

    const { temperature, samplingParams: sp } = samplingParams(params);
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
    if (Object.keys(sp).length && (model.api === 'openai-completions' || this.customIds.has(model.provider))) options.samplingParams = sp;
    if (req.stop?.length && model.api === 'openai-completions') options.samplingParams = { ...(options.samplingParams as object), stop: req.stop.slice(0, 4) };

    const s = this.models.streamSimple(model as Model<Api>, context, options);
    for await (const ev of s) {
      if (ev.type === 'text_delta') yield { type: 'delta', text: ev.delta };
      else if (ev.type === 'error') {
        if (ev.reason === 'aborted') {
          yield { type: 'done', stopReason: 'aborted' };
          return;
        }
        throw new Error(ev.error.errorMessage || 'Generation failed');
      } else if (ev.type === 'done') {
        const msg = await s.result();
        yield { type: 'done', stopReason: msg.stopReason, usage: msg.usage };
        return;
      }
    }
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
