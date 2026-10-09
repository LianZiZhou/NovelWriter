// Measures how well the text-analysis pipeline picks sentence-final punctuation: the words alone, an embedding
// model alone, and the two blended, on sentences that are not among the model's examples. Installs the ONNX runtime
// and the given models into a temporary data folder.
// Usage: tsx apps/server/scripts/check-nlp.ts [model ids…]   (default: bge-small-zh-v1.5 multilingual-e5-small)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bestMood, blendMood, guessMood, type Lang, type Mood, type MoodScores } from '@novelwriter/core';
import { buildApp } from '../src/app.ts';

const CASES: [string, Lang, Mood][] = [
  ['他到底想干什么', 'zh', 'question'],
  ['你从哪里来', 'zh', 'question'],
  ['你确定要这么做', 'zh', 'question'],
  ['你也是来找她的', 'zh', 'question'],
  ['我们还能回去吗', 'zh', 'question'],
  ['这把剑是谁留下的', 'zh', 'question'],
  ['你怎么会在这里', 'zh', 'question'],
  ['门后面有人', 'zh', 'question'],
  ['你没受伤吧', 'zh', 'question'],
  ['难道你忘了', 'zh', 'question'],
  ['快躲起来', 'zh', 'exclamation'],
  ['别碰那个', 'zh', 'exclamation'],
  ['真是个好消息啊', 'zh', 'exclamation'],
  ['火烧起来了', 'zh', 'exclamation'],
  ['放下武器', 'zh', 'exclamation'],
  ['救救我', 'zh', 'exclamation'],
  ['好大的雪', 'zh', 'exclamation'],
  ['我拿起提灯', 'zh', 'statement'],
  ['我不记得你是谁', 'zh', 'statement'],
  ['她说她明天会来', 'zh', 'statement'],
  ['我们先休息一下吧', 'zh', 'statement'],
  ['跟着灯走', 'zh', 'statement'],
  ['我看向窗外', 'zh', 'statement'],
  ['问问他从哪里来', 'zh', 'statement'],
  ['这里很安静', 'zh', 'statement'],
  ['我把信交给她', 'zh', 'statement'],
  ['where did she go', 'en', 'question'],
  ['you really think so', 'en', 'question'],
  ['have we met before', 'en', 'question'],
  ['what do you want from me', 'en', 'question'],
  ['anyone home', 'en', 'question'],
  ['she left without you', 'en', 'question'],
  ['hide', 'en', 'exclamation'],
  ['the house is on fire', 'en', 'exclamation'],
  ['put it down', 'en', 'exclamation'],
  ['what a terrible idea', 'en', 'exclamation'],
  ['oh no', 'en', 'exclamation'],
  ['I pick up the lantern', 'en', 'statement'],
  ["I don't know where she went", 'en', 'statement'],
  ['we should rest here tonight', 'en', 'statement'],
  ['I look out the window', 'en', 'statement'],
  ['ask him where he came from', 'en', 'statement'],
  ['it is quiet here', 'en', 'statement'],
];

const models = process.argv.slice(2).length ? process.argv.slice(2) : ['bge-small-zh-v1.5', 'multilingual-e5-small'];
const dir = mkdtempSync(join(tmpdir(), 'nw-nlp-'));
const app = await buildApp({ dataDir: dir });
const call = async <T = Record<string, unknown>>(method: 'GET' | 'POST' | 'PUT', url: string, payload?: object): Promise<T> => {
  const r = await app.inject({ method, url, payload });
  const body = r.json() as T & { error?: string };
  if (r.statusCode >= 400) throw new Error(`${url}: ${body.error ?? r.statusCode}`);
  return body;
};
const waitTask = async (task: { id: string; label: string }) => {
  for (;;) {
    const t = (await call<{ id: string; status: string; error?: string }[]>('GET', '/api/embeddings/tasks')).find((x) => x.id === task.id)!;
    if (t.status === 'done') return;
    if (t.status !== 'running') throw new Error(`${task.label}: ${t.error ?? t.status}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

const pct = (n: number) => `${Math.round((n / CASES.length) * 100)}%`;
const rules = CASES.map(([t, lang]) => guessMood(t, lang));
console.log(`words alone: ${pct(rules.filter((g, i) => g.mood === CASES[i][2]).length)}`);
try {
  await call('PUT', '/api/embeddings/config', { enabled: true, source: 'onnx', onnx: { device: 'cpu' } });
  await waitTask(await call('POST', '/api/embeddings/runtime/onnx'));
  for (const model of models) {
    await call('PUT', '/api/embeddings/config', { onnx: { model } });
    await waitTask(await call('POST', '/api/embeddings/models', { kind: 'onnx', repo: model }));
    const { scores } = await call<{ scores: (MoodScores | null)[] }>('POST', '/api/nlp/mood', { texts: CASES.map((c) => c[0]) });
    let alone = 0;
    let blended = 0;
    const wrong: string[] = [];
    CASES.forEach(([t, , want], i) => {
      if (scores[i] && bestMood(scores[i]!) === want) alone++;
      const got = blendMood(rules[i], scores[i]).mood;
      if (got === want) blended++;
      else wrong.push(`${t} (${got}, want ${want})`);
    });
    console.log(`${model}: model alone ${pct(alone)}, blended ${pct(blended)}`);
    console.log(`  wrong: ${wrong.join('; ')}`);
  }
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
