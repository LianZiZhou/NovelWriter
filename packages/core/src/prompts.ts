import { buildContext, RECALL_WRAP, stripComments, SUMMARY_WRAP, type BuiltContext, type ContextSourceKind } from './context.ts';
import { displayAction } from './adventure.ts';
import { stripThinking } from './instruct.ts';
import { expandMacros } from './macros.ts';
import { DEFAULT_SYSTEM_PROMPT_ADVENTURE, DEFAULT_SYSTEM_PROMPT_STORY } from './defaults.ts';
import { docText } from './doc.ts';
import { countTokens } from './tokenizer.ts';
import type { VectorHits } from './recall.ts';
import type { ChatMessage, GenerationParams, PhraseBiasGroup, SideChat, Story } from './types.ts';

/** Characters per token for English prose; the fallback when there is no text to measure. */
export const CHARS_PER_TOKEN = 4;

/**
 * Characters per token of `sample` (the story's own text), so a length in characters becomes the right
 * number of tokens: about 4 for English but only ~1.1 for Chinese.
 */
export function charsPerToken(sample: string): number {
  const s = sample.slice(-4000);
  if (s.trim().length < 40) return CHARS_PER_TOKEN;
  const n = countTokens(s);
  return n > 0 ? Math.min(6, Math.max(0.8, s.length / n)) : CHARS_PER_TOKEN;
}

/** Output tokens for NovelAI's character output length, measured against the story's own text. */
export function outputTokens(params: GenerationParams, sample = ''): number {
  return Math.max(16, Math.ceil(params.maxLength / charsPerToken(sample)));
}

export interface StoryRequest {
  system: string;
  messages: ChatMessage[];
  /** The same request without a story-tail prefill, for models that turn out to reject prefills. */
  fallbackMessages?: ChatMessage[];
  /** NovelAI's context text as is, for raw-completion models. */
  raw: string;
  context: BuiltContext;
  maxTokens: number;
  stop: string[];
  /** Active phrase-bias groups, for backends that take logit_bias. */
  bias: { phrases: string[]; bias: number }[];
  /** The story puts its paragraphs on consecutive lines, so blank lines in the reply are collapsed (see `postProcess`). */
  singleBreaks: boolean;
}

function biasInstructions(groups: PhraseBiasGroup[], banned: string[], banBrackets: boolean, avoidOverused: boolean): string {
  const lines: string[] = [];
  const favored = groups.filter((g) => g.bias > 0).flatMap((g) => g.phrases);
  const disfavored = groups.filter((g) => g.bias < 0).flatMap((g) => g.phrases);
  if (favored.length) lines.push(`Where natural, favor using: ${favored.map((p) => JSON.stringify(stripBraces(p))).join(', ')}.`);
  if (disfavored.length) lines.push(`Avoid using: ${disfavored.map((p) => JSON.stringify(stripBraces(p))).join(', ')}.`);
  if (banned.length) lines.push(`Never write any of these: ${banned.map((p) => JSON.stringify(stripBraces(p))).join(', ')}.`);
  if (banBrackets) lines.push('Never write square brackets.');
  // No examples: a phrase named in the prompt is a phrase the model is primed to write.
  if (avoidOverused) lines.push('Prefer fresh, specific wording of your own to the stock phrases and sentence patterns common in machine-written fiction.');
  return lines.join(' ');
}

/** Phrase bias entries use `{exact text}` or `[token ids]`; we only support text. */
export function stripBraces(p: string): string {
  const m = /^\{(.*)\}$/s.exec(p.trim());
  return m ? m[1] : p;
}

/**
 * How the assembled context reaches the model.
 * - `classic`: NovelAI's context text verbatim as one user message (the layout NovelAI's own models were trained on).
 * - `structured`: for chat models, laid out the way NovelAI sends a story to its GLM models. Memory, lore and story
 *   info go into the system prompt as labelled background; the story itself is the model's own earlier turns (the
 *   player's actions in between are the user's turns), so the model carries on as the story's author instead of
 *   answering a request about it. The Author's Note and the request close the conversation (where models weigh them
 *   most), and where the model allows it, the story's last lines open its reply so it continues them word for word.
 */
