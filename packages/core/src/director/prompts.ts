import { docText } from '../doc.ts';
import { storyInfoText } from '../prompts.ts';
import { stripComments } from '../context.ts';
import type { ChatMessage, Story } from '../types.ts';
import { locateChapters } from './chapters.ts';
import { ACTION_CATEGORIES, type BookPhase, type DirectorRun, type TrustLevel } from './types.ts';

/** What each phase of a whole-book run is for. */
export const BOOK_PHASES: { phase: BookPhase; title: string; guide: string }[] = [
  {
    phase: 'premise',
    title: 'Premise',
    guide:
      'Turn the author\'s idea into a premise: genre, tone, point of view, protagonist and what they want, the central conflict, the stakes and the direction of the ending. ' +
      'Set the title, genre and tags with set_story_info, and write the premise into update_outline (chapters may stay empty for now). Put the premise, tone and style rules into memory.',
  },
  {
    phase: 'world',
    title: 'World',
    guide:
      'Build the setting the story needs — no more: the main places, factions, institutions, technologies or magic rules, and history that matters to the plot. ' +
      'One lorebook entry each (usually 4–12), with keys the text will actually use. Update memory with a compact world digest (a few lines).',
  },
  {
    phase: 'characters',
    title: 'Cast',
    guide:
      'Create the cast: protagonist, antagonist and the important supporting characters, each a Person lorebook entry with name keys (including nicknames), ' +
      'appearance, role, wants, relationships and how they speak. Mention the protagonist and core relationships in memory.',
  },
  {
    phase: 'outline',
    title: 'Outline',
    guide:
      'Write the chapter outline with update_outline: the number of chapters the author asked for (otherwise 8–15 for a novel, fewer for a novella or short story), ' +
      'each with a synopsis and 3–6 beats, building to the ending. Check it against the premise and characters.',
  },
  {
    phase: 'chapters',
    title: 'Chapters',
    guide:
      'Write the chapters in order. For each: start_chapter; set the author\'s note to the chapter\'s goal and tone; then write_passage beat by beat until its beats are covered ' +
      '(typically 3–8 passages); read what was written and correct course with the next beat. After each chapter: add lorebook entries for new named people, places and things, ' +
      'update memory if something fundamental changed, run summarize, and set_chapter_status drafted.',
  },
  {
    phase: 'review',
    title: 'Review',
    guide:
      'Review chapter by chapter with critique. Fix only real problems — contradictions with the lore or outline, dropped threads, heavy repetition, scenes that read as summary — ' +
      'with rewrite_range, keeping the rest. Mark each chapter revised. Then finish with a summary for the author.',
  },
];

const TRUST_NAMES: Record<string, string> = {
  prose: 'writing passages',
  rewrite: 'rewriting or inserting text',
  memory: 'changing memory / summary',
  authorsNote: "changing the author's note",
  lore: 'creating or editing lorebook entries',
  loreDelete: 'deleting lorebook entries',
  outline: 'changing the outline',
  structure: 'chapter headings and story info',
};

export interface DirectorPromptOptions {
  /** Effective trust level per category. */
  trust: Record<string, TrustLevel>;
}

/** The director's system prompt, rebuilt every turn from the run's state. */
export function buildDirectorSystem(story: Story, run: DirectorRun, opts: DirectorPromptOptions): string {
  const parts: string[] = [];
  parts.push(
    'You are the director of a story being written in NovelWriter, an AI writing studio. You run the writing session for the author, the way a showrunner runs a writers\' room. ' +
      'You do not write the story text yourself: a separate writing model writes each passage when you call write_passage. It sees the story so far, the memory, the author\'s note, ' +
      'the active lorebook entries and your beat for that passage. Your job is to steer it — choose what happens next, keep the story consistent, and keep its background material up to date — ' +
      'so the author doesn\'t have to.',
  );
  parts.push(
    'How to work:\n' +
      '- Start by looking (story_overview, read_story), then set a short plan with update_plan, and keep it current as you go.\n' +
      '- Advance with write_passage, one scene moment per call. Beats are directions to the writer ("Mira finds the letter and hides it before her brother walks in; tense, quiet"), not prose. ' +
      'Read each result: if it went somewhere you didn\'t want, steer with the next beat (or rewrite_range when it must be fixed).\n' +
      '- Keep the writer\'s background current: when a new named character, place, faction or object appears and will matter, create a lorebook entry for it; ' +
      'when facts change, update the entry. Keep memory short (premise, protagonist, tone, current situation). Use the author\'s note for the current scene\'s goal and tone.\n' +
      '- Never delete or rewrite the author\'s own text unless asked. Respect what the author changed while you were working.\n' +
      '- Write beats, lore and memory in the language the story is written in.\n' +
      '- Use ask_user only for decisions that are truly the author\'s. Otherwise decide yourself and keep going.\n' +
      '- When the goal is reached, call finish with a short summary. Several tool calls per turn are fine.',
  );
  if (run.mode === 'book') {
    const cur = BOOK_PHASES.find((p) => p.phase === (run.phase ?? 'premise')) ?? BOOK_PHASES[0];
    parts.push(
      'This is a whole-book run: the book is built in phases — ' +
        BOOK_PHASES.map((p) => (p.phase === cur.phase ? `[${p.title}]` : p.title)).join(' → ') +
        '. Finish the current phase, then call set_phase with the next one. A resumed run continues where it left off.\n\n' +
        `Current phase — ${cur.title}: ${cur.guide}`,
    );
  }
  const asks = ACTION_CATEGORIES.filter((c) => opts.trust[c] === 'confirm').map((c) => TRUST_NAMES[c]);
  const denied = ACTION_CATEGORIES.filter((c) => opts.trust[c] === 'deny').map((c) => TRUST_NAMES[c]);
  if (asks.length || denied.length) {
    parts.push(
      [asks.length ? `The author approves these actions one by one, so they may be rejected: ${asks.join(', ')}. When rejected, adapt rather than retry the same thing.` : '', denied.length ? `Not allowed in this run: ${denied.join(', ')}.` : '']
        .filter(Boolean)
        .join(' '),
    );
  }
  const { budget: b, spent: s } = run;
  parts.push(
    `Budget for this run: ${s.turns}/${b.maxTurns} turns, ${s.passages}/${b.maxPassages} passages, ${s.chars}/${b.maxChars} characters of new story text used. ` +
      'Plan to finish within it.',
  );
  return parts.join('\n\n');
}

