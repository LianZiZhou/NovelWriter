import type { ActionCategory, JsonSchema, RunMode, ToolSpec, TrustLevel, TrustPolicy } from './types.ts';

/** `read` tools only look; `control` tools steer the run itself. Neither changes the story. */
export type ToolCategory = ActionCategory | 'read' | 'control';

export interface DirectorTool extends ToolSpec {
  category: ToolCategory;
  /** Only offered in these run modes (default: all). */
  modes?: RunMode[];
}

const str = (description: string): JsonSchema => ({ type: 'string', description });
const int = (description: string, minimum?: number, maximum?: number): JsonSchema => ({ type: 'integer', description, ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}) });
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });

export const DIRECTOR_TOOLS: DirectorTool[] = [
  // ---------------------------------------------------------------- looking
  {
    name: 'story_overview',
    category: 'read',
    description: 'Title, genre, tags, memory, author\'s note, running summary, outline, lorebook entry names, word count and the end of the story text. Call this first.',
    parameters: obj({}),
  },
  {
    name: 'read_story',
    category: 'read',
    description: 'Read story text. With no arguments returns the last 3000 characters. `from`/`to` are character offsets; `tail` reads that many characters from the end; `chapter` reads one chapter (1-based) of the outline.',
    parameters: obj({ from: int('Start offset', 0), to: int('End offset', 0), tail: int('Characters from the end', 1, 12000), chapter: int('Chapter number, 1-based', 1) }),
  },
  {
    name: 'get_context_report',
    category: 'read',
    description: 'What the writing model will see for the next passage: token budget use per part and which lorebook entries are active.',
    parameters: obj({}),
  },
  {
    name: 'search_lore',
    category: 'read',
    description: 'Find lorebook entries by name, key or text. Returns ids, names, keys and text. An empty query lists all entries.',
    parameters: obj({ query: str('Search text') }),
  },
  {
    name: 'critique',
    category: 'read',
    description: 'Get an editor\'s critique of a part of the story (pacing, consistency with lore and outline, prose problems, repetition). Read-only; returns notes.',
    parameters: obj({ chapter: int('Chapter number, 1-based', 1), tail: int('Or: the last N characters', 500, 20000), focus: str('What to look at, e.g. "dialogue", "continuity"') }),
  },

  // ---------------------------------------------------------------- writing
  {
    name: 'write_passage',
    category: 'prose',
    description:
      'Have the writing model continue the story at its end with one passage. `beat` is a short direction for this passage (what should happen, whose point of view, tone) — it is shown to the writer as an author\'s note, so write it as an instruction, not as prose. ' +
      'Returns the text written. Keep beats small: one scene moment per passage.',
    parameters: obj({ beat: str('Direction for this passage'), length: int('Approximate length in characters (default: the story\'s output length)', 200, 6000) }, ['beat']),
  },
  {
    name: 'rewrite_range',
    category: 'rewrite',
    description: 'Revise a stretch of existing story text with the writing model. `from`/`to` are character offsets (use read_story to find them). `instruction` says what to change.',
    parameters: obj({ from: int('Start offset', 0), to: int('End offset', 0), instruction: str('What to change') }, ['from', 'to', 'instruction']),
  },
  {
    name: 'insert_text',
    category: 'rewrite',
    description: 'Insert exact text yourself (a scene break, a short fix). `at` is a character offset; default is the end of the story. Prefer write_passage for prose.',
    parameters: obj({ text: str('Text to insert'), at: int('Offset', 0) }, ['text']),
  },
  {
    name: 'start_chapter',
    category: 'structure',
    description: 'Begin a new chapter: adds its heading line at the end of the story and marks the chapter as drafting in the outline. `number` is the outline chapter (1-based); with no outline give a title.',
    parameters: obj({ number: int('Outline chapter number, 1-based', 1), title: str('Chapter title (when not in the outline)') }),
  },

  {
    name: 'set_story_info',
    category: 'structure',
    description: 'Set the story\'s title, genre, tags or description (only the fields given change). The writer sees title, genre and tags.',
    parameters: obj({ title: str('Title'), genre: str('Genre'), tags: { type: 'array', items: { type: 'string' }, description: 'Tags' }, description: str('Short description') }),
  },

  // ---------------------------------------------------------------- context the writer sees
  {
    name: 'update_memory',
    category: 'memory',
    description: 'Replace the story memory (always-included background: premise, main characters, setting, style). Keep it compact; put per-character or per-place detail into lorebook entries instead.',
    parameters: obj({ text: str('The complete new memory') }, ['text']),
  },
  {
    name: 'set_authors_note',
    category: 'authorsNote',
    description: 'Replace the author\'s note: a short standing instruction placed near the end of the writer\'s context (current scene goal, tone, style). Use it for what holds over several passages; use write_passage beats for single passages.',
    parameters: obj({ text: str('The complete new author\'s note (may be empty)') }, ['text']),
  },
  {
    name: 'upsert_lore_entry',
    category: 'lore',
    description: 'Create a lorebook entry, or update one when `id` is given. Entries enter the writer\'s context when one of their keys appears in recent text. Text: 2-6 compact factual sentences starting with the name.',
    parameters: obj(
      {
        id: str('Existing entry id to update'),
        name: str('Display name'),
        keys: { type: 'array', items: { type: 'string' }, description: 'Activation keywords (names, nicknames)' },
        text: str('Entry text'),
        type: { type: 'string', enum: ['Person', 'Place', 'Thing', 'Faction', 'Concept', 'History', 'General'], description: 'Kind of entry (used as its category)' },
      },
      ['name', 'text'],
    ),
  },
  {
    name: 'delete_lore_entry',
    category: 'loreDelete',
    description: 'Delete a lorebook entry by id.',
    parameters: obj({ id: str('Entry id') }, ['id']),
  },
  {
    name: 'summarize',
    category: 'memory',
    description: 'Bring the running summary of out-of-context story text up to date now (long stories). Returns the summary.',
    parameters: obj({}),
  },
  {
    name: 'update_outline',
    category: 'outline',
    description: 'Set the book outline: the premise and the list of chapters, each with a synopsis and beats (short scene steps). Replaces the whole outline; keep statuses of chapters already written.',
    parameters: obj(
      {
        premise: str('One-paragraph premise'),
        chapters: {
          type: 'array',
          items: obj(
            {
              title: str('Chapter title'),
              synopsis: str('What happens in the chapter'),
              beats: { type: 'array', items: { type: 'string' }, description: 'Scene steps' },
              status: { type: 'string', enum: ['planned', 'drafting', 'drafted', 'revised'] },
            },
            ['title', 'synopsis'],
          ),
        },
      },
      ['chapters'],
    ),
  },

  // ---------------------------------------------------------------- the run itself
  {
    name: 'update_plan',
    category: 'control',
    description: 'Set your working plan, shown to the user: the full list of steps with their status. Update it as you go (mark the current step active, finished ones done).',
    parameters: obj(
      {
        steps: {
          type: 'array',
          items: obj({ text: str('Step'), status: { type: 'string', enum: ['pending', 'active', 'done', 'skipped'] } }, ['text', 'status']),
        },
      },
      ['steps'],
    ),
  },
  {
    name: 'set_chapter_status',
    category: 'control',
    description: 'Mark an outline chapter as planned, drafting, drafted or revised.',
    parameters: obj({ number: int('Chapter number, 1-based', 1), status: { type: 'string', enum: ['planned', 'drafting', 'drafted', 'revised'] } }, ['number', 'status']),
  },
  {
    name: 'set_phase',
    category: 'control',
    modes: ['book'],
    description: 'Move the book to its next phase once the current one is complete: premise → world → characters → outline → chapters → review.',
    parameters: obj({ phase: { type: 'string', enum: ['premise', 'world', 'characters', 'outline', 'chapters', 'review'] } }, ['phase']),
  },
  {
    name: 'ask_user',
    category: 'control',
    description: 'Ask the author a question and wait for the answer. Use sparingly: only for decisions that are truly theirs (a major plot direction, approval of the outline).',
    parameters: obj({ question: str('The question'), options: { type: 'array', items: { type: 'string' }, description: 'Suggested answers' } }, ['question']),
  },
  {
    name: 'finish',
    category: 'control',
    description: 'End the run when the goal is reached (or cannot be). `summary`: what was done, for the author.',
    parameters: obj({ summary: str('What was done') }, ['summary']),
  },
];

