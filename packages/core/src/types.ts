/** Where a piece of story text came from. Drives editor coloring. */
export type Origin = 'prompt' | 'ai' | 'edit' | 'user';

/** Visual-only formatting. The AI never sees these. */
export type Mark = 'bold' | 'italic' | 'underline' | 'strike';

export interface Span {
  text: string;
  origin: Origin;
  marks?: Mark[];
}

/** One contiguous edit: at `pos`, `removed` was replaced by `inserted`. */
export interface Change {
  pos: number;
  removed: Span[];
  inserted: Span[];
}

export type HistoryNodeType = 'root' | 'prompt' | 'ai' | 'user' | 'edit';

export interface HistoryNode {
  id: string;
  parent: string | null;
  children: string[];
  /** Child to follow on redo (last visited). */
  preferred?: string;
  type: HistoryNodeType;
  changes: Change[];
  time: number;
}

export interface History {
  nodes: Record<string, HistoryNode>;
  current: string;
}

export type TrimDirection = 'trimTop' | 'trimBottom' | 'doNotTrim';
export type TrimType = 'newline' | 'sentence' | 'token';

export interface ContextConfig {
  prefix: string;
  suffix: string;
  /** Absolute tokens, or a fraction (0,1) of the max context. */
  tokenBudget: number;
  reservedTokens: number;
  /** Insertion order: higher reserves and inserts first. */
  budgetPriority: number;
  trimDirection: TrimDirection;
  insertionType: TrimType;
  maximumTrimType: TrimType;
  /** 0 = top, -1 = bottom, counted in `insertionType` units. */
  insertionPosition: number;
}

export interface PhraseBiasGroup {
  phrases: string[];
  bias: number;
  ensureSequenceFinish: boolean;
  generateOnce: boolean;
  enabled: boolean;
  whenInactive: boolean;
}

export type Condition =
  | { type: 'true' }
  | { type: 'keyword'; key: string }
  | { type: 'loreActive'; entryId: string }
  | { type: 'model'; model: string }
  | { type: 'storyMode'; mode: StoryMode }
  | { type: 'random'; chance: number }
  | {
      type: 'number';
      variable: 'currentStep' | 'paragraphCount' | 'characterCount';
      op: '<' | '<=' | '=' | '>=' | '>' | '!=';
      value: number;
    }
  | {
      type: 'string';
      variable: 'storyText' | 'memoryText' | 'authorsNoteText';
      op: 'equals' | 'includes' | 'startsWith' | 'endsWith';
      value: string;
    }
  | { type: 'and'; conditions: Condition[] }
  | { type: 'or'; conditions: Condition[] }
  | { type: 'not'; condition: Condition };

export interface LoreEntry {
  id: string;
  displayName: string;
  text: string;
  keys: string[];
  enabled: boolean;
  forceActivation: boolean;
  hidden: boolean;
  searchRange: number;
  keyRelative: boolean;
  nonStoryActivatable: boolean;
  category: string | null;
  contextConfig: ContextConfig;
  loreBiasGroups: PhraseBiasGroup[];
  conditions: Condition[];
  lastUpdatedAt: number;
}

export interface LoreCategory {
  id: string;
  name: string;
  enabled: boolean;
  createSubcontext: boolean;
  subcontextSettings: ContextConfig;
  useCategoryDefaults: boolean;
  categoryDefaults: Partial<LoreEntry>;
  categoryBiasGroups: PhraseBiasGroup[];
  entryHeader: string;
  open: boolean;
}

export interface Lorebook {
  entries: LoreEntry[];
  categories: LoreCategory[];
  settings: { orderByKeyLocations: boolean };
}

export interface EphemeralEntry {
  id: string;
  text: string;
  /** Story step the entry was created at. */
  startingStep: number;
  delay: number;
  duration: number;
  repeat: boolean;
  position: number;
}

export type StoryMode = 'storyteller' | 'adventure';

export interface ModelRef {
  provider: string;
  id: string;
}

export type SamplerId =
  | 'temperature'
  | 'top_k'
  | 'top_p'
  | 'top_a'
  | 'min_p'
  | 'typical_p'
  | 'tfs'
  | 'mirostat'
  | 'unified';

export interface GenerationParams {
  temperature: number;
  /** Output length in characters (NovelAI style). */
  maxLength: number;
  /** Context size in tokens sent to the model (capped by the model's window). */
  maxContext: number;
  minLength: number;
  topK: number;
  topP: number;
  topA: number;
  minP: number;
  typicalP: number;
  tailFreeSampling: number;
  mirostatTau: number;
  mirostatLr: number;
  unifiedLinear: number;
  unifiedQuad: number;
  unifiedConf: number;
  repetitionPenalty: number;
  repetitionPenaltyRange: number;
  repetitionPenaltySlope: number;
  repetitionPenaltyFrequency: number;
  repetitionPenaltyPresence: number;
  repetitionPenaltyWhitelist: boolean;
  dynamicPenaltyRange: boolean;
  phraseRepPen: 'off' | 'very_light' | 'light' | 'medium' | 'aggressive' | 'very_aggressive';
  order: { id: SamplerId; enabled: boolean }[];
}

export interface Preset {
  id: string;
  name: string;
  params: GenerationParams;
  builtin?: boolean;
}

export interface StoryContextSettings {
  memory: ContextConfig;
  authorsNote: ContextConfig;
  story: ContextConfig;
  loreDefaults: ContextConfig;
}

export interface Story {
  id: string;
  version: number;
  title: string;
  description: string;
  tags: string[];
  genre: string;
  author: string;
  favorite: boolean;
  shelf: string | null;
  mode: StoryMode;
  createdAt: number;
  updatedAt: number;
  /** Current materialized document (cache of the history at `history.current`). */
  doc: Span[];
  history: History;
  memory: string;
  authorsNote: string;
  lorebook: Lorebook;
  contextSettings: StoryContextSettings;
  ephemeral: EphemeralEntry[];
  systemPrompt: string;
  prefill: string;
  presetId: string;
  /** Per-story parameter overrides on top of the preset. */
  params: GenerationParams;
  model: ModelRef | null;
  phraseBias: PhraseBiasGroup[];
  bannedTokens: string[];
  banBrackets: boolean;
  avoidOverusedWords: boolean;
  stopSequences: string[];
  /** Number of AI generations so far (the "story step"). */
  step: number;
  /** Scenario placeholder definitions, when the story is a scenario. */
  placeholders: Placeholder[];
  titleHistory: string[];
  scripts: UserScript[];
}

/** A user script run in a sandbox, hooking into generation. */
export interface UserScript {
  id: string;
  name: string;
  enabled: boolean;
  code: string;
}

export interface Placeholder {
  key: string;
  defaultValue: string;
  description: string;
  longDescription?: string;
}

export interface Shelf {
  id: string;
  title: string;
  description: string;
  createdAt: number;
}

export interface StoryMeta {
  id: string;
  title: string;
  description: string;
  preview: string;
  tags: string[];
  favorite: boolean;
  shelf: string | null;
  mode: StoryMode;
  createdAt: number;
  updatedAt: number;
}

/** A chat message sent to the model through the server. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest {
  model: ModelRef;
  system?: string;
  messages: ChatMessage[];
  params?: Partial<GenerationParams>;
  stop?: string[];
  maxTokens?: number;
}
