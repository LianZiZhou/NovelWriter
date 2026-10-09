import { create } from 'zustand';
import {
  ACTION_CATEGORIES,
  DEFAULT_BUDGET,
  BOOK_BUDGET,
  buildDirectorSystem,
  diffText,
  directorKickoff,
  docText,
  newRun,
  revertFieldChange,
  rollbackPlan,
  runDirector,
  toolsFor,
  trustFor,
  uid,
  type ActionCategory,
  type DirectorHost,
  type DirectorRun,
  type DirectorToolCall,
  type ModelRef,
  type RunBudget,
  type RunMode,
  type Story,
  type TrustLevel,
} from '@novelwriter/core';
import { directorTurn } from '../api.ts';
import { describeCall, executeTool } from '../features/director/executors.ts';
import { t } from '../i18n.ts';
import { useSettings } from './settings.ts';
import { flushSave, useStory } from './story.ts';
import { useUI } from './ui.ts';

/** Runs kept per story (oldest dropped). */
const MAX_RUNS = 5;

export type Pending =
  | { kind: 'confirm'; runId: string; call: DirectorToolCall; category: ActionCategory; preview: ReturnType<typeof describeCall> }
  | { kind: 'ask'; runId: string; question: string; options: string[] };

interface DirectorStore {
  /** The run going in this window, if any. */
  activeRunId: string | null;
  storyId: string | null;
  /** The director's reply streaming in for the current turn. */
  thinking: string;
  pending: Pending | null;
  pauseRequested: boolean;

  start: (goal: string, mode: RunMode, budget?: Partial<RunBudget>) => Promise<void>;
  resume: (runId: string) => Promise<void>;
  /** Stop after the current step. */
  pause: () => void;
  /** Stop now, cutting off a passage being written. */
  stop: () => void;
  interject: (text: string) => void;
  /** Answer the pending approval or question. */
  respond: (r: { approved: boolean; note?: string } | { answer: string }) => void;
  undoEntry: (runId: string, entryId: string) => Promise<void>;
  rollback: (runId: string, checkpointId: string) => Promise<void>;
  deleteRun: (runId: string) => void;
}

let controller: AbortController | null = null;
let queue: string[] = [];
let resolvePending: ((v: unknown) => void) | null = null;
/** What the story looked like after the director's last action, to tell it what the author changed since. */
let seen: { text: string; memory: string; authorsNote: string } | null = null;

const snapshot = (s: Story) => ({ text: docText(s.doc), memory: s.memory, authorsNote: s.authorsNote });

/** A checkpoint's label in the interface language ("Turn 3"). */
export function checkpointLabel(label: string): string {
  return t('Turn {n}', { n: /\d+/.exec(label)?.[0] ?? '' });
}

export function runsOf(s: Story | null): DirectorRun[] {
  return s?.director?.runs ?? [];
}

function saveRun(storyId: string, run: DirectorRun) {
  const store = useStory.getState();
  if (store.current?.id !== storyId) return;
  store.update((s) => {
    const runs = runsOf(s).filter((r) => r.id !== run.id);
    s.director = { ...s.director, runs: [run, ...runs].slice(0, MAX_RUNS) };
  });
}

/** The model that directs: the one picked in settings while it is still connected, else the story's model. */
export function directorModel(): ModelRef | null {
  const st = useStory.getState();
  const pick = useSettings.getState().directorModel;
  if (pick && st.models.some((m) => m.provider === pick.provider && m.id === pick.id)) return pick;
  return st.resolveModel();
}

/** Effective trust per category: app defaults, then the app-wide setting, then the story's own. */
export function effectiveTrust(s: Story | null): Record<ActionCategory, TrustLevel> {
  const app = useSettings.getState().directorTrust;
  return Object.fromEntries(ACTION_CATEGORIES.map((c) => [c, trustFor(c, app, s?.director?.trust)])) as Record<ActionCategory, TrustLevel>;
}

/** A stopped-for-budget run gets another helping when the author continues it. */
function extendBudget(run: DirectorRun): DirectorRun {
  const step = run.mode === 'book' ? BOOK_BUDGET : DEFAULT_BUDGET;
  const { budget: b, spent: s } = run;
  return {
    ...run,
    budget: {
      maxTurns: s.turns >= b.maxTurns ? b.maxTurns + step.maxTurns : b.maxTurns,
      maxPassages: s.passages >= b.maxPassages ? b.maxPassages + step.maxPassages : b.maxPassages,
      maxChars: s.chars >= b.maxChars ? b.maxChars + step.maxChars : b.maxChars,
    },
  };
}

