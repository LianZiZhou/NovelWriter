import type { DirectorToolCall, DirectorTurnRequest } from '@novelwriter/core';
/**
 * Offline demo "model": a word-level Markov chain over the request context
 * plus a small built-in corpus. Lets the app (and tests) run with no API key.
 */
const CORPUS = `
The rain had softened to a mist by the time she reached the old bridge. Lanterns swayed along the railing, their light pooling on the wet stones.
He paused at the door, listening. Somewhere below, a clock struck the hour, and the sound rolled through the empty halls like distant thunder.
"We should not be here," she whispered, but she did not turn back.
The city stretched beneath them, a tangle of rooftops and chimneys, smoke curling into the pale morning sky.
For a long moment no one spoke. Then the stranger smiled, and the tension broke like ice on a spring river.
She ran her fingers along the spine of the book, feeling the worn leather and the faint ridges of a title long since faded.
The wind carried the scent of salt and pine, and with it, the memory of a summer she had tried hard to forget.
"Tell me what you saw," he said quietly. "All of it, from the beginning."
Far to the north, the mountains rose like broken teeth against the horizon, their peaks lost in cloud.
The fire crackled and spat, throwing long shadows across the walls of the little cabin.
She counted the steps as she climbed, as she always did, and found there was one more than there should have been.
Outside, the street was quiet, save for the patient drip of water from the eaves.
`;

function words(text: string): string[] {
  return text.match(/[\p{L}\p{N}'’]+|[.,!?;:"“”—…-]|\n/gu) ?? [];
}

function join(tokens: string[]): string {
  let out = '';
  let inQuote = false;
  for (const t of tokens) {
    const isQuote = t === '"' || t === '“' || t === '”';
    if (t === '\n') out += '\n';
    else if (isQuote) {
      // Opening quotes attach to the next word, closing quotes to the previous one.
      out += inQuote ? t : out === '' || out.endsWith('\n') ? t : ` ${t}`;
      inQuote = !inQuote;
    } else if (/^[.,!?;:…]$/.test(t)) out += t;
    else if (out === '' || out.endsWith('\n') || (inQuote && /["“]$/.test(out))) out += t;
    else out += ' ' + t;
  }
  return out;
}

export function demoContinuation(context: string, maxChars: number, seed = Date.now()): string {
  let s = seed % 2147483647 || 1;
  const rand = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  const src = words(`${CORPUS}\n${context.slice(-6000)}`);
  const chain = new Map<string, string[]>();
  for (let i = 0; i + 2 < src.length; i++) {
    const k = `${src[i]} ${src[i + 1]}`.toLowerCase();
    const list = chain.get(k) ?? [];
    list.push(src[i + 2]);
    chain.set(k, list);
  }
  const ctxWords = words(context);
  let a = ctxWords[ctxWords.length - 2] ?? 'The';
  let b = ctxWords[ctxWords.length - 1] ?? 'rain';
  const out: string[] = [];
  let len = 0;
  while (len < maxChars) {
    let next = chain.get(`${a} ${b}`.toLowerCase());
    if (!next) {
      // Restart from a random sentence start.
      const starts = [...chain.keys()].filter((k) => /^[.!?] /.test(k));
      const k = starts[Math.floor(rand() * starts.length)] ?? '. the';
      const [, w] = k.split(' ');
      next = [w[0].toUpperCase() + w.slice(1)];
    }
    const w = next[Math.floor(rand() * next.length)];
    out.push(w);
    len += w.length + 1;
    a = b;
    b = w;
    if (len > maxChars * 0.6 && /[.!?]/.test(w)) break;
  }
  const text = join(out);
  return /^[.,!?;:]/.test(text) ? text : ' ' + text.trimStart();
}

const DEMO_BEATS = [
  'The traveller reaches the edge of town as the rain begins; describe the empty street and the single lit window.',
  'A stranger at the inn seems to recognise the traveller; keep the exchange short and guarded.',
  'Night falls; the traveller notices the stranger leaving through the back door and decides to follow.',
  'At the river the stranger stops and speaks without turning around; end on what is said.',
];

/**
 * The offline Demo model as Director: a fixed little session (plan, a few passages, a lorebook entry, memory,
 * finish) chosen from how far the transcript has got, so the whole harness can be tried without an AI provider.
 */
export function demoDirector(req: DirectorTurnRequest): { text: string; toolCalls: DirectorToolCall[] } {
  const done = (name: string) => req.messages.filter((m) => m.role === 'tool' && m.name === name && !m.isError).length;
  const can = (name: string) => req.tools.some((t) => t.name === name);
  const id = () => `demo-${Math.random().toString(36).slice(2, 10)}`;
  const call = (name: string, args: Record<string, unknown>): DirectorToolCall => ({ id: id(), name, args });
  const passages = done('write_passage');
  const plan = (active: number) =>
    call('update_plan', {
      steps: ['Set the scene', 'Introduce the stranger', 'Raise the stakes', 'Record what we learned'].map((text, i) => ({ text, status: i < active ? 'done' : i === active ? 'active' : 'pending' })),
    });
  const first = !req.messages.some((m) => m.role === 'assistant');
  if (first) {
    return { text: "I'll set a short plan, then write the opening beats one at a time.", toolCalls: [plan(0), ...(can('write_passage') ? [call('write_passage', { beat: DEMO_BEATS[0] })] : [])] };
  }
  if (can('write_passage') && passages < 3) {
    return { text: passages === 1 ? 'Good start. Now the stranger.' : 'Raising the stakes.', toolCalls: [plan(Math.min(passages, 2)), call('write_passage', { beat: DEMO_BEATS[passages] })] };
  }
  if (can('upsert_lore_entry') && !done('upsert_lore_entry')) {
    return {
      text: 'The stranger will matter later, so they get a lorebook entry and a line in memory.',
      toolCalls: [
        plan(3),
        call('upsert_lore_entry', { name: 'The Stranger', keys: ['stranger'], type: 'Person', text: 'The Stranger is a tall figure in a grey coat who seems to know the traveller from somewhere. Speaks softly, rarely gives a straight answer.' }),
        ...(can('update_memory') ? [call('update_memory', { text: 'A traveller arrives in a river town in the rain and is drawn after a stranger who seems to know them.' })] : []),
      ],
    };
  }
  return { text: 'That covers the goal for this session.', toolCalls: [call('finish', { summary: `Wrote ${passages} passages, added a lorebook entry for the stranger and updated memory.` })] };
}
