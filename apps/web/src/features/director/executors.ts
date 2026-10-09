import {
  buildCritiqueRequest,
  buildToolboxRequest,
  chapterHeading,
  chapterRange,
  clip,
  docText,
  looksCjk,
  newLoreCategory,
  newLoreEntry,
  repetitionScore,
  searchLore,
  storyInfo,
  storyOverview,
  uid,
  type ChapterStatus,
  type DirectorRun,
  type DirectorToolCall,
  type FieldChange,
  type LoreEntry,
  type ModelRef,
  type Outline,
  type Story,
  type ToolOutcome,
} from '@novelwriter/core';
import { generateText } from '../../api.ts';
import { updateSummary, useStory } from '../../store/story.ts';

const story = (): Story => {
  const s = useStory.getState().current;
  if (!s) throw new Error('No story is open.');
  return s;
};
const text = () => docText(story().doc);

/** Change a field outside the document history, returning the record that lets it be undone. */
function setField<K extends 'memory' | 'authorsNote'>(field: K, value: string): FieldChange {
  const before = story()[field];
  useStory.getState().update((s) => void (s[field] = value));
  return { field, before, after: value };
}

function setOutline(next: Outline | null): FieldChange {
  const before = story().outline ?? null;
  useStory.getState().update((s) => void (s.outline = next ?? undefined));
  return { field: 'outline', before, after: next };
}

/** Lorebook category names by entry type, in the story's language. */
const CATEGORY_NAMES: Record<string, [string, string]> = {
  Person: ['Characters', '人物'],
  Place: ['Places', '地点'],
  Thing: ['Things', '物品'],
  Faction: ['Factions', '势力'],
  Concept: ['Concepts', '概念'],
  History: ['History', '历史'],
  General: ['General', '综合'],
};

/** Run inside `generating`, so the editor stays read-only while text is being replaced. */
async function locked<T>(fn: () => Promise<T>): Promise<T> {
  useStory.setState({ generating: true, task: 'director' });
  try {
    return await fn();
  } finally {
    useStory.setState({ generating: false, task: null });
  }
}

/** Insert or replace text as one undoable history step; returns the history nodes around it. */
function replaceText(from: number, to: number, value: string, origin: 'ai' | 'edit'): { historyBefore: string; historyNode: string } {
  const historyBefore = story().history.current;
  useStory.getState().replaceText(from, to, value, origin);
  return { historyBefore, historyNode: story().history.current };
}

export interface ExecEnv {
  /** Model for the Director's own requests (critique). */
  directorModel: ModelRef;
}

