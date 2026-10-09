import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall, type Context } from '@earendil-works/pi-ai';
import { DIRECTOR_TOOLS, toolSpecs, type DirectorTurnEvent, type DirectorTurnRequest } from '@novelwriter/core';
import { buildApp } from '../src/app.ts';
import { LLM } from '../src/llm.ts';
import { FileCredentialStore } from '../src/credentials.ts';

let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nw-'));
  app = await buildApp({ dataDir: dir });
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const tools = toolSpecs(DIRECTOR_TOOLS);

function events(body: string): DirectorTurnEvent[] {
  return body
    .split('\n\n')
    .filter((c) => c.startsWith('data: '))
    .map((c) => JSON.parse(c.slice(6)) as DirectorTurnEvent);
}

async function collect(gen: AsyncGenerator<DirectorTurnEvent>): Promise<DirectorTurnEvent[]> {
  const out: DirectorTurnEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe('director turns', () => {
  it('runs the scripted demo director over SSE', async () => {
    const req: DirectorTurnRequest = { model: { provider: 'demo', id: 'markov' }, system: 's', messages: [{ role: 'user', content: 'Write.' }], tools };
    const res = await app.inject({ method: 'POST', url: '/api/agent/turn', payload: req });
    const evs = events(res.body);
    const done = evs.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type !== 'done') return;
    expect(done.toolCalls.map((c) => c.name)).toEqual(['update_plan', 'write_passage']);
    expect(evs.some((e) => e.type === 'delta')).toBe(true);

    // After three passages it records lore and memory, then finishes.
    const later: DirectorTurnRequest = {
      ...req,
      messages: [
        req.messages[0],
        ...[1, 2, 3].flatMap((i) => [
          { role: 'assistant' as const, content: '', toolCalls: [{ id: `w${i}`, name: 'write_passage', args: { beat: 'b' } }] },
          { role: 'tool' as const, toolCallId: `w${i}`, name: 'write_passage', content: 'text' },
        ]),
      ],
    };
    const next = events((await app.inject({ method: 'POST', url: '/api/agent/turn', payload: later })).body).at(-1);
    expect(next?.type === 'done' && next.toolCalls.map((c) => c.name)).toEqual(['update_plan', 'upsert_lore_entry', 'update_memory']);
  });

  it('maps native tool calls and results through pi-ai', async () => {
    const llm = new LLM(new FileCredentialStore(join(dir, 'auth-faux.json')));
    const faux = fauxProvider({ provider: 'faux', tokensPerSecond: 0 });
    llm.models.setProvider(faux.provider);
    let seen: Context | undefined;
    faux.setResponses([
      (ctx) => {
        seen = ctx as unknown as Context;
        return fauxAssistantMessage([fauxText('Planning.'), fauxToolCall('write_passage', { beat: 'go' }, { id: 'call-2' })], { stopReason: 'toolUse' });
      },
    ]);
    const model = faux.getModel();
    const evs = await collect(
      llm.turn(
        {
          model: { provider: 'faux', id: model.id },
          system: 'You direct.',
          messages: [
            { role: 'user', content: 'goal' },
            { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'read_story', args: {} }] },
            { role: 'tool', toolCallId: 'call-1', name: 'read_story', content: 'The rain fell.' },
          ],
          tools,
        },
        new AbortController().signal,
      ),
    );
    const done = evs.at(-1);
    expect(done).toMatchObject({ type: 'done', text: 'Planning.', toolCalls: [{ id: 'call-2', name: 'write_passage', args: { beat: 'go' } }] });
    const msgs = seen!.messages;
    const result = msgs.find((m) => m.role === 'toolResult');
    expect(result).toMatchObject({ toolCallId: 'call-1', toolName: 'read_story', content: [{ type: 'text', text: 'The rain fell.' }] });
    const call = msgs.find((m) => m.role === 'assistant');
    expect(call?.role === 'assistant' && call.content[0]).toMatchObject({ type: 'toolCall', id: 'call-1', name: 'read_story' });
  });

  it('sends thinking blocks back to the model that wrote them', async () => {
    const llm = new LLM(new FileCredentialStore(join(dir, 'auth-faux2.json')));
    const faux = fauxProvider({ provider: 'faux2', tokensPerSecond: 0 });
    llm.models.setProvider(faux.provider);
    const contexts: Context[] = [];
    faux.setResponses([
      (ctx) => {
        contexts.push(ctx as unknown as Context);
        return fauxAssistantMessage([fauxThinking('Let me look first.'), fauxToolCall('story_overview', {}, { id: 'c1' })], { stopReason: 'toolUse' });
      },
      (ctx) => {
        contexts.push(ctx as unknown as Context);
        return fauxAssistantMessage([fauxToolCall('finish', { summary: 'ok' }, { id: 'c2' })], { stopReason: 'toolUse' });
      },
    ]);
    const ref = { provider: 'faux2', id: faux.getModel().id };
    const first = (await collect(llm.turn({ model: ref, system: 's', messages: [{ role: 'user', content: 'goal' }], tools }, new AbortController().signal))).at(-1);
    expect(first?.type === 'done' && first.native?.content.map((c) => (c as { type: string }).type)).toEqual(['thinking', 'toolCall']);
    if (first?.type !== 'done') return;
    await collect(
      llm.turn(
        {
          model: ref,
          system: 's',
          messages: [
            { role: 'user', content: 'goal' },
            { role: 'assistant', content: first.text, toolCalls: first.toolCalls, native: first.native },
            { role: 'tool', toolCallId: 'c1', name: 'story_overview', content: 'overview' },
          ],
          tools,
        },
        new AbortController().signal,
      ),
    );
    const sent = contexts[1].messages.find((m) => m.role === 'assistant');
    expect(sent?.role === 'assistant' && sent.content[0]).toMatchObject({ type: 'thinking', thinking: 'Let me look first.' });
  });
});
