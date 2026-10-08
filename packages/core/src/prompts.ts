import { buildContext, type BuiltContext } from './context.ts';
import { DEFAULT_SYSTEM_PROMPT_ADVENTURE, DEFAULT_SYSTEM_PROMPT_STORY } from './defaults.ts';
import { docText } from './doc.ts';
import type { ChatMessage, GenerationParams, PhraseBiasGroup, Story } from './types.ts';

/** Rough characters-per-token ratio for converting NovelAI's character output length. */
export const CHARS_PER_TOKEN = 4;

export function outputTokens(params: GenerationParams): number {
  return Math.max(16, Math.ceil(params.maxLength / CHARS_PER_TOKEN));
}

export interface StoryRequest {
  system: string;
  messages: ChatMessage[];
  context: BuiltContext;
  maxTokens: number;
  stop: string[];
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
export function buildStoryRequest(story: Story, opts: { maxContextTokens: number; model?: string; storyText?: string; inline?: { before: string; after: string } }): StoryRequest {
  const params = story.params;
  const out = outputTokens(params);
  const ctx = buildContext(story, {
    maxContextTokens: opts.maxContextTokens,
    outputTokens: out,
    model: opts.model,
    storyText: opts.inline ? opts.inline.before : opts.storyText,
  });
  const base = story.systemPrompt.trim() || (story.mode === 'adventure' ? DEFAULT_SYSTEM_PROMPT_ADVENTURE : DEFAULT_SYSTEM_PROMPT_STORY);
  const extra = biasInstructions(ctx.phraseBias, story.bannedTokens, story.banBrackets, story.avoidOverusedWords);
  const lengthHint = `Write roughly ${params.maxLength} characters or less.`;
  let system = [base, extra, lengthHint].filter(Boolean).join('\n\n');
  let user: string;
  if (opts.inline) {
    system +=
      '\n\nYou are filling a gap inside the story. Write only the text that belongs at <GAP/>, so that it flows naturally into the text after it.';
    user = `${ctx.text}<GAP/>${opts.inline.after.slice(0, 2000)}`;
  } else {
    user = ctx.text || '(The story has not started yet. Begin it.)';
  }
  const messages: ChatMessage[] = [{ role: 'user', content: user }];
  if (story.prefill) messages.push({ role: 'assistant', content: story.prefill });
  return { system, messages, context: ctx, maxTokens: out, stop: story.stopSequences.filter(Boolean) };
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

export type ToolboxMode = 'rewrite' | 'transform' | 'expand' | 'condense' | 'custom';

export function buildToolboxRequest(
  story: Story,
  selection: string,
  mode: ToolboxMode,
  opts: { concept?: string; strength?: number; instruction?: string } = {},
): { system: string; messages: ChatMessage[] } {
  const before = docText(story.doc);
  const sampleStyle = before.slice(-3000);
  const task: Record<ToolboxMode, string> = {
    rewrite: 'Rewrite the passage so it matches the style, voice and tone of the story so far. Keep the same events and meaning.',
    transform: `Rewrite the passage transformed around the concept "${opts.concept ?? ''}" at strength ${opts.strength ?? 5}/10 (1 = subtle, 10 = extreme).`,
    expand: 'Rewrite the passage with more detail: sensory description, inner thoughts, and texture. Keep the same events.',
    condense: 'Condense the passage: remove overly flowery prose and redundancy while keeping its core meaning.',
    custom: opts.instruction ?? 'Improve the passage.',
  };
  return {
    system:
      'You are an expert fiction editor. You will receive story context and a passage to revise. ' +
      'Return only the revised passage text, with no commentary, quotes, or markdown.',
    messages: [{ role: 'user', content: `Story context (for style):\n"""\n${sampleStyle}\n"""\n\nTask: ${task[mode]}\n\nPassage:\n"""\n${selection}\n"""` }],
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

export function buildHypebotRequest(story: Story, lastGeneration: string): { system: string; messages: ChatMessage[] } {
  return {
    system:
      'You are HypeBot, an enthusiastic, slightly goofy reading buddy. React to the latest story passage in one or two short sentences, ' +
      'sometimes with a playful suggestion for what could happen next. No markdown.',
    messages: [{ role: 'user', content: `Story so far (excerpt):\n${docText(story.doc).slice(-1500)}\n\nLatest passage:\n${lastGeneration}` }],
  };
}

/** Map generation parameters to provider sampling fields (OpenAI-compatible names). */
export function samplingParams(p: GenerationParams): { temperature?: number; samplingParams: Record<string, unknown> } {
  const on = new Set(p.order.filter((s) => s.enabled).map((s) => s.id));
  const sp: Record<string, unknown> = {};
  if (on.has('top_p') && p.topP < 1) sp.top_p = p.topP;
  if (on.has('top_k') && p.topK > 0) sp.top_k = p.topK;
  if (on.has('min_p') && p.minP > 0) sp.min_p = p.minP;
  if (on.has('top_a') && p.topA > 0) sp.top_a = p.topA;
  if (on.has('typical_p') && p.typicalP < 1) sp.typical_p = p.typicalP;
  if (on.has('tfs') && p.tailFreeSampling < 1) sp.tfs = p.tailFreeSampling;
  if (on.has('mirostat') && p.mirostatTau > 0) {
    sp.mirostat_mode = 2;
    sp.mirostat_tau = p.mirostatTau;
    sp.mirostat_eta = p.mirostatLr;
  }
  if (p.repetitionPenalty !== 1) sp.repetition_penalty = p.repetitionPenalty;
  if (p.repetitionPenaltyPresence) sp.presence_penalty = p.repetitionPenaltyPresence;
  if (p.repetitionPenaltyFrequency) sp.frequency_penalty = p.repetitionPenaltyFrequency;
  return { temperature: on.has('temperature') ? p.temperature : undefined, samplingParams: sp };
}
