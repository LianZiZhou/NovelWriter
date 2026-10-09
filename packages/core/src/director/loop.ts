import { uid } from '../util.ts';
import { TOOL_BY_NAME, validateArgs, type DirectorTool } from './tools.ts';
import type { BookPhase, DirectorMessage, DirectorRun, DirectorToolCall, FieldChange, LogEntry, NativeReply, PlanStep, RunBudget, RunMode, ToolSpec, TrustLevel } from './types.ts';

/** What executing a tool did. */
export interface ToolOutcome {
  /** Returned to the director model. */
  content: string;
  isError?: boolean;
  /** Shown in the activity feed (default: the start of `content`). */
  summary?: string;
  historyNode?: string;
  historyBefore?: string;
  change?: FieldChange;
  /** Story characters added. */
  chars?: number;
  /** A passage was written by the writing model. */
  passage?: boolean;
}

export interface ModelReply {
  text: string;
  toolCalls: DirectorToolCall[];
  native?: NativeReply;
}

/** Everything the loop needs from its surroundings; the web app (or a test) provides it. */
export interface DirectorHost {
  callModel(system: string, messages: DirectorMessage[], tools: ToolSpec[], signal: AbortSignal): Promise<ModelReply>;
  /** The director's system prompt for the run as it stands (rebuilt every turn). */
  system(run: DirectorRun): string;
  /** Tools offered this turn (denied ones already left out). */
  tools(run: DirectorRun): DirectorTool[];
  trust(tool: DirectorTool, args: Record<string, unknown>): TrustLevel;
  /** Run a story tool (everything but the loop's own control tools). */
  execute(call: DirectorToolCall, run: DirectorRun, signal: AbortSignal): Promise<ToolOutcome>;
  /** A `confirm`-level action: resolve with the author's decision. */
  confirm(call: DirectorToolCall, tool: DirectorTool, run: DirectorRun): Promise<{ approved: boolean; note?: string }>;
  /** `ask_user`: resolve with the author's answer. */
  ask(question: string, options: string[], run: DirectorRun): Promise<string>;
  /** Persist the run (called after every change). */
  save(run: DirectorRun): void;
  shouldPause(): boolean;
  /** Messages the author typed while the run was going. */
  takeInterjections(): string[];
  /** A note on what the author changed in the story since the last turn, if anything. */
  observe?(): string | null;
  /** The current history node, for checkpoints. */
  historyNode?(): string;
  onDelta?(text: string): void;
}

/** Characters of transcript kept for the director (older turns are dropped first). */
export const TRANSCRIPT_LIMIT = 60000;
/** Characters of one tool result kept in the transcript. */
export const TOOL_RESULT_LIMIT = 6000;
const MAX_LOG = 500;
const MAX_CHECKPOINTS = 40;
const MAX_TOOL_ERRORS = 4;
const MAX_IDLE_TURNS = 2;

export const DEFAULT_BUDGET: RunBudget = { maxTurns: 60, maxPassages: 20, maxChars: 30000 };
export const BOOK_BUDGET: RunBudget = { maxTurns: 600, maxPassages: 300, maxChars: 400000 };

