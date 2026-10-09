import type { DirectorState, Outline } from './director/types.ts';

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
  /** Token probabilities of an AI generation, offsets relative to the inserted text. */
  probs?: TokenProb[];
}

/** A generated token: offset/length in the inserted text, natural-log probability, top alternatives. */
export interface TokenProb {
  o: number;
  t: string;
  lp: number;
  top: [string, number][];
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

export type EquationVariable = 'currentStep' | 'paragraphCount' | 'characterCount' | 'activeEntries' | 'random';

export interface EquationTerm {
  /** How this term combines with the result so far (ignored on the first term). */
  operator: '+' | '-' | '*' | '/' | '%';
  value: number | EquationVariable;
}

export type Condition =
  | { type: 'true' }
  | {
      type: 'keyword';
      key: string;
      /** Where to search (default: the story). */
      location?: 'story' | 'lore' | 'authorsNote' | 'memory';
      /** Characters searched from the end of the text; 0 or unset = the whole text. */
      range?: number;
    }
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
  | {
      /** Terms combined strictly left to right (no operator precedence), then compared with `value`. */
      type: 'equation';
      terms: EquationTerm[];
      op: '<' | '<=' | '=' | '>=' | '>' | '!=';
      value: number;
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
  /** Chance (1-100) the entry activates when its keys match; unset = always. */
  probability?: number;
  /** Inclusion group: when several entries of a group activate, only one is kept. */
  group?: string;
  /** Relative chance of being the one kept in its group (default 100). */
  groupWeight?: number;
  /** In its group, keep the entry with the highest insertion order instead of a weighted random pick. */
  groupPrioritize?: boolean;
  /** Stays active for this many generations after it activates. */
  sticky?: number;
  /** Can't activate again for this many generations after it was active. */
  cooldown?: number;
  /** Can't activate before this story step. */
  delay?: number;
  /** Its text never activates other entries (cascading activation). */
  preventRecursion?: boolean;
  /** Keys match letter case exactly. */
  caseSensitive?: boolean;
  /** Keys only match whole words (alphabetic scripts). */
  wholeWords?: boolean;
}

/** Per-entry timing kept with the story for sticky and cooldown entries (story steps, inclusive). */
export type LoreState = Record<string, { stickyUntil: number; cooldownUntil: number }>;

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
  /** XTC: with this probability, drop every token above the threshold but the least likely of them. 0 = off. */
  xtcProbability?: number;
  xtcThreshold?: number;
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
  /** Side Chat conversations about this story. */
  chats: SideChat[];
  /** Style tag strength 1-5, sent as a `[ S: n ]` line after ATTG; 0 = off. */
  styleTag: number;
  /** The new-story Genre & Tags prompt was answered or dismissed. */
  attgPrompted: boolean;
  /** Timing of sticky / cooldown lorebook entries. */
  loreState?: LoreState;
  /** Variables set by `{{setvar}}` macros. */
  vars?: Record<string, string>;
  /** Running summary of the story text that no longer fits in the context. */
  summary?: StorySummary;
  /** Put relevant passages from earlier in the story (out of context) back into it. */
  recall?: { enabled: boolean; tokenBudget: number };
  /** Per-script data kept with the story (`api.v1.storyStorage` / `historyStorage`). */
  scriptStorage?: Record<string, Record<string, unknown>>;
  /** The book plan written by the Director (premise and chapters). */
  outline?: Outline;
  /** Director runs on this story. */
  director?: DirectorState;
}

export interface StorySummary {
  enabled: boolean;
  text: string;
  /** Story characters covered by the summary (it summarizes text[0, upTo)). */
  upTo: number;
}

/** A Side Chat conversation: talk with the model about the story without touching it. */
export interface SideChat {
  id: string;
  title: string;
  createdAt: number;
  messages: SideChatMessage[];
}

export interface SideChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Text quoted into the chat (recent story, a selection, a lore entry), shown as a block above the message. */
  excerpt?: { label: string; text: string };
}

/** A user script run in a sandbox, hooking into generation. */
export interface UserScript {
  id: string;
  name: string;
  enabled: boolean;
  code: string;
  /** TypeScript is compiled in the browser before the script runs. */
  language?: 'js' | 'ts';
  /** Permissions the user has granted (a script declares what it needs in its @meta block). */
  granted?: string[];
  /** Values for the script's config fields. */
  config?: Record<string, unknown>;
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
  /** Shelf this one sits on (nested shelves); null/undefined = the library root. */
  parent?: string | null;
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
  /** Active phrase-bias groups, sent as logit_bias where the backend can tokenize them. */
  bias?: { phrases: string[]; bias: number }[];
  /** Banned phrases; single-token ones become logit_bias -100. */
  banned?: string[];
  /** Ask for this many top alternatives per token (token probabilities). */
  logprobs?: number;
  /** `messages` without a story-tail prefill, used if the model rejects the prefill. */
  fallbackMessages?: ChatMessage[];
  /** The context as plain text, for models run as raw text completion. */
  prompt?: string;
}
