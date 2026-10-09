import type { LoreEntry, ModelRef } from '../types.ts';

/**
 * The Director: an agent that runs a story on its own. A tool-calling "director" model plans and steers;
 * the story's own writing model still writes every passage through the normal context builder.
 */

/** Kinds of change the director can make, each with its own trust level. */
export type ActionCategory = 'prose' | 'rewrite' | 'memory' | 'authorsNote' | 'lore' | 'loreDelete' | 'outline' | 'structure';

export const ACTION_CATEGORIES: ActionCategory[] = ['prose', 'rewrite', 'memory', 'authorsNote', 'lore', 'loreDelete', 'outline', 'structure'];

/** `auto`: apply (undoable); `confirm`: ask the user first; `deny`: the tool is not offered at all. */
export type TrustLevel = 'auto' | 'confirm' | 'deny';

export type TrustPolicy = Partial<Record<ActionCategory, TrustLevel>>;

/** A JSON Schema object (what tool-calling APIs take as tool parameters). */
export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
}

/** A tool as sent to the director model. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface DirectorToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Provider-neutral transcript; the server maps it onto the model API's own messages. */
export type DirectorMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: DirectorToolCall[]; native?: NativeReply }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

/**
 * The model's reply exactly as its API returned it (thinking blocks with their signatures), sent back
 * unchanged on later turns to the same model: some APIs require that when thinking is on.
 */
export interface NativeReply {
  provider: string;
  model: string;
  content: unknown[];
}

/** One director-model turn, sent to the server. */
export interface DirectorTurnRequest {
  model: ModelRef;
  system: string;
  messages: DirectorMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
}

export type DirectorTurnEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string; toolCalls: DirectorToolCall[]; stopReason: string; usage?: { input?: number; output?: number }; native?: NativeReply }
  | { type: 'error'; message: string };

export type PlanStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface PlanStep {
  id: string;
  text: string;
  status: PlanStatus;
}

/** A change to something outside the document history, kept so it can be undone. */
export type FieldChange =
  | { field: 'memory' | 'authorsNote'; before: string; after: string }
  | { field: 'lore'; entryId: string; before: LoreEntry | null; after: LoreEntry | null }
  | { field: 'outline'; before: Outline | null; after: Outline | null }
  | { field: 'info'; before: StoryInfo; after: StoryInfo };

/** Story fields `set_story_info` changes. */
export interface StoryInfo {
  title: string;
  genre: string;
  tags: string[];
  description: string;
}

export interface LogEntry {
  id: string;
  at: number;
  kind: 'tool' | 'thought' | 'user' | 'system' | 'error';
  /** For tool entries. */
  tool?: string;
  args?: Record<string, unknown>;
  /** Short text shown in the activity feed (tool result, thought, message). */
  text: string;
  isError?: boolean;
  /** History node created by a text change (jump to its parent to undo). */
  historyNode?: string;
  /** The history node current before the change. */
  historyBefore?: string;
  change?: FieldChange;
  reverted?: boolean;
}

export type RunStatus = 'running' | 'paused' | 'waiting' | 'done' | 'stopped' | 'error';

export type RunMode = 'loop' | 'book';

export type BookPhase = 'premise' | 'world' | 'characters' | 'outline' | 'chapters' | 'review';

export interface RunBudget {
  /** Director model turns. */
  maxTurns: number;
  /** Passages written by the writing model. */
  maxPassages: number;
  /** Characters of story text added. */
  maxChars: number;
}

export interface RunSpent {
  turns: number;
  passages: number;
  chars: number;
}

/** A snapshot to roll the story back to (history node + fields outside the history). */
export interface Checkpoint {
  id: string;
  at: number;
  /** Log length when it was taken: entries after it are what a rollback undoes. */
  logIndex: number;
  historyNode: string;
  label: string;
}

export interface DirectorRun {
  id: string;
  goal: string;
  mode: RunMode;
  phase?: BookPhase;
  status: RunStatus;
  plan: PlanStep[];
  log: LogEntry[];
  transcript: DirectorMessage[];
  budget: RunBudget;
  spent: RunSpent;
  checkpoints: Checkpoint[];
  /** Final summary from `finish`, or the reason the run stopped. */
  result?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DirectorState {
  runs: DirectorRun[];
  /** Per-story trust overrides (on top of the app-wide policy). */
  trust?: TrustPolicy;
}

export type ChapterStatus = 'planned' | 'drafting' | 'drafted' | 'revised';

export interface Chapter {
  id: string;
  title: string;
  synopsis: string;
  beats: string[];
  status: ChapterStatus;
}

/** The book plan: premise and chapters. Chapter boundaries in the text are ordinary heading lines. */
export interface Outline {
  premise: string;
  chapters: Chapter[];
}