export const TOOL_BY_NAME: Record<string, DirectorTool> = Object.fromEntries(DIRECTOR_TOOLS.map((t) => [t.name, t]));

/** App defaults: everything applies on its own (and can be undone), deleting lore asks first. */
export const DEFAULT_TRUST: Record<ActionCategory, TrustLevel> = {
  prose: 'auto',
  rewrite: 'auto',
  memory: 'auto',
  authorsNote: 'auto',
  lore: 'auto',
  loreDelete: 'confirm',
  outline: 'auto',
  structure: 'auto',
};

export function trustFor(category: ToolCategory, ...policies: (TrustPolicy | undefined)[]): TrustLevel {
  if (category === 'read' || category === 'control') return 'auto';
  let level: TrustLevel = DEFAULT_TRUST[category];
  for (const p of policies) if (p?.[category]) level = p[category]!;
  return level;
}

/** Tools offered to the model: denied categories and tools of other modes are left out. */
export function toolsFor(mode: RunMode, ...policies: (TrustPolicy | undefined)[]): DirectorTool[] {
  return DIRECTOR_TOOLS.filter((t) => (!t.modes || t.modes.includes(mode)) && trustFor(t.category, ...policies) !== 'deny');
}

export function toolSpecs(tools: DirectorTool[]): ToolSpec[] {
  return tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
}