export type PromptLayout = 'classic' | 'structured';

/** Wording for NovelAI's `[ S: n ]` quality tag, which only NovelAI's models understand. */
const STYLE_WORDS = ['', 'simple, casual prose', 'plain, readable prose', 'competent, engaging prose', 'polished, well-crafted prose', 'exceptional, award-worthy literary prose'];

/** Title, author, genre, tags and style tag in plain words, for models that don't know NovelAI's ATTG line. */
export function storyInfoText(s: Story): string {
  const lines: string[] = [];
  if (s.title && s.title !== 'New Story') lines.push(`Title: ${s.title}`);
  if (s.author) lines.push(`Author: ${s.author}`);
  if (s.genre) lines.push(`Genre: ${s.genre}`);
  if (s.tags.length) lines.push(`Tags: ${s.tags.join(', ')}`);
  if (s.styleTag > 0) lines.push(`Prose quality: ${STYLE_WORDS[Math.min(5, Math.max(1, Math.round(s.styleTag)))]}`);
  return lines.join('\n');
}

const BACKGROUND_TAG: Partial<Record<ContextSourceKind, string>> = { memory: 'memory', lore: 'lore', subcontext: 'lore', ephemeral: 'note', summary: 'summary', recall: 'earlier_passage' };

/** The story's last lines, to open the reply with (empty when the story ends at a line break or is short). */
export function continuationTail(text: string): string {
  if (!text || /\s$/.test(text)) return '';
  const nl = text.lastIndexOf('\n');
  let from = nl >= 0 ? nl + 1 : 0;
  // Long paragraphs: start at a sentence or word boundary within the last ~300 characters.
  if (text.length - from > 300) {
    const win = text.slice(-300);
    const cut = /[.!?…。！？」』"”]\s*/g;
    let at = -1;
    for (const m of win.matchAll(cut)) if ((m.index ?? 0) + m[0].length < win.length - 20) at = (m.index ?? 0) + m[0].length;
    if (at < 0) at = Math.max(0, win.indexOf(' ') + 1);
    from = text.length - 300 + at;
  }
  const tail = text.slice(from);
  return tail.trim().length >= 8 ? tail.replace(/^\s+/, '') : '';
}

/** What the prompt has to say about the story's own notation. */
interface Notation {
  /** Bracketed lines are how the story is written (stage or sound cues), not notes about it. */
  bracketFormat: boolean;
  /** Paragraphs sit on consecutive lines rather than being separated by blank lines. */
  singleBreaks: boolean;
  notes: string[];
}

function notation(body: string, opts: { classic: boolean; adventure: boolean }): Notation {
  const lines = body.split('\n').filter((l) => l.trim());
  const bracketed = lines.filter((l) => /^\s*\[.*\]\s*$/.test(l)).length;
  const bracketFormat = lines.length >= 5 && bracketed / lines.length >= 0.15;
  const breaks = (body.match(/\n/g) ?? []).length;
  const blank = (body.match(/\n[ \t]*\n/g) ?? []).length;
  const singleBreaks = breaks >= 6 && blank <= breaks * 0.1;
  const notes: string[] = [];
  if (opts.classic && opts.adventure) notes.push('Lines beginning with ">" are the player\'s actions.');
  if (opts.classic && !bracketFormat) notes.push('Lines in [square brackets] are notes and background from the author; follow them, and never continue or repeat them as story.');
  else if (bracketed && !bracketFormat) notes.push('Lines in [square brackets] within the story are notes from the author, such as scene headings; follow them, and never continue them as story.');
  if (/^\s*\{[^}]*\}\s*$/m.test(body)) notes.push('A line in {curly braces} is the author\'s instruction for what to write next: carry it out in the story, leaving the braces and the instruction itself out.');
  return { bracketFormat, singleBreaks, notes };
}

