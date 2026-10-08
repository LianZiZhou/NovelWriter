// Stories and settings from other tools: NovelAI scenario extras, KoboldAI, AI Dungeon, NovelAI .module and
// .badwords files. NovelAI `.story` documents are handled in novelai.ts.
import { plainDoc } from './doc.ts';
import { contextConfig, defaultContextSettings, emptyLorebook, newLoreEntry, newStory } from './defaults.ts';
import { flatten } from './history.ts';
import { uid } from './util.ts';
import type { ContextConfig, EphemeralEntry, LoreEntry, Lorebook, PhraseBiasGroup, Span, Story } from './types.ts';

// ---------------------------------------------------------------- NovelAI story / scenario extras

function naiContextConfig(raw: unknown, fallback: ContextConfig): ContextConfig {
  return contextConfig({ ...fallback, ...((raw ?? {}) as Partial<ContextConfig>) });
}

/** NovelAI `bannedSequenceGroups` / `.badwords`: groups of `{ sequences: [{ sequence }] , enabled }`. */
export function bannedSequences(raw: unknown): string[] {
  const groups = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const out: string[] = [];
  for (const g of groups as Record<string, unknown>[]) {
    if (typeof g === 'string') {
      out.push(g);
      continue;
    }
    if (g?.enabled === false) continue;
    const seqs = Array.isArray(g?.sequences) ? g.sequences : Array.isArray(g?.phrases) ? g.phrases : [];
    for (const s of seqs as unknown[]) {
      const text = typeof s === 'string' ? s : typeof (s as { sequence?: unknown })?.sequence === 'string' ? (s as { sequence: string }).sequence : null;
      if (text) out.push(text);
    }
  }
  return [...new Set(out)];
}

/** NovelAI ephemeral context entries. */
export function naiEphemeral(raw: unknown): EphemeralEntry[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((e) => {
    const cfg = (e.contextConfig ?? {}) as { insertionPosition?: number };
    return {
      id: uid(),
      text: String(e.text ?? ''),
      startingStep: Number(e.startingStep ?? 0),
      delay: Number(e.delay ?? 0),
      duration: Number(e.duration ?? 1),
      repeat: Boolean(e.repeat),
      position: Number(cfg.insertionPosition ?? -1),
    };
  });
}

/** Story-level settings shared by NovelAI `.scenario` files and `.story` content. */
export function applyNovelAIExtras(s: Story, d: Record<string, unknown>, importBias: (g: unknown) => PhraseBiasGroup): void {
  if (Array.isArray(d.phraseBiasGroups)) {
    const groups = d.phraseBiasGroups.map(importBias).filter((g) => g.phrases.length);
    if (groups.length) s.phraseBias = groups;
  }
  if (d.bannedSequenceGroups) s.bannedTokens = bannedSequences(d.bannedSequenceGroups);
  if (d.ephemeralContext) s.ephemeral = naiEphemeral(d.ephemeralContext);
  const settings = (d.settings ?? {}) as Record<string, unknown>;
  if (typeof settings.banBrackets === 'boolean') s.banBrackets = settings.banBrackets;
  const story = (d.storyContextConfig ?? null) as unknown;
  if (story) s.contextSettings.story = naiContextConfig(story, s.contextSettings.story);
  const defaults = (d.contextDefaults ?? {}) as { loreDefaults?: unknown };
  if (defaults.loreDefaults) {
    const lore = (defaults.loreDefaults as { contextConfig?: unknown }).contextConfig ?? defaults.loreDefaults;
    s.contextSettings.loreDefaults = naiContextConfig(lore, s.contextSettings.loreDefaults ?? defaultContextSettings().loreDefaults);
  }
}

// ---------------------------------------------------------------- KoboldAI and AI Dungeon

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const keyList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : str(v).split(',')).map((k) => k.trim()).filter(Boolean);

function lore(entries: { name?: string; text: string; keys: string[]; constant?: boolean }[]): Lorebook {
  return {
    ...emptyLorebook(),
    entries: entries.filter((e) => e.text || e.keys.length).map((e): LoreEntry => newLoreEntry({ displayName: e.name || e.keys[0] || 'Entry', text: e.text, keys: e.keys, forceActivation: !!e.constant })),
  };
}

