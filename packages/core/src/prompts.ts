import { buildContext, stripComments, type BuiltContext } from './context.ts';
import { DEFAULT_SYSTEM_PROMPT_ADVENTURE, DEFAULT_SYSTEM_PROMPT_STORY } from './defaults.ts';
import { docText } from './doc.ts';
import { countTokens } from './tokenizer.ts';
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
  context: BuiltContext;
  maxTokens: number;
  stop: string[];
  /** Active phrase-bias groups, for backends that take logit_bias. */
  bias: { phrases: string[]; bias: number }[];
}

function biasInstructions(groups: PhraseBiasGroup[], banned: string[], banBrackets: boolean, avoidOverused: boolean): string {
  const lines: string[] = [];
  const favored = groups.filter((g) => g.bias > 0).flatMap((g) => g.phrases);
  const disfavored = groups.filter((g) => g.bias < 0).flatMap((g) => g.phrases);
  if (favored.length) lines.push(`Where natural, favor using: ${favored.map((p) => JSON.stringify(stripBraces(p))).join(', ')}.`);
  if (disfavored.length) lines.push(`Avoid using: ${disfavored.map((p) => JSON.stringify(stripBraces(p))).join(', ')}.`);
  if (banned.length) lines.push(`Never write any of these: ${banned.map((p) => JSON.stringify(stripBraces(p))).join(', ')}.`);
  if (banBrackets) lines.push('Never write square brackets.');
  if (avoidOverused) lines.push('Avoid cliché phrases overused by AI writing (e.g. "a testament to", "shivers down the spine", "barely above a whisper").');
  return lines.join(' ');
}

/** Phrase bias entries use `{exact text}` or `[token ids]`; we only support text. */
export function stripBraces(p: string): string {
  const m = /^\{(.*)\}$/s.exec(p.trim());
  return m ? m[1] : p;
}

/**
 * Build the chat request that continues the story. The assembled NovelAI-style
 * context is sent as a single user message with instructions in the system prompt.
 */
export function buildStoryRequest(
  story: Story,
  opts: {
    maxContextTokens: number;
    model?: string;
    storyText?: string;
    /** Inline generation at the cursor; `after` is only sent when bidirectional. */
    inline?: { before: string; after: string; bidirectional?: boolean };
    nativeBias?: boolean;
    preamble?: boolean;
  },
): StoryRequest {
  const params = story.params;
  const out = outputTokens(params, opts.inline?.before ?? opts.storyText ?? (docText(story.doc) || story.memory));
  // Text after the gap is part of the request too, so it comes out of the context budget.
  const afterText = opts.inline?.bidirectional ? stripComments(opts.inline.after.slice(0, 2000)) : '';
  const ctx = buildContext(story, {
    maxContextTokens: opts.maxContextTokens - countTokens(afterText),
    outputTokens: out,
    model: opts.model,
    storyText: opts.inline ? opts.inline.before : opts.storyText,
  });
  const base = story.systemPrompt.trim() || (story.mode === 'adventure' ? DEFAULT_SYSTEM_PROMPT_ADVENTURE : DEFAULT_SYSTEM_PROMPT_STORY);
  // With native logit bias the phrase bias is sent as token biases instead of instructions.
  const extra = biasInstructions(opts.nativeBias ? [] : ctx.phraseBias, story.bannedTokens, story.banBrackets, story.avoidOverusedWords);
  const lengthHint = `Write roughly ${params.maxLength} characters or less.`;
  let system = [base, extra, lengthHint].filter(Boolean).join('\n\n');
  let user: string;
  if (opts.inline?.bidirectional && afterText.trim()) {
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
  return {
    system,
    messages,
    context: ctx,
    maxTokens: out,
    stop: story.stopSequences.filter(Boolean),
    bias: ctx.phraseBias.filter((g) => g.enabled !== false && g.bias !== 0 && g.phrases.length).map((g) => ({ phrases: g.phrases, bias: g.bias })),
  };
}

/**
 * Make generated text join the existing story cleanly: add a separating space
 * when the model omitted one, apply stop sequences, and optionally trim to the
 * end of the last complete sentence.
 */
export function postProcess(
  existing: string,
  generated: string,
  opts: { stop?: string[]; trimToSentence?: boolean; minLength?: number; banned?: string[] } = {},
): string {
  let g = generated.replace(/\r\n/g, '\n');
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
        'You are a skilled novelist filling a gap inside a story. Write only the text that belongs at <GAP/> so that it flows naturally from the text before it into the text after it. ' +
        `Write ${level('infill')}. Output only the new text, with no commentary, quotes, or markdown.`,
      messages: [{ role: 'user', content: `${before}<GAP/>${after}` }],
    };
  }
  if (mode === 'retry') {
    return {
      system:
        'You are a skilled novelist. Rewrite the marked passage from scratch as a fresh alternative: same place in the story and roughly the same length, but different wording and, where natural, different details. ' +
        'Output only the new passage, with no commentary, quotes, or markdown.',
      messages: [{ role: 'user', content: `${before}\n<PASSAGE>\n${selection}\n</PASSAGE>\n${after}` }],
    };
  }
  const task: Record<Exclude<ToolboxMode, 'infill' | 'retry'>, string> = {
    rewriteStyle: 'Rewrite the passage to match the style, voice and tone of the story so far. Keep the same events and meaning.',
    transform: `Make the text ${level('transform')} ${opts.concept ?? ''}.`.replace(/\s+\./, '.'),
    expand: `Expand the passage ${level('expand')}: add sensory detail, inner thoughts and texture while keeping the same events.`,
    condense: `Condense the passage ${level('condense')}: cut flowery prose and redundancy while keeping its core meaning.`,
    custom: opts.instruction ?? 'Improve the passage.',
  };
  return {
    system:
      'You are an expert fiction editor. You will receive story context and a passage to revise. ' +
      'Return only the revised passage text, with no commentary, quotes, or markdown.',
    messages: [{ role: 'user', content: `Story context (for style):\n"""\n${before}\n"""\n\nTask: ${task[mode]}\n\nPassage:\n"""\n${selection}\n"""` }],
  };
}

export function buildTitleRequest(story: Story): { system: string; messages: ChatMessage[] } {
  const text = docText(story.doc).slice(0, 4000);
  return {
    system: 'You create evocative, short titles for stories. Reply with only the title (2-6 words), no quotes.',
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
      'that starts with the subject\'s name. Reply with only the entry text.',
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
      'sometimes with a playful suggestion for what could happen next. No markdown.',
    messages: [{ role: 'user', content: `Story so far (excerpt):\n${docText(story.doc).slice(-1500)}\n\nLatest passage:\n${lastGeneration}` }],
  };
}

/** Map generation parameters to provider sampling fields (OpenAI-compatible names). */
