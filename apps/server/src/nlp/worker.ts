// The process the text-analysis models run in: transformers.js for the classifiers, ONNX Runtime directly for
// Segment any Text. Like the embedding worker it runs from the installed runtime folder, so a driver crash can't
// take the server down.
import { fork, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKER = String.raw`// Written by NovelWriter: runs text-analysis models for the server.
import { createRequire } from 'node:module';
const t = await import('./node_modules/@huggingface/transformers/dist/transformers.node.mjs');
const ort = createRequire(import.meta.url)('onnxruntime-node');
const models = new Map();
const reply = (m) => process.send(m);

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;
const FULLWIDTH = { '.': '。', ',': '，', '?': '？', ':': '：', '-': '——' };
// Marks by the script of the character before them (from the Horizon models' punctuate.py).
const SCRIPT = [
  [/[ऀ-৿]/, { '.': '।' }],
  [/[؀-ۿݐ-ݿ]/, { ',': '،', '?': '؟' }],
  [/[Ͱ-Ͽἀ-῿]/, { '?': ';' }],
  [/[ሀ-፿]/, { '.': '።', ',': '፣' }],
];
function markFor(label, prev) {
  if (CJK.test(prev)) return FULLWIDTH[label] ?? label;
  for (const [re, m] of SCRIPT) if (re.test(prev)) return m[label] ?? (label === '-' ? ' -' : label);
  return label === '-' ? ' -' : label;
}

// The tokenizer gives no character offsets: find each token's text in the input, in order.
function align(tok, text, ids) {
  const spans = [];
  let cur = 0;
  let group = [];
  const place = (piece, n) => {
    piece = piece.replace(/^(##|▁|Ġ)/, '').replace(/^\s+/, '');
    while (cur < text.length && /\s/.test(text[cur]) && !text.startsWith(piece, cur)) cur++;
    let start = cur;
    if (piece && !text.startsWith(piece, cur)) {
      const near = text.toLowerCase().indexOf(piece.toLowerCase(), cur);
      if (near >= 0 && near - cur < 8) start = near;
    }
    const end = Math.min(text.length, start + piece.length);
    for (let k = 0; k < n; k++) spans.push([start, end]);
    cur = end;
  };
  for (const id of ids) {
    group.push(id);
    const piece = tok.decode(group, { skip_special_tokens: false, clean_up_tokenization_spaces: false });
    if (piece.includes('�') && group.length < 4) continue;
    place(piece, group.length);
    group = [];
  }
  if (group.length) place(tok.decode(group), group.length);
  return spans;
}

/** Token ids of a text in windows the model takes, with its special tokens around each. */
function windows(tok, text, size, overlap) {
  const ids = tok.encode(text, { add_special_tokens: false });
  const wrap = tok.encode('');
  const pre = wrap.length >= 2 ? wrap.slice(0, 1) : [];
  const post = wrap.length >= 2 ? wrap.slice(-1) : [];
  const out = [];
  for (let start = 0; start < ids.length; ) {
    const end = Math.min(ids.length, start + size);
    out.push({ start, end, keep: end === ids.length ? end : end - overlap, input: [...pre, ...ids.slice(start, end), ...post], offset: pre.length });
    if (end === ids.length) break;
    start = end - overlap;
  }
  return { ids, out };
}

const softmax = (row) => {
  const m = Math.max(...row);
  const e = row.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
};

async function punctuate(m, text) {
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return { text, question: 0 };
  const { ids, out } = windows(m.tok, text, 400, 50);
  const spans = align(m.tok, text, ids);
  const labels = new Array(ids.length).fill('0');
  let lastProbs = null;
  for (const w of out) {
    const input_ids = new t.Tensor('int64', BigInt64Array.from(w.input.map(BigInt)), [1, w.input.length]);
    const attention_mask = new t.Tensor('int64', new BigInt64Array(w.input.length).fill(1n), [1, w.input.length]);
    const logits = (await m.model({ input_ids, attention_mask })).logits;
    const C = logits.dims[2];
    const data = logits.data;
    for (let k = w.start; k < w.keep; k++) {
      const row = Array.from(data.subarray((k - w.start + w.offset) * C, (k - w.start + w.offset + 1) * C));
      let best = 0;
      for (let c = 1; c < C; c++) if (row[c] > row[best]) best = c;
      labels[k] = m.labels[best];
      if (k === ids.length - 1) lastProbs = softmax(row);
    }
  }
  let res = '';
  let prev = 0;
  const marks = new Map();
  spans.forEach(([, e], k) => {
    if (labels[k] !== '0' && e > 0) marks.set(e, labels[k]);
  });
  for (const e of [...marks.keys()].sort((a, b) => a - b)) {
    // A mark goes at a word end, or after any character in Chinese and Japanese.
    if (!(e === text.length || text[e] === ' ' || CJK.test(text[e - 1]))) continue;
    if (/[\p{P}]/u.test(text[e - 1]) || /^[\p{P}]/u.test(text.slice(e))) continue;
    const mark = markFor(marks.get(e), text[e - 1]);
    res += text.slice(prev, e) + mark;
    prev = e;
    // Full-width marks carry their own space.
    if (mark !== marks.get(e) && text[e] === ' ' && CJK.test(text[e + 1] ?? '')) prev++;
  }
  res += text.slice(prev);
  const q = m.labels.indexOf('?');
  return { text: res, question: lastProbs && q >= 0 ? lastProbs[q] : 0 };
}

function f16(h) {
  const s = h >> 15, e = (h >> 10) & 31, f = h & 1023;
  return (s ? -1 : 1) * (e ? 2 ** (e - 15) * (1 + f / 1024) : 2 ** -14 * (f / 1024));
}

async function segment(m, text, threshold) {
  if (!text.trim()) return { sentences: [] };
  const { ids, out } = windows(m.tok, text, 510, 64);
  const spans = align(m.tok, text, ids);
  const sum = new Float64Array(ids.length);
  const n = new Float64Array(ids.length);
  for (const w of out) {
    const T = w.input.length;
    const feeds = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(w.input.map(BigInt)), [1, T]),
      attention_mask: new ort.Tensor(m.maskType, m.maskType === 'float16' ? new Uint16Array(T).fill(0x3c00) : new Float32Array(T).fill(1), [1, T]),
    };
    const l = (await m.session.run(feeds))[m.session.outputNames[0]];
    const C = l.dims[2];
    // Overlapping windows are averaged, as wtpsplit does.
    for (let k = w.start; k < w.end; k++) {
      const v = l.data[(k - w.start + w.offset) * C];
      sum[k] += 1 / (1 + Math.exp(-(l.type === 'float16' ? f16(v) : v)));
      n[k]++;
    }
  }
  const sentences = [];
  let prev = 0;
  spans.forEach(([, e], k) => {
    if (sum[k] / (n[k] || 1) <= threshold || e <= prev) return;
    let end = e;
    // A token can run past the sentence end into the next one's opening quote ("。“").
    while (end > prev + 1 && /[\p{Ps}\p{Pi}]/u.test(text[end - 1])) end--;
    while (end < text.length && /[\p{Pe}\p{Pf}"'」』]/u.test(text[end])) end++;
    const s = text.slice(prev, end).trim();
    if (s) sentences.push(s);
    prev = end;
  });
  const rest = text.slice(prev).trim();
  if (rest) sentences.push(rest);
  return { sentences };
}

async function entities(m, text) {
  const found = new Map();
  // The pipeline truncates long input: tag it a few sentences at a time.
  const parts = text.match(/[^\n。！？!?.]{1,300}[\n。！？!?.]*/g) ?? [];
  for (const part of parts) {
    if (!part.trim()) continue;
    const res = await m.pipe(part, { aggregation_strategy: 'simple' });
    for (const r of res) {
      const type = String(r.entity_group ?? r.entity ?? '').replace(/^[BI]-/, '');
      let word = String(r.word ?? '').replace(/ ##/g, '').replace(/(?<=[㐀-鿿]) (?=[㐀-鿿])/g, '').trim();
      if (!word || !type || type === 'O') continue;
      const key = type + '\u0001' + word;
      const e = found.get(key) ?? { text: word, type, score: 0, count: 0 };
      e.score = Math.max(e.score, r.score);
      e.count++;
      found.set(key, e);
    }
  }
  return { entities: [...found.values()].sort((a, b) => b.count - a.count || b.score - a.score) };
}

async function load(msg) {
  t.env.allowRemoteModels = false;
  t.env.allowLocalModels = true;
  t.env.localModelPath = msg.modelsDir;
  t.env.useFSCache = false;
  t.env.useBrowserCache = false;
  const opts = { dtype: msg.dtype, device: msg.device, session_options: msg.sessionOptions };
  const tok = await t.AutoTokenizer.from_pretrained(msg.model);
  if (msg.runner === 'sat') {
    const session = await ort.InferenceSession.create(msg.modelsDir + msg.model + '/model.onnx', msg.sessionOptions);
    const mask = session.inputMetadata?.find?.((x) => x.name === 'attention_mask');
    return { runner: 'sat', tok, session, maskType: mask?.type === 'float32' ? 'float32' : 'float16' };
  }
  if (msg.runner === 'sequence') return { runner: 'sequence', pipe: await t.pipeline('text-classification', msg.model, opts) };
  if (msg.task === 'entities') return { runner: 'token', pipe: await t.pipeline('token-classification', msg.model, opts) };
  const model = await t.AutoModelForTokenClassification.from_pretrained(msg.model, opts);
  const id2label = model.config.id2label;
  return { runner: 'token', tok, model, labels: Object.keys(id2label).sort((a, b) => a - b).map((k) => id2label[k]) };
}

process.on('message', async (msg) => {
  try {
    if (msg.type === 'load') {
      if (!models.has(msg.model)) models.set(msg.model, load(msg));
      try {
        await models.get(msg.model);
      } catch (e) {
        models.delete(msg.model);
        throw e;
      }
      return reply({ id: msg.id, ok: true });
    }
    const m = await models.get(msg.model);
    if (!m) throw new Error('Model not loaded: ' + msg.model);
    if (msg.type === 'punctuate') {
      const results = [];
      for (const x of msg.texts) results.push(await punctuate(m, x));
      reply({ id: msg.id, ok: true, results });
    } else if (msg.type === 'segment') {
      reply({ id: msg.id, ok: true, result: await segment(m, msg.text, msg.threshold) });
    } else if (msg.type === 'classify') {
      const results = [];
      for (const x of msg.texts) results.push(await m.pipe(x, { top_k: msg.topK }));
      reply({ id: msg.id, ok: true, results });
    } else if (msg.type === 'entities') {
      reply({ id: msg.id, ok: true, result: await entities(m, msg.text) });
    }
  } catch (e) {
    reply({ id: msg.id, ok: false, error: String((e && e.message) || e) });
  }
});
reply({ type: 'ready' });
`;

export interface NlpLoad {
  model: string;
  task: string;
  runner: string;
  dtype?: string;
  device: string;
  sessionOptions: Record<string, unknown>;
}

/** The worker process and the models loaded in it. */
export class NlpWorker {
  private child: ChildProcess | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private stderr = '';

  constructor(
    dir: string,
    private readonly modelsDir: string,
  ) {
    const file = join(dir, 'nlp-worker.mjs');
    writeFileSync(file, WORKER);
    const child = fork(file, [], {
      cwd: dir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    this.child = child;
    child.stderr?.on('data', (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000);
    });
    child.on('message', (msg: Record<string, unknown>) => {
      const p = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined;
      if (!p) return;
      this.pending.delete(msg.id as number);
      if (msg.ok) p.resolve(msg);
      else p.reject(new Error(String(msg.error)));
    });
    child.on('exit', (code, signal) => {
      const err = new Error(`The text-analysis worker stopped (${signal ?? `exit code ${code}`}). ${this.stderr.trim().split('\n').slice(-3).join(' ')}`.trim());
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.child = null;
    });
  }

  call(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('The text-analysis worker is not running.'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.send({ ...msg, id });
    });
  }

  load(l: NlpLoad): Promise<Record<string, unknown>> {
    return this.call({ type: 'load', modelsDir: `${this.modelsDir.replace(/[\\/]+$/, '')}/`, ...l });
  }

  alive(): boolean {
    return this.child !== null;
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }
}
