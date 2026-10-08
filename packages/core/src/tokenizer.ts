/**
 * Token counting. Chat providers each use their own tokenizer, so this is an
 * approximation (o200k_base) used for context budgeting and display. Until
 * `loadTokenizer()` resolves, a character heuristic is used.
 */
export interface Tokenizer {
  encode(text: string): number[];
  decode(tokens: number[]): string;
}

let impl: Tokenizer | null = null;
let loading: Promise<void> | null = null;

export function loadTokenizer(): Promise<void> {
  if (impl) return Promise.resolve();
  loading ??= (async () => {
    const [{ Tiktoken }, ranks] = await Promise.all([
      import('js-tiktoken/lite'),
      import('js-tiktoken/ranks/o200k_base'),
    ]);
    const enc = new Tiktoken(ranks.default);
    impl = { encode: (t) => enc.encode(t), decode: (t) => enc.decode(t) };
  })();
  return loading;
}

export function tokenizerReady(): boolean {
  return impl !== null;
}

/** Approximate encoding used before the real tokenizer is loaded: ~4 chars per token. */
function heuristicEncode(text: string): number[] {
  const out: number[] = [];
  const re = /\s*[\p{L}\p{N}]{1,4}|\s*[^\s\p{L}\p{N}]|\s+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m.index);
  return out;
}

export function countTokens(text: string): number {
  if (!text) return 0;
  return impl ? impl.encode(text).length : heuristicEncode(text).length;
}

/** Split text into token strings (for the Tokenize view and token-level trimming). */
export function tokenize(text: string): string[] {
  if (!text) return [];
  if (impl) {
    const ids = impl.encode(text);
    const out: string[] = [];
    let prev = '';
    // Decode cumulatively so multi-byte characters split across tokens stay intact.
    for (let i = 0; i < ids.length; i++) {
      const s = impl.decode(ids.slice(0, i + 1));
      out.push(s.slice(prev.length));
      prev = s;
    }
    return out;
  }
  const starts = heuristicEncode(text);
  return starts.map((s, i) => text.slice(s, starts[i + 1] ?? text.length));
}

export function tokenIds(text: string): number[] {
  return impl ? impl.encode(text) : heuristicEncode(text);
}