/** Carry out one Director tool call on the open story. */
export async function executeTool(call: DirectorToolCall, run: DirectorRun, signal: AbortSignal, env: ExecEnv): Promise<ToolOutcome> {
  const a = call.args as Record<string, never>;
  const s = story();
  switch (call.name) {
    case 'story_overview':
      return { content: storyOverview(s), summary: '' };

    case 'read_story': {
      const all = text();
      let from: number;
      let to: number;
      if (a.chapter) {
        const r = chapterRange(all, s.outline, a.chapter);
        if (!r) return { content: `Chapter ${a.chapter} has no heading in the text yet.`, isError: true };
        ({ from, to } = r);
      } else if (a.from !== undefined || a.to !== undefined) {
        from = Math.min(a.from ?? 0, all.length);
        to = Math.min(Math.max(a.to ?? from + 3000, from), all.length);
      } else {
        to = all.length;
        from = Math.max(0, to - (a.tail ?? 3000));
      }
      to = Math.min(to, from + 12000);
      return { content: `[characters ${from}–${to} of ${all.length}]\n${all.slice(from, to)}`, summary: `${from}–${to}` };
    }

    case 'get_context_report': {
      const ctx = useStory.getState().previewContext();
      if (!ctx) return { content: 'No context available.', isError: true };
      const rows = ctx.report.map((r) => `- ${r.label} (${r.kind}): ${r.included ? `${r.tokens}${r.tokens < r.originalTokens ? `/${r.originalTokens} (trimmed)` : ''} tokens` : `left out (${r.reason})`}${r.activation ? `, activated by ${r.activation}${r.key ? ` "${r.key}"` : ''}` : ''}`);
      return {
        content: `Context: ${ctx.usedTokens}/${ctx.maxTokens} tokens. Story text in view from character ${ctx.storyStart}.\n${rows.join('\n')}`,
        summary: `${ctx.usedTokens}/${ctx.maxTokens}`,
      };
    }

    case 'search_lore': {
      const hits = searchLore(s.lorebook.entries, a.query ?? '').slice(0, 20);
      if (!hits.length) return { content: 'No matching lorebook entries.' };
      return { content: hits.map((e) => `id ${e.id} — ${e.displayName} [${e.keys.join(', ')}]${e.enabled ? '' : ' (disabled)'}\n${clip(e.text, 800)}`).join('\n\n'), summary: `${hits.length}` };
    }

    case 'critique': {
      const all = text();
      const r = a.chapter ? chapterRange(all, s.outline, a.chapter) : null;
      if (a.chapter && !r) return { content: `Chapter ${a.chapter} has no heading in the text yet.`, isError: true };
      const passage = r ? all.slice(r.from, r.to) : all.slice(-(a.tail ?? 6000));
      if (!passage.trim()) return { content: 'There is no text to critique yet.', isError: true };
      const req = buildCritiqueRequest(s, clip(passage, 20000), a.focus);
      const notes = (await generateText({ model: env.directorModel, ...req, maxTokens: 1500, params: { temperature: 0.4 } }, signal)).trim();
      return { content: notes || 'No notes.' };
    }

    case 'write_passage': {
      const before = text();
      const r = await useStory.getState().generatePassage({ directive: a.beat, maxLength: a.length });
      if (!r.text) return { content: r.error ? `The writer failed: ${r.error}` : r.aborted ? 'Stopped before anything was written.' : 'The writer returned nothing. Try a different beat.', isError: true };
      const notes: string[] = [];
      if (r.aborted) notes.push('(Stopped early; this is the partial passage.)');
      const rep = repetitionScore(r.text, before.slice(-20000));
      if (rep > 0.35) notes.push(`Warning: about ${Math.round(rep * 100)}% of this passage repeats earlier text. Change direction with the next beat, or rewrite it.`);
      return {
        content: `Wrote ${r.text.length} characters at ${r.from}:\n"""\n${clip(r.text, 4000)}\n"""${notes.length ? `\n${notes.join('\n')}` : ''}`,
        summary: r.text.trim().slice(0, 300),
        passage: true,
        chars: r.text.length,
        ...(r.node ? { historyNode: r.node, historyBefore: r.nodeBefore } : {}),
      };
    }

    case 'rewrite_range': {
      const all = text();
      const from = Math.max(0, Math.min(a.from, all.length));
      const to = Math.max(from, Math.min(a.to, all.length));
      const selection = all.slice(from, to);
      if (!selection.trim()) return { content: 'That range is empty.', isError: true };
      if (selection.length > 8000) return { content: 'That range is too long (over 8000 characters); rewrite it in parts.', isError: true };
      const model = useStory.getState().resolveModel();
      if (!model) return { content: 'No writing model is configured.', isError: true };
      return locked(async () => {
        const req = buildToolboxRequest(s, selection, 'custom', { instruction: a.instruction, before: all.slice(0, from), after: all.slice(to) });
        const out = (await generateText({ model, ...req, maxTokens: Math.ceil(selection.length / 2) + 800, params: { ...s.params, maxLength: selection.length * 2 } }, signal)).trim();
        if (!out) return { content: 'The writer returned nothing.', isError: true };
        if (text().slice(from, to) !== selection) return { content: 'The story changed while rewriting; read it again and retry.', isError: true };
        // Keep the whitespace around the passage as it was.
        const lead = /^\s*/.exec(selection)![0];
        const trail = /\s*$/.exec(selection)![0];
        const nodes = replaceText(from, to, lead + out + trail, 'ai');
        return { content: `Replaced characters ${from}–${to} with:\n"""\n${clip(out, 4000)}\n"""`, summary: out.slice(0, 300), chars: Math.max(0, out.length - selection.trim().length), ...nodes };
      });
    }

    case 'insert_text': {
      const all = text();
      const at = Math.max(0, Math.min(a.at ?? all.length, all.length));
      const value = String(a.text);
      if (!value) return { content: 'Nothing to insert.', isError: true };
      const nodes = replaceText(at, at, value, 'edit');
      return { content: `Inserted ${value.length} characters at ${at}.`, summary: value.slice(0, 200), chars: value.length, ...nodes };
    }

    case 'start_chapter': {
      const all = text();
      const outline = s.outline;
      const n = a.number ?? (outline ? outline.chapters.findIndex((c) => c.status === 'planned') + 1 || outline.chapters.length + 1 : (all.match(/^(?:Chapter \d+|第.{1,8}章)/gm)?.length ?? 0) + 1);
      const ch = outline?.chapters[n - 1];
      const title = ch?.title ?? a.title ?? '';
      const heading = chapterHeading(n, title, looksCjk(all || title || s.memory));
      const prefix = all && !all.endsWith('\n') ? '\n' : '';
      const sep = all.trim() ? '\n' : '';
      const nodes = replaceText(all.length, all.length, `${prefix}${sep}${heading}\n`, 'edit');
      let change: FieldChange | undefined;
      if (outline && ch && ch.status === 'planned') {
        change = setOutline({ ...outline, chapters: outline.chapters.map((c, i) => (i === n - 1 ? { ...c, status: 'drafting' } : c)) });
      }
      const beats = ch?.beats.length ? `\nBeats: ${ch.beats.join(' / ')}` : '';
      return { content: `Started chapter ${n}: "${heading}".${ch ? `\nSynopsis: ${ch.synopsis}${beats}` : ''}`, summary: heading, ...nodes, ...(change ? { change } : {}) };
    }

    case 'set_story_info': {
      const before = storyInfo(s);
      const after = { ...before, ...(a.title !== undefined ? { title: a.title } : {}), ...(a.genre !== undefined ? { genre: a.genre } : {}), ...(a.tags !== undefined ? { tags: a.tags } : {}), ...(a.description !== undefined ? { description: a.description } : {}) };
      useStory.getState().update((st) => {
        Object.assign(st, after);
        // The Genre & Tags prompt has been answered for the author.
        st.attgPrompted = true;
        if (after.title !== before.title && after.title) st.titleHistory = [after.title, ...st.titleHistory].slice(0, 50);
      });
      return { content: 'Story info updated.', summary: [after.title, after.genre, after.tags.join(', ')].filter(Boolean).join(' · '), change: { field: 'info', before, after } };
    }

    case 'update_memory':
      return { content: 'Memory updated.', summary: clip(a.text, 300), change: setField('memory', a.text) };

    case 'set_authors_note':
      return { content: "Author's note updated.", summary: clip(a.text, 300) || '(cleared)', change: setField('authorsNote', a.text) };

    case 'upsert_lore_entry': {
      const entries = s.lorebook.entries;
      const name = String(a.name).trim();
      const existing = (a.id ? entries.find((e) => e.id === a.id) : undefined) ?? entries.find((e) => e.displayName.trim().toLowerCase() === name.toLowerCase());
      if (a.id && !existing) return { content: `No lorebook entry with id ${a.id}. Leave out the id to create one.`, isError: true };
      let category = existing?.category ?? null;
      let categories = s.lorebook.categories;
      if (a.type && !existing?.category) {
        const [en, zh] = CATEGORY_NAMES[a.type] ?? [a.type, a.type];
        const label = looksCjk(text() || name || s.memory) ? zh : en;
        const found = categories.find((c) => c.name === label || c.name === en || c.name === zh);
        if (found) category = found.id;
        else {
          const c = newLoreCategory({ name: label });
          categories = [...categories, c];
          category = c.id;
        }
      }
      const given = a.keys as string[] | undefined;
      const keys: string[] = given?.length ? given : existing?.keys.length ? existing.keys : [name];
      const after: LoreEntry = existing
        ? { ...existing, displayName: name, text: a.text, keys, category, lastUpdatedAt: Date.now() }
        : newLoreEntry({ displayName: name, text: a.text, keys, category }, s.contextSettings.loreDefaults);
      useStory.getState().update((st) => {
        st.lorebook = { ...st.lorebook, categories, entries: existing ? st.lorebook.entries.map((e) => (e.id === after.id ? after : e)) : [...st.lorebook.entries, after] };
      });
      return {
        content: `${existing ? 'Updated' : 'Created'} lorebook entry "${name}" (id ${after.id}), keys: ${keys.join(', ')}.`,
        summary: `${existing ? '✎' : '+'} ${name}`,
        change: { field: 'lore', entryId: after.id, before: existing ?? null, after },
      };
    }

    case 'delete_lore_entry': {
      const entry = s.lorebook.entries.find((e) => e.id === a.id);
      if (!entry) return { content: `No lorebook entry with id ${a.id}.`, isError: true };
      useStory.getState().update((st) => void (st.lorebook = { ...st.lorebook, entries: st.lorebook.entries.filter((e) => e.id !== a.id) }));
      return { content: `Deleted "${entry.displayName}".`, summary: `− ${entry.displayName}`, change: { field: 'lore', entryId: entry.id, before: entry, after: null } };
    }

    case 'summarize': {
      const ctx = useStory.getState().previewContext();
      if (!ctx || ctx.storyStart <= 0) return { content: 'The whole story still fits in the writer\'s context; there is nothing to summarize yet.' };
      if (!s.summary?.enabled) useStory.getState().update((st) => void (st.summary = { enabled: true, text: st.summary?.text ?? '', upTo: st.summary?.upTo ?? 0 }));
      await updateSummary(useStory.getState, ctx.storyStart, true);
      const sum = story().summary?.text.trim();
      return { content: sum ? `Summary of the story up to character ${story().summary?.upTo}:\n${sum}` : 'The summary could not be updated.', isError: !sum, summary: clip(sum ?? '', 300) };
    }

    case 'update_outline': {
      const prev = s.outline;
      const chapters = (a.chapters as { title: string; synopsis: string; beats?: string[]; status?: ChapterStatus }[]).map((c, i) => ({
        id: prev?.chapters[i]?.id ?? uid(),
        title: c.title,
        synopsis: c.synopsis,
        beats: c.beats ?? [],
        status: c.status ?? prev?.chapters[i]?.status ?? 'planned',
      }));
      const change = setOutline({ premise: a.premise ?? prev?.premise ?? '', chapters });
      return { content: `Outline set: ${chapters.length} chapters.`, summary: chapters.map((c, i) => `${i + 1}. ${c.title}`).join('\n') || clip(a.premise ?? '', 300), change };
    }

    case 'set_chapter_status': {
      const outline = s.outline;
      if (!outline?.chapters[a.number - 1]) return { content: `There is no chapter ${a.number} in the outline.`, isError: true };
      const change = setOutline({ ...outline, chapters: outline.chapters.map((c, i) => (i === a.number - 1 ? { ...c, status: a.status } : c)) });
      return { content: `Chapter ${a.number} is now ${a.status}.`, summary: `${a.number}. ${outline.chapters[a.number - 1].title}: ${a.status}`, change };
    }
  }
  void run;
  return { content: `Tool "${call.name}" is not available here.`, isError: true };
}