export function newRun(goal: string, mode: RunMode, budget: Partial<RunBudget> = {}, kickoff?: string): DirectorRun {
  const now = Date.now();
  return {
    id: uid(),
    goal,
    mode,
    phase: mode === 'book' ? 'premise' : undefined,
    status: 'paused',
    plan: [],
    log: [{ id: uid(), at: now, kind: 'user', text: goal }],
    transcript: [{ role: 'user', content: kickoff ?? goal }],
    budget: { ...(mode === 'book' ? BOOK_BUDGET : DEFAULT_BUDGET), ...budget },
    spent: { turns: 0, passages: 0, chars: 0 },
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  return `${text.slice(0, head)}\n[… ${text.length - max} characters omitted …]\n${text.slice(text.length - (max - head))}`;
}

const size = (m: DirectorMessage) => m.content.length + (m.role === 'assistant' ? JSON.stringify(m.toolCalls ?? []).length + (m.native ? JSON.stringify(m.native).length : 0) : 0);

/**
 * Keep the transcript under `limit` characters: the opening message stays, then whole turns (an assistant
 * message with its tool results and anything after them) are dropped oldest first.
 */
export function compactTranscript(messages: DirectorMessage[], limit = TRANSCRIPT_LIMIT): DirectorMessage[] {
  let total = messages.reduce((n, m) => n + size(m), 0);
  if (total <= limit || messages.length < 3) return messages;
  const [first, ...rest] = messages;
  const groups: DirectorMessage[][] = [];
  for (const m of rest) {
    if (m.role === 'assistant' || !groups.length) groups.push([m]);
    else groups[groups.length - 1].push(m);
  }
  let dropped = 0;
  // Always keep the latest turn, whatever its size.
  while (groups.length > 1 && total > limit) {
    const g = groups.shift()!;
    total -= g.reduce((n, m) => n + size(m), 0);
    dropped++;
  }
  if (!dropped) return messages;
  const NOTE = '\n\n[Earlier turns of this run were dropped to save space. Use story_overview and read_story to see where things stand.]';
  const head: DirectorMessage = first.role === 'user' && !first.content.endsWith(NOTE) ? { ...first, content: first.content + NOTE } : first;
  // A leading group that doesn't start with an assistant turn would break the tool-call pairing.
  while (groups.length && groups[0][0].role !== 'assistant') groups.shift();
  return [head, ...groups.flat()];
}

function addLog(run: DirectorRun, e: Omit<LogEntry, 'id' | 'at'>): DirectorRun {
  const log = [...run.log, { id: uid(), at: Date.now(), ...e }];
  return { ...run, log: log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log };
}

function budgetLeft(run: DirectorRun): string | null {
  const { budget: b, spent: s } = run;
  if (s.turns >= b.maxTurns) return `turn budget (${b.maxTurns}) used up`;
  if (s.passages >= b.maxPassages) return `passage budget (${b.maxPassages}) used up`;
  if (s.chars >= b.maxChars) return `length budget (${b.maxChars} characters) used up`;
  return null;
}

const PHASES: BookPhase[] = ['premise', 'world', 'characters', 'outline', 'chapters', 'review'];

/**
 * Run the director until it finishes, is paused or stopped, needs the author, or runs out of budget.
 * Every state change goes through `host.save`; the returned run is the last one saved.
 */
export async function runDirector(start: DirectorRun, host: DirectorHost, signal: AbortSignal): Promise<DirectorRun> {
  let run: DirectorRun = { ...start, status: 'running', result: undefined };
  const save = (r: DirectorRun) => {
    run = { ...r, updatedAt: Date.now() };
    host.save(run);
  };
  const end = (status: DirectorRun['status'], result?: string) => {
    save({ ...run, status, result: result ?? run.result });
    return run;
  };
  save(run);
  let toolErrors = 0;
  let idle = 0;

  while (true) {
    if (signal.aborted) return end('stopped', 'Stopped by the author.');
    if (host.shouldPause()) return end('paused');
    const over = budgetLeft(run);
    if (over) return end('done', `Budget reached: ${over}.`);

    // What the author said or changed since the last turn goes in before the director's next move.
    const notes: string[] = [];
    for (const text of host.takeInterjections()) {
      notes.push(`[Author] ${text}`);
      run = addLog(run, { kind: 'user', text });
    }
    const observed = host.observe?.();
    if (observed) notes.push(`[Note] ${observed}`);
    if (notes.length) run = { ...run, transcript: [...run.transcript, { role: 'user', content: notes.join('\n\n') }] };

    const node = host.historyNode?.();
    if (node && run.checkpoints.at(-1)?.historyNode !== node) {
      const cps = [...run.checkpoints, { id: uid(), at: Date.now(), logIndex: run.log.length, historyNode: node, label: `Turn ${run.spent.turns + 1}` }];
      run = { ...run, checkpoints: cps.slice(-MAX_CHECKPOINTS) };
    }
    const transcript = compactTranscript(run.transcript);
    save({ ...run, transcript });

    let reply: ModelReply;
    try {
      const tools = host.tools(run);
      reply = await host.callModel(host.system(run), run.transcript, tools.map(({ name, description, parameters }) => ({ name, description, parameters })), signal);
    } catch (e) {
      if (signal.aborted) return end('stopped', 'Stopped by the author.');
      save(addLog(run, { kind: 'error', text: (e as Error).message, isError: true }));
      return end('error', (e as Error).message);
    }
    // Calls need ids to pair with their results; some models leave them out.
    const calls = reply.toolCalls.map((c) => ({ ...c, id: c.id || uid() }));
    run = {
      ...run,
      spent: { ...run.spent, turns: run.spent.turns + 1 },
      transcript: [...run.transcript, { role: 'assistant', content: reply.text, ...(calls.length ? { toolCalls: calls } : {}), ...(reply.native ? { native: reply.native } : {}) }],
    };
    if (reply.text.trim()) run = addLog(run, { kind: 'thought', text: reply.text.trim() });
    save(run);

    if (!calls.length) {
      if (++idle >= MAX_IDLE_TURNS) return end('done', reply.text.trim() || 'The director stopped without calling finish.');
      save({ ...run, transcript: [...run.transcript, { role: 'user', content: 'Keep going: make progress with the tools, or call finish if the goal is reached.' }] });
      continue;
    }
    idle = 0;

    const state: { finished: string | null; halt: 'paused' | 'stopped' | null } = { finished: null, halt: null };
    for (const call of calls) {
      const result = (content: string, isError = false) => {
        run = { ...run, transcript: [...run.transcript, { role: 'tool', toolCallId: call.id, name: call.name, content: clip(content, TOOL_RESULT_LIMIT), ...(isError ? { isError } : {}) }] };
      };
      // Every call gets a result, even ones skipped after a pause, so the transcript stays well-formed.
      if (state.halt || state.finished !== null) {
        result(state.halt === 'stopped' ? 'Not run: the author stopped the run.' : state.halt ? 'Not run: the author paused the run.' : 'Not run: the run already finished.', true);
        continue;
      }
      if (signal.aborted) {
        state.halt = 'stopped';
        result('Not run: the author stopped the run.', true);
        continue;
      }
      if (host.shouldPause()) {
        state.halt = 'paused';
        result('Not run: the author paused the run; it will continue later.', true);
        continue;
      }
      const tool = TOOL_BY_NAME[call.name];
      if (!tool || !host.tools(run).some((t) => t.name === call.name)) {
        result(`Unknown or unavailable tool "${call.name}".`, true);
        run = addLog(run, { kind: 'tool', tool: call.name, args: call.args, text: 'Unknown tool', isError: true });
        toolErrors++;
        continue;
      }
      const v = validateArgs(tool, call.args);
      if (!v.ok) {
        result(`Invalid arguments: ${v.error}`, true);
        run = addLog(run, { kind: 'tool', tool: call.name, args: call.args, text: v.error, isError: true });
        toolErrors++;
        continue;
      }
      const args = v.args;
      if (call.name === 'finish') {
        state.finished = String(args.summary ?? '');
        result('Run finished.');
        run = addLog(run, { kind: 'tool', tool: 'finish', args, text: state.finished });
        continue;
      }
      const out = await runTool(call, tool, args);
      result(out.content, out.isError);
      run = addLog(run, {
        kind: 'tool',
        tool: call.name,
        args,
        text: out.summary ?? out.content.slice(0, 400),
        ...(out.isError ? { isError: true } : {}),
        ...(out.historyNode ? { historyNode: out.historyNode, historyBefore: out.historyBefore } : {}),
        ...(out.change ? { change: out.change } : {}),
      });
      if (out.chars || out.passage) run = { ...run, spent: { ...run.spent, chars: run.spent.chars + (out.chars ?? 0), passages: run.spent.passages + (out.passage ? 1 : 0) } };
      toolErrors = out.isError ? toolErrors + 1 : 0;
      if (signal.aborted) state.halt = 'stopped';
      save(run);
    }
    save(run);
    if (state.finished !== null) return end('done', state.finished);
    if (state.halt) return end(state.halt, state.halt === 'stopped' ? 'Stopped by the author.' : undefined);
    if (toolErrors >= MAX_TOOL_ERRORS) return end('error', `Stopped after ${toolErrors} failed tool calls in a row.`);
  }

  async function runTool(call: DirectorToolCall, tool: DirectorTool, args: Record<string, unknown>): Promise<ToolOutcome> {
    switch (call.name) {
      case 'update_plan': {
        const steps = (args.steps as { text: string; status: PlanStep['status'] }[]).map((s, i) => ({ id: run.plan[i]?.text === s.text ? run.plan[i].id : uid(), text: s.text, status: s.status }));
        run = { ...run, plan: steps };
        return { content: 'Plan updated.', summary: steps.map((s) => `${s.status === 'done' ? '✓' : s.status === 'active' ? '▸' : '·'} ${s.text}`).join('\n') };
      }
      case 'set_phase': {
        const phase = args.phase as BookPhase;
        if (run.mode !== 'book') return { content: 'Phases only apply to whole-book runs.', isError: true };
        run = { ...run, phase };
        const next = PHASES[PHASES.indexOf(phase) + 1];
        return { content: `Phase is now "${phase}".${next ? ` The next one is "${next}".` : ' This is the last phase.'}`, summary: phase };
      }
      case 'ask_user': {
        const question = String(args.question);
        const options = (args.options as string[] | undefined) ?? [];
        save({ ...addLog(run, { kind: 'system', text: question }), status: 'waiting' });
        const answer = await host.ask(question, options, run);
        run = { ...run, status: 'running' };
        if (signal.aborted) return { content: 'The author stopped the run before answering.', isError: true };
        return { content: `The author answered: ${answer}`, summary: answer };
      }
    }
    const level = host.trust(tool, args);
    if (level === 'deny') return { content: 'The author does not allow this action.', isError: true };
    if (level === 'confirm') {
      save({ ...run, status: 'waiting' });
      const d = await host.confirm(call, tool, run);
      run = { ...run, status: 'running' };
      if (signal.aborted) return { content: 'Not run: the author stopped the run.', isError: true };
      if (!d.approved) return { content: `The author rejected this action${d.note ? `: ${d.note}` : '.'}`, summary: d.note ? `Rejected: ${d.note}` : 'Rejected', isError: true };
    }
    try {
      return await host.execute({ ...call, args }, run, signal);
    } catch (e) {
      return { content: `Tool failed: ${(e as Error).message}`, isError: true };
    }
  }
}