/**
 * Check arguments against a tool's schema (the subset tool schemas use) and coerce what models commonly get
 * slightly wrong: numbers sent as strings, a single string for a string array. Returns an error message or the args.
 */
export function validateArgs(tool: ToolSpec, args: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (args === undefined || args === null || args === '') args = {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      return { ok: false, error: 'Arguments are not valid JSON.' };
    }
  }
  if (typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: 'Arguments must be an object.' };
  const r = coerce(tool.parameters, args, '');
  return r.error ? { ok: false, error: r.error } : { ok: true, args: r.value as Record<string, unknown> };
}

function coerce(schema: JsonSchema, v: unknown, path: string): { value?: unknown; error?: string } {
  const at = path || 'arguments';
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'object') {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { error: `${at} must be an object.` };
    const out: Record<string, unknown> = {};
    const src = v as Record<string, unknown>;
    for (const req of schema.required ?? []) {
      if (src[req] === undefined || src[req] === null) return { error: `Missing required "${path ? `${path}.` : ''}${req}".` };
    }
    for (const [k, val] of Object.entries(src)) {
      const sub = schema.properties?.[k];
      if (!sub) continue; // unknown keys are dropped
      if (val === null || val === undefined) continue;
      const r = coerce(sub, val, path ? `${path}.${k}` : k);
      if (r.error) return r;
      out[k] = r.value;
    }
    return { value: out };
  }
  if (type === 'array') {
    const list = Array.isArray(v) ? v : typeof v === 'string' && schema.items?.type === 'string' ? v.split(/\s*,\s*/).filter(Boolean) : null;
    if (!list) return { error: `${at} must be an array.` };
    const out: unknown[] = [];
    for (let i = 0; i < list.length; i++) {
      const r: { value?: unknown; error?: string } = schema.items ? coerce(schema.items, list[i], `${at}[${i}]`) : { value: list[i] };
      if (r.error) return r;
      out.push(r.value);
    }
    return { value: out };
  }
  if (type === 'integer' || type === 'number') {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return { error: `${at} must be a number.` };
    let x = type === 'integer' ? Math.round(n) : n;
    if (schema.minimum !== undefined) x = Math.max(schema.minimum, x);
    if (schema.maximum !== undefined) x = Math.min(schema.maximum, x);
    return { value: x };
  }
  if (type === 'string') {
    const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;
    if (s === null) return { error: `${at} must be a string.` };
    if (schema.enum && !schema.enum.includes(s)) return { error: `${at} must be one of: ${schema.enum.join(', ')}.` };
    return { value: s };
  }
  if (type === 'boolean') {
    if (typeof v === 'boolean') return { value: v };
    if (v === 'true' || v === 'false') return { value: v === 'true' };
    return { error: `${at} must be true or false.` };
  }
  return { value: v };
}