/** The opening message of a run: the author's goal with a look at the story as it stands. */
export function directorKickoff(story: Story, goal: string, mode: DirectorRun['mode']): string {
  const intro = mode === 'book' ? 'The author wants a whole book written from this idea:' : 'The author\'s goal for this session:';
  return `${intro}\n"""\n${goal.trim()}\n"""\n\nThe story as it stands:\n\n${storyOverview(story)}`;
}

/** A compact picture of the story for the director: info, background, outline, lore and the latest text. */
export function storyOverview(story: Story, tailChars = 1500): string {
  const text = docText(story.doc);
  const out: string[] = [];
  const info = storyInfoText(story);
  out.push(info ? `## Story info\n${info}` : '## Story info\n(no title, genre or tags yet)');
  if (story.description) out.push(`Description: ${story.description}`);
  out.push(`## Memory\n${story.memory.trim() || '(empty)'}`);
  out.push(`## Author's note\n${story.authorsNote.trim() || '(empty)'}`);
  if (story.summary?.text.trim()) out.push(`## Summary of earlier story\n${story.summary.text.trim()}`);
  if (story.outline) {
    const starts = locateChapters(text, story.outline);
    const ch = story.outline.chapters.map((c, i) => `${i + 1}. ${c.title} [${c.status}${starts[i] !== null && starts[i] !== undefined ? `, starts at ${starts[i]}` : ''}] — ${c.synopsis}${c.beats.length ? `\n   beats: ${c.beats.join(' / ')}` : ''}`);
    out.push(`## Outline\nPremise: ${story.outline.premise || '(none)'}\n${ch.join('\n') || '(no chapters)'}`);
  }
  const entries = story.lorebook.entries;
  out.push(
    `## Lorebook (${entries.length} entries)\n` +
      (entries.length
        ? entries
            .slice(0, 80)
            .map((e) => `- ${e.displayName} [${e.keys.slice(0, 6).join(', ')}] (id ${e.id})${e.enabled ? '' : ' (disabled)'}`)
            .join('\n') + (entries.length > 80 ? `\n… and ${entries.length - 80} more (use search_lore)` : '')
        : '(empty)'),
  );
  const words = text.trim() ? (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? []).length : 0;
  out.push(`## Story text\n${text.length} characters (~${words} words), ${story.step} AI generations so far.`);
  if (text.trim()) out.push(`Latest text:\n"""\n${text.length > tailChars ? '…' : ''}${stripComments(text.slice(-tailChars))}\n"""`);
  else out.push('(The story is empty.)');
  return out.join('\n\n');
}

/** An editor's critique of a passage, for the director (read-only). */
export function buildCritiqueRequest(story: Story, passage: string, focus?: string): { system: string; messages: ChatMessage[] } {
  const bg: string[] = [];
  if (story.memory.trim()) bg.push(`Memory:\n${story.memory.trim()}`);
  if (story.outline?.premise) bg.push(`Premise:\n${story.outline.premise}`);
  const lore = story.lorebook.entries.filter((e) => e.enabled && e.keys.some((k) => k && passage.includes(k))).slice(0, 12);
  if (lore.length) bg.push(`Lore that applies:\n${lore.map((e) => `- ${e.displayName}: ${e.text}`).join('\n')}`);
  return {
    system:
      'You are a demanding but practical fiction editor. Critique the passage for its author: continuity errors and contradictions with the background, ' +
      'pacing (rushed or summarised scenes, padding), repetition of words, images or beats, weak dialogue, point-of-view slips, and prose problems. ' +
      'Quote the exact words where a fix is needed so they can be found. Be concrete and brief: a numbered list of the most important issues (at most 8), ' +
      'then one line on what works. Write in the language of the passage.',
    messages: [{ role: 'user', content: `${bg.length ? `${bg.join('\n\n')}\n\n` : ''}${focus ? `Focus on: ${focus}\n\n` : ''}Passage:\n"""\n${stripComments(passage)}\n"""` }],
  };
}