export const useDirector = create<DirectorStore>((set, get) => {
  const wait = <T,>(p: Pending): Promise<T> =>
    new Promise<T>((resolve) => {
      set({ pending: p });
      resolvePending = resolve as (v: unknown) => void;
    });

  async function drive(storyId: string, start: DirectorRun) {
    controller = new AbortController();
    const signal = controller.signal;
    set({ activeRunId: start.id, storyId, pauseRequested: false, thinking: '', pending: null });
    const cur = useStory.getState().current!;
    seen = snapshot(cur);
    const host: DirectorHost = {
      async callModel(system, messages, tools, sig) {
        const model = directorModel();
        if (!model) throw new Error(t('No AI model is configured.'));
        set({ thinking: '' });
        try {
          return await directorTurn({ model, system, messages, tools, maxTokens: 4096, temperature: 0.7 }, sig, (all) => set({ thinking: all }));
        } finally {
          set({ thinking: '' });
        }
      },
      system: (run) => buildDirectorSystem(useStory.getState().current!, run, { trust: effectiveTrust(useStory.getState().current) }),
      tools: (run) => toolsFor(run.mode, useSettings.getState().directorTrust, useStory.getState().current?.director?.trust),
      trust: (tool) => trustFor(tool.category, useSettings.getState().directorTrust, useStory.getState().current?.director?.trust),
      async execute(call, run, sig) {
        const model = directorModel();
        try {
          return await executeTool(call, run, sig, { directorModel: model! });
        } finally {
          const s = useStory.getState().current;
          if (s?.id === storyId) seen = snapshot(s);
        }
      },
      confirm: (call, tool, run) => {
        const p = wait<{ approved: boolean; note?: string }>({ kind: 'confirm', runId: run.id, call, category: tool.category as ActionCategory, preview: describeCall(call) });
        return p;
      },
      ask: (question, options, run) => wait<string>({ kind: 'ask', runId: run.id, question, options }),
      save: (run) => saveRun(storyId, run),
      shouldPause: () => get().pauseRequested || useStory.getState().current?.id !== storyId,
      takeInterjections: () => queue.splice(0),
      observe() {
        const s = useStory.getState().current;
        if (!s || !seen) return null;
        const now = snapshot(s);
        const notes: string[] = [];
        const d = diffText(seen.text, now.text);
        if (d) {
          const q = (x: string) => `"${x.length > 300 ? `${x.slice(0, 300)}…` : x}"`;
          notes.push(
            `The author edited the story text at character ${d.pos}` +
              (d.removed ? `, removing ${q(d.removed)}` : '') +
              (d.inserted ? `${d.removed ? ' and' : ','} writing ${q(d.inserted)}` : '') +
              '. Keep their changes.',
          );
        }
        if (now.memory !== seen.memory) notes.push(`The author changed the memory. It now reads:\n${now.memory || '(empty)'}`);
        if (now.authorsNote !== seen.authorsNote) notes.push(`The author changed the author's note. It now reads:\n${now.authorsNote || '(empty)'}`);
        seen = now;
        return notes.length ? notes.join('\n') : null;
      },
      historyNode: () => useStory.getState().current?.history.current ?? '',
    };
    let final: DirectorRun | null = null;
    try {
      final = await runDirector(start, host, signal);
    } catch (e) {
      useUI.getState().toast((e as Error).message, 'error');
    } finally {
      controller = null;
      resolvePending = null;
      set({ activeRunId: null, storyId: null, thinking: '', pending: null, pauseRequested: false });
      // How the run ended should reach the server even if the window closes right after.
      flushSave();
    }
    const ui = useUI.getState();
    if (final?.status === 'done') ui.toast(t('Director finished: {result}', { result: (final.result ?? '').slice(0, 140) }), 'success');
    else if (final?.status === 'error') ui.toast(t('Director stopped: {result}', { result: final.result ?? '' }), 'error');
  }

  const findRun = (runId: string) => runsOf(useStory.getState().current).find((r) => r.id === runId);

  return {
    activeRunId: null,
    storyId: null,
    thinking: '',
    pending: null,
    pauseRequested: false,

    async start(goal, mode, budget) {
      const store = useStory.getState();
      const s = store.current;
      if (!s || get().activeRunId || !goal.trim()) return;
      if (!directorModel()) {
        useUI.getState().toast(t('No AI model is configured. Open Settings → AI Providers to sign in, or use the offline Demo model.'), 'error');
        return;
      }
      queue = [];
      const run = newRun(goal.trim(), mode, budget, directorKickoff(s, goal, mode));
      saveRun(s.id, run);
      await drive(s.id, run);
    },

    async resume(runId) {
      const s = useStory.getState().current;
      const run = findRun(runId);
      if (!s || !run || get().activeRunId) return;
      let next = extendBudget(run);
      // A finished run picks up again from what the author asks next (or just keeps going).
      if ((run.status === 'done' || run.status === 'error' || run.status === 'stopped') && !queue.length) queue.push(t('Continue.'));
      next = { ...next, status: 'paused' };
      await drive(s.id, next);
    },

    pause() {
      if (get().activeRunId) set({ pauseRequested: true });
    },

    stop() {
      if (!get().activeRunId) return;
      controller?.abort();
      useStory.getState().stop();
      const p = get().pending;
      if (p) get().respond(p.kind === 'ask' ? { answer: '' } : { approved: false });
    },

    interject(text) {
      if (text.trim()) queue.push(text.trim());
    },

    respond(r) {
      const resolve = resolvePending;
      resolvePending = null;
      set({ pending: null });
      if (!resolve) return;
      resolve('answer' in r ? r.answer : r);
    },

    async undoEntry(runId, entryId) {
      const store = useStory.getState();
      const s = store.current;
      const run = findRun(runId);
      const entry = run?.log.find((e) => e.id === entryId);
      if (!s || !run || !entry || entry.reverted || store.generating) return;
      if (entry.change) {
        let r = revertFieldChange(s, entry.change);
        if ('conflict' in r) {
          const ok = await useUI.getState().confirm({ title: t('Undo this change?'), message: t('This was changed again afterwards. Undoing it also discards the later changes.'), confirmLabel: t('Undo') });
          if (!ok) return;
          r = revertFieldChange(s, entry.change, true);
        }
        if ('story' in r) {
          const next = r.story;
          store.update((st) => void Object.assign(st, { memory: next.memory, authorsNote: next.authorsNote, lorebook: next.lorebook, outline: next.outline, title: next.title, genre: next.genre, tags: next.tags, description: next.description }));
        }
      }
      if (entry.historyNode && entry.historyBefore) {
        const cur = useStory.getState().current!;
        if (cur.history.current === entry.historyNode) store.undo();
        else if (cur.history.nodes[entry.historyBefore]) {
          const ok = await useUI.getState().confirm({
            title: t('Go back to before this?'),
            message: t('The story text returns to how it was before this step, so text written after it is taken back too. It stays in the history as a branch.'),
            confirmLabel: t('Go Back'),
          });
          if (!ok) return;
          store.jump(entry.historyBefore);
        }
      }
      const latest = findRun(runId);
      if (latest) saveRun(s.id, { ...latest, log: latest.log.map((e) => (e.id === entryId ? { ...e, reverted: true } : e)) });
    },

    async rollback(runId, checkpointId) {
      const store = useStory.getState();
      const run = findRun(runId);
      const s = store.current;
      if (!s || !run || get().activeRunId === runId || store.generating) return;
      const plan = rollbackPlan(run, checkpointId);
      if (!plan) return;
      const cp = run.checkpoints.find((c) => c.id === checkpointId)!;
      const ok = await useUI.getState().confirm({
        title: t('Roll back to {label}?', { label: checkpointLabel(cp.label) }),
        message: t('Story text, memory, author\'s note, lorebook and outline changes the Director made after this point are undone. The text stays in the history as a branch.'),
        confirmLabel: t('Roll Back'),
      });
      if (!ok) return;
      if (s.history.nodes[plan.historyNode]) store.jump(plan.historyNode);
      let next = useStory.getState().current!;
      for (const e of plan.entries) {
        const r = revertFieldChange(next, e.change, true);
        if ('story' in r) next = r.story;
      }
      store.update((st) => void Object.assign(st, { memory: next.memory, authorsNote: next.authorsNote, lorebook: next.lorebook, outline: next.outline, title: next.title, genre: next.genre, tags: next.tags, description: next.description }));
      const latest = findRun(runId)!;
      const undone = new Set(latest.log.slice(cp.logIndex).filter((e) => e.change || e.historyNode).map((e) => e.id));
      saveRun(s.id, {
        ...latest,
        log: [...latest.log.map((e) => (undone.has(e.id) ? { ...e, reverted: true } : e)), { id: uid(), at: Date.now(), kind: 'system', text: t('Rolled back to {label}.', { label: checkpointLabel(cp.label) }) }],
        checkpoints: latest.checkpoints.filter((c) => c.at <= cp.at),
        transcript: [...latest.transcript, { role: 'user', content: `[Note] The author rolled the story back to where it was at the start of ${cp.label}: the story text and every change you made after that point were undone. Look at the story again before continuing.` }],
      });
    },

    deleteRun(runId) {
      if (get().activeRunId === runId) return;
      useStory.getState().update((s) => void (s.director = { ...s.director, runs: runsOf(s).filter((r) => r.id !== runId) }));
    },
  };
});

// Leaving the story pauses its run; an approval or question it was waiting on is withdrawn.
useStory.subscribe((st) => {
  const d = useDirector.getState();
  if (!d.activeRunId || st.current?.id === d.storyId) return;
  d.pause();
  if (d.pending) d.respond(d.pending.kind === 'ask' ? { answer: '(The author left the story before answering.)' } : { approved: false, note: 'The author left the story.' });
});

// In the browser, closing the tab mid-run asks first. (The desktop app keeps running it until it quits.)
if (typeof window !== 'undefined' && !window.novelwriterDesktop) {
  window.addEventListener('beforeunload', (e) => {
    if (useDirector.getState().activeRunId) e.preventDefault();
  });
}