function storyFrom(p: { title: string; description?: string; prompt: string; actions: { text: string; ai: boolean }[]; memory?: string; authorsNote?: string; lorebook?: Lorebook; mode?: Story['mode'] }): Story {
  const doc: Span[] = plainDoc(p.prompt, 'prompt');
  for (const a of p.actions) if (a.text) doc.push({ text: a.text, origin: a.ai ? 'ai' : 'user' });
  return newStory({
    title: p.title || 'Imported Story',
    description: p.description ?? '',
    mode: p.mode ?? 'storyteller',
    doc,
    history: flatten(doc),
    memory: p.memory ?? '',
    authorsNote: p.authorsNote ?? '',
    lorebook: p.lorebook ?? emptyLorebook(),
  });
}

/** KoboldAI / KoboldAI United save (`gamestarted`, `prompt`, `actions`, `worldinfo`). */
export function isKoboldSave(d: Record<string, unknown>): boolean {
  return 'gamestarted' in d || ('prompt' in d && 'actions' in d && ('authorsnote' in d || 'worldinfo' in d || 'worldinfo_v2' in d));
}

export function importKoboldSave(d: Record<string, unknown>, name: string): Story {
  // Old saves: actions is a list of strings. United: { actions: { "0": { "Selected Text": … } } } or a plain object.
  let actions: string[] = [];
  const raw = d.actions as unknown;
  if (Array.isArray(raw)) actions = raw.map(str);
  else if (raw && typeof raw === 'object') {
    const inner = ((raw as Record<string, unknown>).actions ?? raw) as Record<string, unknown>;
    actions = Object.keys(inner)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => {
        const a = inner[k];
        return typeof a === 'string' ? a : str((a as Record<string, unknown>)?.['Selected Text']);
      });
  }
  const wiRaw = (d.worldinfo_v2 as { entries?: Record<string, unknown> } | undefined)?.entries ?? d.worldinfo;
  const wi = (Array.isArray(wiRaw) ? wiRaw : wiRaw && typeof wiRaw === 'object' ? Object.values(wiRaw) : []) as Record<string, unknown>[];
  // KoboldAI actions are mostly AI output; the user's own inputs aren't marked, so everything after the prompt counts as AI.
  return storyFrom({
    title: name.replace(/\.[^.]+$/, ''),
    prompt: str(d.prompt),
    actions: actions.map((text) => ({ text, ai: true })),
    memory: str(d.memory),
    authorsNote: str(d.authorsnote),
    lorebook: lore(wi.map((w) => ({ name: str(w.comment || w.title), text: str(w.content), keys: keyList(w.key), constant: Boolean(w.constant) }))),
  });
}

/** AI Dungeon adventure or scenario export. */
export function isAIDungeon(d: Record<string, unknown>): boolean {
  return 'storyCards' in d || (Array.isArray(d.actions) && (d.actions as unknown[]).some((a) => a && typeof a === 'object' && 'text' in (a as object))) || ('prompt' in d && 'memory' in d && 'authorsNote' in d && !('scenarioVersion' in d) && !('format' in d));
}

export function importAIDungeon(d: Record<string, unknown>): Story {
  const actions = (Array.isArray(d.actions) ? d.actions : []) as Record<string, unknown>[];
  const cards = (Array.isArray(d.storyCards) ? d.storyCards : Array.isArray(d.worldInfo) ? d.worldInfo : []) as Record<string, unknown>[];
  const adventure = actions.some((a) => ['do', 'say'].includes(str(a.type)));
  return storyFrom({
    title: str(d.title),
    description: str(d.description),
    prompt: str(d.prompt),
    // Action texts carry their own line breaks and "> You" prefixes; player inputs are do/say/story/see.
    actions: actions.map((a) => ({ text: str(a.text), ai: !['do', 'say', 'story', 'see', 'start'].includes(str(a.type)) })),
    memory: str(d.memory),
    authorsNote: str(d.authorsNote),
    lorebook: lore(cards.map((c) => ({ name: str(c.title ?? c.name), text: str(c.value ?? c.entry), keys: keyList(c.keys) }))),
    mode: adventure ? 'adventure' : 'storyteller',
  });
}

// ---------------------------------------------------------------- modules

/** A NovelAI AI module (`.module`): trained weights we can't run; its name and description become a style note. */
export function isNovelAIModule(d: Record<string, unknown>, name: string): boolean {
  return /\.module$/i.test(name) || ('data' in d && 'name' in d && ('prefix' in d || 'modelVersion' in d || 'mode' in d) && !('entries' in d));
}

export function moduleNote(d: Record<string, unknown>): string {
  const name = str(d.name).trim() || 'Module';
  const desc = str(d.description).trim();
  return `[ Style: ${name}${desc ? ` — ${desc.replace(/\s+/g, ' ')}` : ''} ]`;
}