/** A short description of what a confirm-level call would do, for the approval card. */
export function describeCall(call: DirectorToolCall): { before?: string; after?: string; text?: string } {
  const a = call.args as Record<string, never>;
  const s = useStory.getState().current;
  if (!s) return {};
  switch (call.name) {
    case 'write_passage':
      return { text: a.beat };
    case 'update_memory':
      return { before: s.memory, after: a.text };
    case 'set_authors_note':
      return { before: s.authorsNote, after: a.text };
    case 'upsert_lore_entry': {
      const e = (a.id ? s.lorebook.entries.find((x) => x.id === a.id) : undefined) ?? s.lorebook.entries.find((x) => x.displayName.toLowerCase() === String(a.name).toLowerCase());
      return { before: e ? `${e.displayName}\n${e.text}` : undefined, after: `${a.name}\n${a.text}` };
    }
    case 'delete_lore_entry': {
      const e = s.lorebook.entries.find((x) => x.id === a.id);
      return { before: e ? `${e.displayName}\n${e.text}` : a.id };
    }
    case 'rewrite_range': {
      const all = docText(s.doc);
      return { before: all.slice(a.from, a.to), text: a.instruction };
    }
    case 'insert_text':
      return { after: a.text };
    case 'update_outline':
      return {
        before: s.outline?.chapters.map((c, i) => `${i + 1}. ${c.title}`).join('\n'),
        after: [a.premise, ...(a.chapters as { title: string; synopsis: string }[]).map((c, i) => `${i + 1}. ${c.title} — ${c.synopsis}`)].filter(Boolean).join('\n'),
      };
    case 'set_story_info':
      return { before: [s.title, s.genre, s.tags.join(', ')].filter(Boolean).join(' · '), after: [a.title, a.genre, (a.tags as string[] | undefined)?.join(', ')].filter(Boolean).join(' · ') };
    case 'start_chapter':
      return { text: a.title ?? (a.number ? `#${a.number}` : '') };
  }
  return { text: JSON.stringify(a) };
}
