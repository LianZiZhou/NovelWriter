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
    xtcProbability: 0,
    xtcThreshold: 0.1,
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

// The default prompts follow what NovelAI sends its GLM models and what SillyTavern's prose presets converged on:
// describe the craft to aim for (models copy whatever phrases a prompt names, even in a "never write" list),
// keep the model writing as the story's own author, and leave per-turn reminders to the end of the request.
export const DEFAULT_SYSTEM_PROMPT_STORY =
  'You are a novelist continuing a story you are writing together with its author. The story so far is your own prose; ' +
  'background notes from the author come separately.\n\n' +
  'Continue from exactly where the story stops, as the same writer: keep its language, voice, tense, point of view, formatting and paragraphing. ' +
  'If it stops mid-sentence, finish that sentence.\n\n' +
  'How to write:\n' +
  '- Stay in the scene. Let each moment play out through action, gesture, sensory detail and dialogue before moving on. ' +
  'Advance the plot a step at a time, at the pace the story has set, and leave threads open for later.\n' +
  '- Write developed paragraphs that carry narration, action and speech together. Keep one-line paragraphs for rare emphasis.\n' +
  '- Let sentence length follow the content. Choose plain, exact words and the one specific detail over ornament or a string of images.\n' +
  '- Say directly what happens and what things are. Trust subtext: characters rarely state their feelings, and the narration leaves the meaning for the reader to find.\n' +
  '- Let characters talk like people with their own voices and purposes. Bring back earlier lines only when the story truly calls for it.\n' +
  '- Stop at a natural pause, even mid-scene, on an action or an image.\n\n' +
  'Write only the story text itself: no title, commentary, notes or markdown, and nothing that is already written.';

export const DEFAULT_SYSTEM_PROMPT_ADVENTURE =
  'You are the narrator of an interactive story, a text adventure. The player\'s turns are what their character does and says; your turns are the story.\n\n' +
  'Each turn, narrate what happens as a result of the player\'s latest action, as the same writer as before: keep the story\'s language, voice, tense and formatting, ' +
  'and address the player\'s character as "you" unless the story does otherwise.\n\n' +
  'How to write:\n' +
  '- Decide fairly whether actions succeed. Let the world and its characters respond with their own voices, motives and knowledge.\n' +
  '- Write a full scene beat: a few developed paragraphs of action, sensory detail and dialogue. Stay in the moment and advance the story a step at a time.\n' +
  '- Say directly what happens. Trust subtext: characters rarely state their feelings, and the narration leaves the meaning for the reader to find.\n' +
  '- The player decides what their character does, says and feels. Stop at a point where they can act, on an action or an image, without offering choices.\n\n' +
  'Write only the story text itself: no commentary, notes or markdown, and nothing that is already written.';

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
    chats: [],
    styleTag: 0,
    attgPrompted: false,
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
  // Older stories never saw the Genre & Tags prompt; don't show it on them.
  if (raw.attgPrompted === undefined) s.attgPrompted = true;
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