/** The story as conversation turns: prose is the model's own (assistant) turns, the player's actions are user turns. */
function storyTurns(body: string, adventure: boolean): ChatMessage[] {
  const out: ChatMessage[] = [];
  const push = (role: ChatMessage['role'], content: string) => {
    const prev = out[out.length - 1];
    if (prev?.role === role) prev.content += (role === 'user' ? '\n' : '') + content;
    else out.push({ role, content });
  };
  let prose = '';
  const flush = () => {
    const t = prose.replace(/^\n+/, '');
    if (t.trim()) push('assistant', t);
    prose = '';
  };
  for (const line of body.split(/(?<=\n)/)) {
    if (adventure && /^>/.test(line)) {
      flush();
      const action = displayAction(line).trim();
      if (action) push('user', action);
    } else prose += line;
  }
  flush();
  // Earlier prose turns end cleanly; only the last one keeps its exact ending, since the reply continues it.
  out.forEach((m, i) => {
    if (m.role === 'assistant' && i < out.length - 1) m.content = m.content.replace(/\s+$/, '');
  });
  return out;
}

/** Merge consecutive messages of the same role (providers want them alternating). */
function alternate(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content = `${prev.content.replace(/\s+$/, '')}\n\n${m.content}`;
    else out.push({ ...m });
  }
  return out;
}

/** The last few words of the story, quoted, so a model without prefill knows exactly where to pick up. */
function endingQuote(text: string): string {
  const t = text.replace(/\s+$/, '');
  const line = t.slice(t.lastIndexOf('\n') + 1);
  return line.length > 40 ? `…${line.slice(-40)}` : line;
}

export interface StoryRequestOptions {
  maxContextTokens: number;
  model?: string;
  storyText?: string;
  /** Inline generation at the cursor; `after` is only sent when bidirectional. */
  inline?: { before: string; after: string; bidirectional?: boolean };
  nativeBias?: boolean;
  preamble?: boolean;
  layout?: PromptLayout;
  /** The model continues a final assistant message (prefill); enables opening the reply with the story's tail. */
  prefill?: boolean;
  random?: () => number;
  /** Embedding search results for recalled passages. */
  vectors?: VectorHits;
  /**
   * The model's tokens per o200k token, measured from what the provider reported for earlier requests. The
   * context is sized in o200k tokens, so the budget is scaled down by it (and the output length up).
   */
  tokenRatio?: number;
}

