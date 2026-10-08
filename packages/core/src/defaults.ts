import { createHistory } from './history.ts';
import { uid, cloneJson } from './util.ts';
import type {
  ContextConfig,
  GenerationParams,
  LoreCategory,
  LoreEntry,
  Lorebook,
  PhraseBiasGroup,
  Preset,
  Story,
  StoryContextSettings,
  StoryMode,
} from './types.ts';

export const STORY_VERSION = 1;

export function contextConfig(p: Partial<ContextConfig> = {}): ContextConfig {
  return {
    prefix: '',
    suffix: '\n',
    tokenBudget: 1,
    reservedTokens: 0,
    budgetPriority: 400,
    trimDirection: 'trimBottom',
    insertionType: 'newline',
    maximumTrimType: 'sentence',
    insertionPosition: -1,
    ...p,
  };
}

export function defaultContextSettings(): StoryContextSettings {
  return {
    memory: contextConfig({ budgetPriority: 800, insertionPosition: 0, trimDirection: 'trimBottom' }),
    authorsNote: contextConfig({ budgetPriority: -400, insertionPosition: -4, reservedTokens: 1, trimDirection: 'trimBottom' }),
    story: contextConfig({
      suffix: '',
      budgetPriority: 0,
      reservedTokens: 512,
      insertionPosition: -1,
      trimDirection: 'trimTop',
      maximumTrimType: 'sentence',
    }),
    loreDefaults: contextConfig({ budgetPriority: 400, insertionPosition: -1, trimDirection: 'trimBottom' }),
  };
}

export const DEFAULT_SAMPLER_ORDER: GenerationParams['order'] = [
  { id: 'temperature', enabled: true },
  { id: 'top_k', enabled: false },
  { id: 'top_p', enabled: true },
  { id: 'tfs', enabled: false },
  { id: 'top_a', enabled: false },
  { id: 'typical_p', enabled: false },
  { id: 'min_p', enabled: false },
  { id: 'mirostat', enabled: false },
  { id: 'unified', enabled: false },
];

export function defaultParams(p: Partial<GenerationParams> = {}): GenerationParams {
  return {
    temperature: 1,
    maxLength: 1024,
    maxContext: 8192,
    minLength: 1,
    topK: 0,
    topP: 0.95,
    topA: 0,
    minP: 0,
    typicalP: 1,
    tailFreeSampling: 1,
    mirostatTau: 0,
    mirostatLr: 1,
    unifiedLinear: 1,
    unifiedQuad: 0,
    unifiedConf: 0,
    repetitionPenalty: 1,
    repetitionPenaltyRange: 0,
    repetitionPenaltySlope: 0,
    repetitionPenaltyFrequency: 0,
    repetitionPenaltyPresence: 0,
    repetitionPenaltyWhitelist: true,
    dynamicPenaltyRange: false,
    phraseRepPen: 'off',
    order: cloneJson(DEFAULT_SAMPLER_ORDER),
    ...p,
  };
}

export const BUILTIN_PRESETS: Preset[] = [
  { id: 'default', name: 'Default', builtin: true, params: defaultParams() },
  {
    id: 'carefree',
    name: 'Carefree',
    builtin: true,
    params: defaultParams({ temperature: 1.25, topP: 0.98, repetitionPenaltyPresence: 0.1 }),
  },
  {
    id: 'golden-arrow',
    name: 'Golden Arrow',
    builtin: true,
    params: defaultParams({ temperature: 0.85, topP: 0.9, minP: 0.05, order: DEFAULT_SAMPLER_ORDER.map((s) => ({ ...s, enabled: ['temperature', 'top_p', 'min_p'].includes(s.id) })) }),
  },
  {
    id: 'writers-daemon',
    name: "Writer's Daemon",
    builtin: true,
    params: defaultParams({ temperature: 1.1, topP: 0.92, repetitionPenaltyFrequency: 0.05, repetitionPenaltyPresence: 0.05 }),
  },
  {
    id: 'precise',
    name: 'Precise',
    builtin: true,
    params: defaultParams({ temperature: 0.6, topP: 0.85, topK: 40, order: DEFAULT_SAMPLER_ORDER.map((s) => ({ ...s, enabled: ['temperature', 'top_k', 'top_p'].includes(s.id) })) }),
  },
];

export function biasGroup(p: Partial<PhraseBiasGroup> = {}): PhraseBiasGroup {
  return { phrases: [], bias: 0, ensureSequenceFinish: false, generateOnce: true, enabled: true, whenInactive: false, ...p };
}

export function emptyLorebook(): Lorebook {
  return { entries: [], categories: [], settings: { orderByKeyLocations: false } };
}

