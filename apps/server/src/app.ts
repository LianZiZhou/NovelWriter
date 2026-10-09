import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { AuthType } from '@earendil-works/pi-ai';
import { migrateStory, type GenerateRequest, type Preset, type Shelf, type Story } from '@novelwriter/core';
import { Storage } from './storage.ts';
import { FileCredentialStore } from './credentials.ts';
import { LLM, type CustomProviderConfig } from './llm.ts';
import { runLogin } from './auth-ws.ts';
import { Embeddings, registerEmbeddingRoutes } from './embeddings/index.ts';
import { Nlp, registerNlpRoutes } from './nlp.ts';
import { MASK, listVoices, readTTS, synthesize, writeTTS, type TTSConfig } from './tts.ts';

export interface AppOptions {
  dataDir: string;
  staticDir?: string;
  logger?: boolean;
  /** When set, every request requires HTTP Basic auth with this password (any username). */
  password?: string;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const storage = new Storage(opts.dataDir);
  await storage.init();
  const llm = new LLM(new FileCredentialStore(join(opts.dataDir, 'auth.json')));
  llm.setCustomProviders(await storage.readJson<CustomProviderConfig[]>('custom-providers.json', []));
  const embeddings = new Embeddings(opts.dataDir, storage);

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 50 * 1024 * 1024 });
  if (opts.password) {
    const expected = Buffer.from(opts.password);
    app.addHook('onRequest', async (req, reply) => {
      const header = req.headers.authorization ?? '';
      const decoded = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString() : '';
      const given = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        return reply.code(401).header('www-authenticate', 'Basic realm="NovelWriter"').send({ error: 'Unauthorized' });
      }
    });
  }
  await app.register(cors, { origin: opts.password ? false : true });
  await app.register(websocket);

  // ------------------------------------------------------------- stories
  app.get('/api/stories', async () => storage.listStories());
  app.get<{ Params: { id: string } }>('/api/stories/:id', async (req, reply) => {
    const s = await storage.getStory(req.params.id);
    if (!s) return reply.code(404).send({ error: 'Not found' });
    return s;
  });
  app.put<{ Params: { id: string }; Body: Story }>('/api/stories/:id', async (req) => {
    const story = migrateStory({ ...req.body, id: req.params.id });
    return storage.putStory(story);
  });
  app.delete<{ Params: { id: string } }>('/api/stories/:id', async (req) => {
    await storage.deleteStory(req.params.id);
    embeddings.dropStory(req.params.id);
    return { ok: true };
  });

  // ------------------------------------------------------------- settings / presets / shelves
  app.get('/api/settings', async () => storage.getSettings());
  app.put<{ Body: Record<string, unknown> }>('/api/settings', async (req) => {
    await storage.putSettings(req.body);
    return { ok: true };
  });
  app.get('/api/presets', async () => storage.getPresets());
  app.put<{ Body: Preset[] }>('/api/presets', async (req) => {
    await storage.putPresets(req.body);
    return { ok: true };
  });
  app.get('/api/shelves', async () => storage.getShelves());
  app.put<{ Body: Shelf[] }>('/api/shelves', async (req) => {
    await storage.putShelves(req.body);
    return { ok: true };
  });

  // ------------------------------------------------------------- providers / auth
  app.get('/api/providers', async () => llm.listProviders());
  app.get<{ Querystring: { provider?: string } }>('/api/models', async (req) => llm.listModels(req.query.provider));

  app.put<{ Params: { provider: string }; Body: { key: string } }>('/api/auth/:provider/key', async (req, reply) => {
    if (!llm.models.getProvider(req.params.provider)) return reply.code(404).send({ error: 'Unknown provider' });
    const key = String(req.body?.key ?? '').trim();
    if (!key) return reply.code(400).send({ error: 'Key required' });
    await llm.credentials.modify(req.params.provider, async () => ({ type: 'api_key', key }));
    return { ok: true };
  });
  app.delete<{ Params: { provider: string } }>('/api/auth/:provider', async (req) => {
    await llm.models.logout(req.params.provider);
    return { ok: true };
  });
  app.get<{ Querystring: { provider: string; type: AuthType } }>('/api/auth/login', { websocket: true }, (socket, req) => {
    const { provider, type } = req.query;
    if (!llm.models.getProvider(provider) || (type !== 'oauth' && type !== 'api_key')) {
      socket.send(JSON.stringify({ type: 'error', message: 'Unknown provider or auth type' }));
      socket.close();
      return;
    }
    void runLogin(socket, llm, provider, type);
  });

  app.get('/api/custom-providers', async () =>
    (await storage.readJson<CustomProviderConfig[]>('custom-providers.json', [])).map((c) => ({ ...c, apiKey: c.apiKey ? '••••' : '' })),
  );
  app.put<{ Body: CustomProviderConfig[] }>('/api/custom-providers', async (req) => {
    const prev = await storage.readJson<CustomProviderConfig[]>('custom-providers.json', []);
    const next = req.body.map((c) => ({
      ...c,
      id: c.id || `custom-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      // Keep the stored key when the client sends back the mask.
      apiKey: c.apiKey === '••••' ? prev.find((p) => p.id === c.id)?.apiKey : c.apiKey,
    }));
    await storage.writeJson('custom-providers.json', next);
    llm.setCustomProviders(next);
    return { ok: true };
  });
  /** Fetch the model list of an OpenAI-compatible endpoint (`GET /models`). */
  app.post<{ Body: { baseUrl: string; apiKey?: string; id?: string } }>('/api/custom-providers/probe', async (req, reply) => {
    let key = req.body.apiKey;
    if (key === '••••' && req.body.id) {
      key = (await storage.readJson<CustomProviderConfig[]>('custom-providers.json', [])).find((p) => p.id === req.body.id)?.apiKey;
    }
    try {
      const res = await fetch(`${req.body.baseUrl.replace(/\/$/, '')}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
      if (!res.ok) return reply.code(502).send({ error: `HTTP ${res.status}` });
      const json = (await res.json()) as { data?: { id: string }[]; models?: { name: string }[] };
      return (json.data ?? json.models?.map((m) => ({ id: m.name })) ?? []).map((m) => ({ id: m.id }));
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // ------------------------------------------------------------- generation (SSE)
  app.post<{ Body: GenerateRequest }>('/api/generate', async (req, reply) => {
    const controller = new AbortController();
    reply.raw.on('close', () => controller.abort());
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': String(req.headers.origin ?? '*'),
    });
    const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      for await (const ev of llm.generate(req.body, controller.signal)) send(ev);
    } catch (e) {
      send({ type: 'error', message: (e as Error).message });
    }
    reply.raw.end();
  });

  app.post<{ Body: { model: { provider: string; id: string }; text: string } }>('/api/tokenize', async (req, reply) => {
    try {
      return await llm.tokenize(req.body.model, req.body.text ?? '');
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ------------------------------------------------------------- text to speech
  app.get('/api/tts/config', async () => {
    const c = await readTTS(storage);
    return { ...c, apiKey: c.apiKey ? MASK : '' };
  });
  app.put<{ Body: Partial<TTSConfig> }>('/api/tts/config', async (req) => {
    await writeTTS(storage, req.body);
    return { ok: true };
  });
  app.get('/api/tts/voices', async () => listVoices(await readTTS(storage)));
  app.post<{ Body: { text: string; voice?: string; model?: string; speed?: number; format?: string } }>('/api/tts', async (req, reply) => {
    if (!req.body?.text?.trim()) return reply.code(400).send({ error: 'No text' });
    try {
      const { audio, type } = await synthesize(await readTTS(storage), req.body);
      return reply.type(type).send(audio);
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // ------------------------------------------------------------- embeddings / vector recall
  registerEmbeddingRoutes(app, embeddings);
  // Text analysis (sentence moods for punctuation) on the embedding engine
  registerNlpRoutes(app, new Nlp(embeddings));

  app.get('/api/health', async () => ({ ok: true }));

  if (opts.staticDir && existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, { root: opts.staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