/** Build the request that continues the story. */
export function buildStoryRequest(story: Story, opts: StoryRequestOptions): StoryRequest {
  const params = story.params;
  const out = outputTokens(params, opts.inline?.before ?? opts.storyText ?? (docText(story.doc) || story.memory));
  // Text after the gap is part of the request too, so it comes out of the context budget.
  const afterText = opts.inline?.bidirectional ? stripComments(opts.inline.after.slice(0, 2000)) : '';
  const ratio = calibrationRatio(opts.tokenRatio);
  const ctx = buildContext(story, {
    // A few percent to spare: the ratio is an average, and chat formatting adds tokens of its own.
    maxContextTokens: Math.floor((opts.maxContextTokens / ratio) * (ratio === 1 ? 1 : 0.97)) - countTokens(afterText),
    outputTokens: out,
    model: opts.model,
    storyText: opts.inline ? opts.inline.before : opts.storyText,
    random: opts.random,
    vectors: opts.vectors,
  });
  const classic = (opts.layout ?? 'classic') === 'classic';
  const adventure = story.mode === 'adventure';
  const storyBody = ctx.segments.filter((seg) => seg.kind === 'story').map((seg) => seg.text).join('');
  const note = notation(storyBody, { classic, adventure });
  const base = expandMacros(story.systemPrompt.trim(), ctx.macroEnv) || (adventure ? DEFAULT_SYSTEM_PROMPT_ADVENTURE : DEFAULT_SYSTEM_PROMPT_STORY);
  // With native logit bias the phrase bias is sent as token biases instead of instructions. A story written in
  // bracketed cues keeps its brackets.
  const extra = biasInstructions(opts.nativeBias ? [] : ctx.phraseBias, story.bannedTokens, story.banBrackets && !note.bracketFormat, story.avoidOverusedWords);
  // A target rather than a ceiling: "or less" reads as "keep it short", and the token limit already caps the length.
  const lengthHint = `Write about ${params.maxLength} characters.`;
  // NovelAI's context text as is: what a raw-completion model continues.
  const raw = (opts.preamble && ctx.text && ctx.text.length < 1000 && !opts.inline ? '⁂\n' : '') + ctx.text;
  const result = (system: string, messages: ChatMessage[], fallback?: ChatMessage[]): StoryRequest => ({
    system,
    messages,
    fallbackMessages: fallback,
    raw,
    context: ctx,
    maxTokens: Math.round(out * ratio),
    stop: story.stopSequences.filter(Boolean),
    bias: ctx.phraseBias.filter((g) => g.enabled !== false && g.bias !== 0 && g.phrases.length).map((g) => ({ phrases: g.phrases, bias: g.bias })),
    singleBreaks: note.singleBreaks,
  });
  const gap = Boolean(opts.inline?.bidirectional && afterText.trim());

  if (classic) {
    let system = [base, note.notes.join(' '), extra, lengthHint].filter(Boolean).join('\n\n');
    let user: string;
    if (gap) {
      system +=
        '\n\nYou are filling a gap inside the story. Write only the text that belongs at <GAP/>, so that it flows naturally into the text after it.';
      user = `${ctx.text}<GAP/>${afterText}`;
    } else if (opts.inline) {
      system += '\n\nContinue from exactly where the text stops; your text will be inserted there.';
      user = ctx.text || '(The story has not started yet. Begin it.)';
    } else {
      user = ctx.text || '(The story has not started yet. Begin it.)';
      // "Preamble": on a short story, mark the start of the text so the model treats it as prose to continue.
      if (opts.preamble && ctx.text && ctx.text.length < 1000) user = `⁂\n${user}`;
    }
    const messages: ChatMessage[] = [{ role: 'user', content: user }];
    if (story.prefill) messages.push({ role: 'assistant', content: story.prefill });
    return result(system, messages);
  }

  // Structured: background into the system prompt, the story as the model's own turns, instructions at the end.
  const labels = new Map(ctx.report.map((r) => [r.id, r.label]));
  const background: string[] = [];
  const notes: string[] = [];
  let prev: string | null = null;
  for (const seg of ctx.segments) {
    if (seg.kind === 'story') {
      prev = null;
      continue;
    }
    const wrap = seg.kind === 'summary' ? SUMMARY_WRAP : seg.kind === 'recall' ? RECALL_WRAP : null;
    const text = (wrap && seg.text.startsWith(wrap.prefix) && seg.text.endsWith(wrap.suffix) ? seg.text.slice(wrap.prefix.length, -wrap.suffix.length) : seg.text).trim();
    if (!text || seg.sourceId === prev) continue;
    prev = seg.sourceId;
    if (seg.kind === 'authorsNote') notes.push(text);
    else if (seg.kind === 'attg') {
      const info = storyInfoText(story);
      if (info) background.push(`<story_info>\n${info}\n</story_info>`);
    } else {
      const tag = BACKGROUND_TAG[seg.kind] ?? 'note';
      const name = seg.kind === 'lore' || seg.kind === 'subcontext' ? ` name="${(labels.get(seg.sourceId) ?? '').replace(/"/g, "'")}"` : '';
      background.push(`<${tag}${name}>\n${text}\n</${tag}>`);
    }
  }
  let system = [base, note.notes.join(' '), extra].filter(Boolean).join('\n\n');
  if (background.length) {
    system +=
      '\n\nBackground for the story follows: the author\'s memory notes, lorebook entries about people, places and things, and other notes. ' +
      'Use it to stay consistent; never copy it into the story.\n\n<background>\n' +
      background.join('\n\n') +
      '\n</background>';
  }
  const after: string[] = [];
  if (notes.length) after.push(`Author's note for what comes next (follow it, never repeat it):\n${notes.join('\n')}`);
  if (gap) {
    const user = `<story>\n${storyBody}<GAP/>${afterText}\n</story>\n\n${[...after, `Write only the text that belongs at <GAP/>, so that it flows naturally into the text after it. ${lengthHint}`].join('\n\n')}`;
    return result(system, [{ role: 'user', content: user }]);
  }

  // The closing request, after everything else (depth 0, where SillyTavern's presets and NovelAI put reminders).
  const request = (how: string) => `<instructions>\n${[...after, `${how} ${lengthHint}`].join('\n\n')}\n</instructions>`;
  const opener = adventure ? 'Begin the adventure.' : 'Begin the story.';
  const turns = storyTurns(storyBody, adventure);
  if (!turns.length) {
    const messages: ChatMessage[] = [{ role: 'user', content: `${opener}\n\n${request(adventure ? 'Open the adventure with its first scene.' : 'Write the opening of the story.')}` }];
    if (story.prefill) messages.push({ role: 'assistant', content: story.prefill });
    return result(system, messages);
  }
  if (turns[0].role === 'assistant') turns.unshift({ role: 'user', content: opener });
  const last = turns[turns.length - 1];

  if (last.role === 'user') {
    // The player has just acted: their action is the request, with the reminders after it.
    const messages = alternate([...turns.slice(0, -1), { role: 'user', content: `${last.content}\n\n${request('Narrate what happens next.')}` }]);
    if (story.prefill) messages.push({ role: 'assistant', content: story.prefill });
    return result(system, messages);
  }

  // The story itself is the last turn and the reply continues it.
  const atLineStart = /\n\s*$/.test(last.content);
  const how = atLineStart
    ? 'Continue the story with what comes next, starting on a new line.'
    : `Continue the story from exactly where it stops (it ends with "${endingQuote(last.content)}"); if that is mid-sentence or mid-word, finish it first, and never repeat it.`;
  const plain = alternate([...turns.slice(0, -1), { ...last, content: last.content.replace(/\s+$/, '') }, { role: 'user', content: request(how) }]);
  if (story.prefill) return result(system, [...plain, { role: 'assistant', content: story.prefill }]);
  const tail = opts.prefill ? continuationTail(last.content) : '';
  if (!tail) return result(system, plain);
  // As NovelAI does: the reply opens with the story's last lines, so the model continues them word for word.
  const head = last.content.slice(0, last.content.length - tail.length).replace(/\s+$/, '');
  const ask = request('Continue the story. Your reply already begins with its next lines; carry on from them seamlessly, mid-sentence if needed.');
  const lead = head.trim() ? [...turns.slice(0, -1), { role: 'assistant' as const, content: head }, { role: 'user' as const, content: ask }] : [...turns.slice(0, -1), { role: 'user' as const, content: ask }];
  return result(system, [...alternate(lead), { role: 'assistant', content: tail }], plain);
}

