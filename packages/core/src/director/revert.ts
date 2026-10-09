import type { Story } from '../types.ts';
import type { DirectorRun, FieldChange, StoryInfo } from './types.ts';

export function storyInfo(s: Story): StoryInfo {
  return { title: s.title, genre: s.genre, tags: [...s.tags], description: s.description };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The value a change targets, as it is in the story now. */
function currentValue(story: Story, c: FieldChange): unknown {
  if (c.field === 'lore') return story.lorebook.entries.find((e) => e.id === c.entryId) ?? null;
  if (c.field === 'outline') return story.outline ?? null;
  if (c.field === 'info') return storyInfo(story);
  return story[c.field];
}

/** Whether the field still holds what the change left there (so undoing it loses nothing newer). */
export function changeIsCurrent(story: Story, c: FieldChange): boolean {
  return same(currentValue(story, c), c.after);
}

/**
 * Undo a change outside the document history: put back the value from before it. Refuses (unless `force`)
 * when the field changed again since, so a later edit by the author isn't silently thrown away.
 */
export function revertFieldChange(story: Story, c: FieldChange, force = false): { story: Story } | { conflict: string } {
  if (!force && !changeIsCurrent(story, c)) {
    const what = c.field === 'lore' ? `lorebook entry "${(c.after ?? c.before)?.displayName ?? c.entryId}"` : c.field === 'authorsNote' ? "author's note" : c.field === 'info' ? 'story info' : c.field;
    return { conflict: `The ${what} changed again after this. Undo anyway?` };
  }
  const s: Story = { ...story };
  if (c.field === 'memory' || c.field === 'authorsNote') s[c.field] = c.before;
  else if (c.field === 'outline') s.outline = c.before ?? undefined;
  else if (c.field === 'info') Object.assign(s, c.before);
  else if (c.field === 'lore') {
    const entries = story.lorebook.entries.filter((e) => e.id !== c.entryId);
    if (c.before) {
      const at = story.lorebook.entries.findIndex((e) => e.id === c.entryId);
      entries.splice(at < 0 ? entries.length : at, 0, c.before);
    }
    s.lorebook = { ...story.lorebook, entries };
  }
  return { story: s };
}

/**
 * What rolling a run back to a checkpoint takes: the history node to return to, and the field changes made
 * after it (newest first) with the log entries they belong to.
 */
export function rollbackPlan(run: DirectorRun, checkpointId: string): { historyNode: string; entries: { id: string; change: FieldChange }[] } | null {
  const cp = run.checkpoints.find((c) => c.id === checkpointId);
  if (!cp) return null;
  const entries = run.log
    .slice(cp.logIndex)
    .filter((e) => e.change && !e.reverted)
    .map((e) => ({ id: e.id, change: e.change! }))
    .reverse();
  return { historyNode: cp.historyNode, entries };
}