export function newLoreEntry(p: Partial<LoreEntry> = {}, defaults?: ContextConfig): LoreEntry {
  return {
    id: uid(),
    displayName: 'New Lorebook Entry',
    text: '',
    keys: [],
    enabled: true,
    forceActivation: false,
    hidden: false,
    searchRange: 1000,
    keyRelative: false,
    nonStoryActivatable: false,
    category: null,
    contextConfig: cloneJson(defaults ?? defaultContextSettings().loreDefaults),
    loreBiasGroups: [biasGroup()],
    conditions: [],
    lastUpdatedAt: Date.now(),
    ...p,
  };
}

export function newLoreCategory(p: Partial<LoreCategory> = {}): LoreCategory {
  return {
    id: uid(),
    name: 'New Category',
    enabled: true,
    createSubcontext: false,
    subcontextSettings: contextConfig({ budgetPriority: 400, insertionPosition: -1 }),
    useCategoryDefaults: false,
    categoryDefaults: {},
    categoryBiasGroups: [biasGroup()],
    entryHeader: '',
    open: true,
    ...p,
  };
}

export const DEFAULT_SYSTEM_PROMPT_STORY =
  'You are a skilled novelist co-writing a story with the user. You will be given the story so far. ' +
  'Continue it seamlessly from exactly where it stops, matching its voice, tense, point of view, style and formatting. ' +
  'Output only the continuation text itself: no titles, no commentary, no quotation of the existing text, no markdown. ' +
  'If the story stops mid-sentence or mid-word, continue that sentence. ' +
  'Lines in [square brackets] are author instructions and background information; follow them but never repeat them.';

export const DEFAULT_SYSTEM_PROMPT_ADVENTURE =
  'You are the narrator of an interactive text adventure. You will be given the adventure so far. ' +
  'Lines beginning with ">" are the player\'s actions. Narrate the outcome of the latest action in second person, ' +
  'vividly and concisely, then stop and wait for the next action. Never write actions for the player. ' +
  'Output only the narration text, no commentary or markdown. ' +
  'Lines in [square brackets] are background information; use them but never repeat them.';

export function newStory(p: Partial<Story> = {}): Story {
  const mode: StoryMode = p.mode ?? 'storyteller';
  const now = Date.now();
  return {
    id: uid(),
    version: STORY_VERSION,
    title: 'New Story',
    description: '',
    tags: [],
    genre: '',
    author: '',
    favorite: false,
    shelf: null,
    mode,
    createdAt: now,
    updatedAt: now,
    doc: [],
    history: createHistory(),
    memory: '',
    authorsNote: '',
    lorebook: emptyLorebook(),
    contextSettings: defaultContextSettings(),
    ephemeral: [],
    systemPrompt: '',
    prefill: '',
    presetId: 'default',
    params: defaultParams(),
    model: null,
    phraseBias: [biasGroup()],
    bannedTokens: [],
    banBrackets: true,
    avoidOverusedWords: true,
    stopSequences: [],
    step: 0,
    placeholders: [],
    titleHistory: [],
    scripts: [],
    ...p,
  };
}

/** Fill in fields missing from older or foreign story files. */
export function migrateStory(raw: Partial<Story> & { id?: string }): Story {
  const base = newStory({ id: raw.id ?? uid(), mode: raw.mode });
  const s: Story = { ...base, ...raw } as Story;
  s.contextSettings = { ...base.contextSettings, ...(raw.contextSettings ?? {}) };
  s.params = defaultParams(raw.params ?? {});
  s.lorebook = { ...emptyLorebook(), ...(raw.lorebook ?? {}) };
  s.lorebook.entries = s.lorebook.entries.map((e) => newLoreEntry(e));
  s.lorebook.categories = s.lorebook.categories.map((c) => newLoreCategory(c));
  s.version = STORY_VERSION;
  return s;
}

/** Special Character submenu, in the original's order. `display` is what the menu shows for invisible characters. */
export const SPECIAL_CHARACTERS: { label: string; char: string; display?: string; desc?: string }[] = [
  { label: 'LitRPG', char: '─', desc: 'LitRPG game text' },
  { label: 'En Space', char: '\u2002', display: '"\u2002"', desc: 'quotations/excerpts' },
  { label: 'Em Space', char: '\u2003', display: '"\u2003"', desc: 'poetry/lyrics' },
  { label: 'Bullet', char: '•' },
  { label: 'Ellipsis', char: '…' },
  { label: 'Em Dash', char: '—' },
  { label: 'Dinkus', char: '***', desc: 'scene/chapter break' },
  { label: 'Asterism', char: '⁂' },
];