/**
 * Make generated text join the existing story cleanly: add a separating space
 * when the model omitted one, apply stop sequences, and optionally trim to the
 * end of the last complete sentence.
 */
export function postProcess(
  existing: string,
  generated: string,
  opts: { stop?: string[]; trimToSentence?: boolean; minLength?: number; banned?: string[]; singleBreaks?: boolean } = {},
): string {
  let g = stripThinking(generated.replace(/\r\n/g, '\n'));
  // Chat models separate paragraphs with blank lines; a story written without them stays that way.
  if (opts.singleBreaks) g = g.replace(/\n[ \t]*\n(?:[ \t]*\n)*/g, '\n');
  // Some models echo the tail of the context; drop exact overlap.
  const tail = existing.slice(-200);
  for (let n = Math.min(tail.length, g.length); n >= 12; n--) {
    if (g.startsWith(tail.slice(-n))) {
      g = g.slice(n);
      break;
    }
  }
  for (const s of opts.stop ?? []) {
    const idx = g.indexOf(s, opts.minLength ?? 0);
    if (s && idx >= 0) g = g.slice(0, idx);
  }
  for (const b of opts.banned ?? []) {
    const t = stripBraces(b);
    if (t) g = g.split(t).join('');
  }
  if (opts.trimToSentence) {
    const m = /^([\s\S]*[.!?…。！？]["'”’)\]]*)(?=\s|$)/.exec(g);
    if (m && m[1].trim().length > 0) g = m[1];
  }
  // At the start of a story or paragraph, leading spaces are never wanted.
  if (!existing || existing.endsWith('\n')) g = g.replace(/^[ \t]+/, '');
  const last = existing.slice(-1);
  const first = g.slice(0, 1);
  if (existing && last && !/\s/.test(last) && first && /[\p{L}\p{N}"“'(]/u.test(first) && /[.!?…,;:"”’)\]\p{L}\p{N}]/u.test(last)) {
    // Mid-word continuation ("hel" + "lo") is rare; prefer a space after sentence/word boundaries.
    if (/[.!?…,;:"”’)\]]/.test(last) || /^[A-Z"“(]/.test(first)) g = ' ' + g;
  }
  return g;
}

// ---------------------------------------------------------------- auxiliary generations

export type ToolboxMode = 'retry' | 'transform' | 'expand' | 'condense' | 'custom' | 'infill' | 'rewriteStyle';

/** Strength wording from NovelAI's toolbox, weakest first. */
export const TOOLBOX_STRENGTHS: Record<'transform' | 'expand' | 'condense' | 'infill', string[]> = {
  transform: ['a little', 'kinda', 'very', 'extremely'],
  expand: ['not much', 'a little', 'quite a bit', 'a lot'],
  condense: ['not much', 'a little', 'quite a bit', 'a lot'],
  infill: ['a word', 'a sentence', 'a paragraph', 'a few paragraphs'],
};

export function buildToolboxRequest(
  story: Story,
  selection: string,
  mode: ToolboxMode,
  opts: { concept?: string; strength?: number; instruction?: string; before?: string; after?: string } = {},
): { system: string; messages: ChatMessage[] } {
  const full = docText(story.doc);
  const before = stripComments(opts.before ?? full).slice(-3000);
  const after = stripComments(opts.after ?? '').slice(0, 1500);
  const level = (k: keyof typeof TOOLBOX_STRENGTHS) => TOOLBOX_STRENGTHS[k][Math.max(0, Math.min(3, opts.strength ?? 1))];
  if (mode === 'infill') {
    return {
      system:
        'You are the novelist of this story, filling a gap inside it. Write only the text that belongs at <GAP/>, so that it flows naturally from the text before it into the text after it, ' +
        'in the same language, voice and paragraphing. ' +
        `Write ${level('infill')}. Output only the new text, with no commentary, quotes, or markdown.`,
      messages: [{ role: 'user', content: `${before}<GAP/>${after}` }],
    };
  }
  if (mode === 'retry') {
    return {
      system:
        'You are the novelist of this story. Rewrite the marked passage from scratch as a fresh alternative: same place in the story, same language and voice, roughly the same length, ' +
        'but different wording and, where natural, different details. Stay in the moment as the original does, and stop where it stops. ' +
        'Output only the new passage, with no commentary, quotes, or markdown.',
      messages: [{ role: 'user', content: `${before}\n<PASSAGE>\n${selection}\n</PASSAGE>\n${after}` }],
    };
  }
  const task: Record<Exclude<ToolboxMode, 'infill' | 'retry'>, string> = {
    rewriteStyle: 'Rewrite the passage to match the style, voice, tone and paragraphing of the story so far. Keep the same events and meaning.',
    transform: `Make the text ${level('transform')} ${opts.concept ?? ''}.`.replace(/\s+\./, '.'),
    expand: `Expand the passage ${level('expand')}: let its moments play out with concrete action, sensory detail, gesture and dialogue, keeping the same events and the story's voice.`,
    condense: `Condense the passage ${level('condense')}: cut ornament, repetition and explanation the reader can infer, keeping its events, meaning and voice.`,
    custom: opts.instruction ?? 'Improve the passage.',
  };
  return {
    system:
      'You are an expert fiction editor. You will receive story context and a passage to revise. ' +
      'Write in the language of the passage and keep the voice of the story; prefer plain, exact words and concrete detail to ornament. ' +
      'Return only the revised passage text, with no commentary, quotes, or markdown.',
    messages: [{ role: 'user', content: `Story context (for style):\n"""\n${before}\n"""\n\nTask: ${task[mode]}\n\nPassage:\n"""\n${selection}\n"""` }],
  };
}

/**
 * Fold the next stretch of story text that dropped out of the context into the running summary. `chunk` is the
 * story text from `summary.upTo` on; the reply is the whole updated summary.
 */
export function buildSummaryRequest(story: Story, chunk: string): { system: string; messages: ChatMessage[] } {
  const prev = story.summary?.text.trim() ?? '';
  const intro = prev ? `Summary so far:\n"""\n${prev}\n"""\n\nStory text that follows it:` : 'Story text:';
  return {
    system:
      'You maintain the running summary of a story for its author, so the story can continue consistently once its early parts are out of view. ' +
      'Write in the language of the story, in past tense, as compact prose paragraphs. Keep what later events may depend on: who is who, ' +
      'relationships, places, objects, promises, secrets, unresolved threads and the order of major events. Drop scene-by-scene detail and style. ' +
      'Reply with only the complete updated summary, at most about 400 words.',
    messages: [{ role: 'user', content: `${intro}\n"""\n${stripComments(chunk)}\n"""\n\n${prev ? 'Rewrite the summary so it also covers this text.' : 'Summarize this text.'}` }],
  };
}

export function buildTitleRequest(story: Story): { system: string; messages: ChatMessage[] } {
  const text = docText(story.doc).slice(0, 4000);
  return {
    system: 'You create evocative, short titles for stories, in the language the story is written in. Reply with only the title (a few words), no quotes.',
    messages: [{ role: 'user', content: text || story.memory || 'An untitled story.' }],
  };
}

export const LORE_GEN_TYPES = [
  'General',
  'Person',
  'Place',
  'Thing',
  'Life',
  'Faction',
  'Role',
  'Concept',
  'History',
] as const;

export function buildLoreRequest(
  story: Story,
  type: string,
  input: string,
  opts: { includeMemory?: boolean; includeAN?: boolean; includeStory?: boolean; entryIds?: string[]; existing?: string } = {},
): { system: string; messages: ChatMessage[] } {
  const parts: string[] = [];
  if (opts.includeMemory && story.memory) parts.push(`Memory:\n${story.memory}`);
  if (opts.includeAN && story.authorsNote) parts.push(`Author's Note:\n${story.authorsNote}`);
  if (opts.includeStory) parts.push(`Recent story:\n${docText(story.doc).slice(-2500)}`);
  for (const id of opts.entryIds ?? []) {
    const e = story.lorebook.entries.find((x) => x.id === id);
    if (e) parts.push(`Lore entry "${e.displayName}":\n${e.text}`);
  }
  const ctx = parts.length ? `${parts.join('\n\n')}\n\n` : '';
  const cont = opts.existing ? `\n\nContinue this existing entry text without repeating it:\n${opts.existing}` : '';
  return {
    system:
      'You write concise lorebook entries for a story-writing tool. An entry is a compact encyclopedic description (2-6 sentences) ' +
      'that starts with the subject\'s name, written in the language of the story (or of the request when there is no story). ' +
      'State concrete, useful facts (appearance, role, relationships, history, how they speak or behave) rather than impressions. Reply with only the entry text.',
    messages: [{ role: 'user', content: `${ctx}Write a ${type} entry for: ${input}${cont}` }],
  };
}

/**
 * Side Chat: a conversation about the story. The model sees the story's memory and author's note, plus any
 * excerpts the user quoted into the chat; it never writes into the story itself.
 */
export function buildSideChatRequest(story: Story, chat: SideChat): { system: string; messages: ChatMessage[] } {
  const about: string[] = [];
  if (story.title) about.push(`Title: ${story.title}`);
  if (story.memory.trim()) about.push(`Memory (the author's notes for the story):\n${story.memory.trim()}`);
  if (story.authorsNote.trim()) about.push(`Author's Note:\n${story.authorsNote.trim()}`);
  const messages: ChatMessage[] = chat.messages.map((m) => ({
    role: m.role,
    content: m.excerpt ? `[${m.excerpt.label}]\n"""\n${m.excerpt.text}\n"""${m.content ? `\n\n${m.content}` : ''}` : m.content,
  }));
  return {
    system:
      'You are a helpful, candid writing partner chatting with an author about the story they are writing. ' +
      'Answer questions, brainstorm, critique and suggest; quote or rewrite passages only when asked. ' +
      'Excerpts from the story appear in triple quotes. Keep replies focused and conversational.' +
      (about.length ? `\n\nAbout the story:\n${about.join('\n\n')}` : ''),
    messages,
  };
}

export function buildHypebotRequest(story: Story, lastGeneration: string): { system: string; messages: ChatMessage[] } {
  return {
    system:
      'You are HypeBot, an enthusiastic, slightly goofy reading buddy. React to the latest story passage in one or two short sentences, ' +
      'in the language of the passage, sometimes with a playful suggestion for what could happen next. No markdown.',
    messages: [{ role: 'user', content: `Story so far (excerpt):\n${docText(story.doc).slice(-1500)}\n\nLatest passage:\n${lastGeneration}` }],
  };
}

/** Map generation parameters to provider sampling fields (OpenAI-compatible names). */

// ------------------------------------------------------------- token calibration

/** How a model's tokenizer compares with o200k, learned from the token counts providers report. */
export interface TokenCalibration {
  /** Model tokens per o200k token. */
  ratio: number;
  /** Requests it was measured on (0 when it only comes from the server's tokenizer). */
  samples: number;
  source: 'usage' | 'tokenizer';
  at: number;
}

export function calibrationRatio(r: number | undefined): number {
  return r && Number.isFinite(r) ? Math.min(3, Math.max(0.5, r)) : 1;
}

/** o200k tokens of what a request sends (the counts providers report are compared with this). */
export function requestTokenEstimate(system: string, messages: ChatMessage[], prompt?: string): number {
  if (prompt) return countTokens(prompt);
  return countTokens(system) + messages.reduce((n, m) => n + countTokens(m.content), 0);
}

/**
 * Fold one measurement into the calibration: `actual` input tokens the provider reported for a request whose
 * text was `estimate` o200k tokens. Short requests are skipped, since chat formatting and hidden system
 * prompts make up too much of them.
 */
export function updateCalibration(prev: TokenCalibration | undefined, actual: number, estimate: number, now = Date.now()): TokenCalibration | undefined {
  if (!(actual > 0) || estimate < 300) return prev;
  const sample = calibrationRatio(actual / estimate);
  const n = prev?.source === 'usage' ? prev.samples : 0;
  // An average over the first few requests, then a moving average that follows changes (a new model version).
  const alpha = Math.max(0.2, 1 / (n + 1));
  const ratio = prev && n > 0 ? prev.ratio + alpha * (sample - prev.ratio) : sample;
  return { ratio: Math.round(ratio * 1000) / 1000, samples: n + 1, source: 'usage', at: now };
}
