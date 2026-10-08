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
  for (const t of tokens) {
    if (t === '\n') out += '\n';
    else if (/^[.,!?;:”…]$/.test(t)) out += t;
    else if (out === '' || out.endsWith('\n') || out.endsWith('“') || out.endsWith('"') && (out.match(/"/g)?.length ?? 0) % 2 === 1) out += t;
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
