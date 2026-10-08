import { docText, plainDoc } from './doc.ts';
import { biasGroup, contextConfig, emptyLorebook, migrateStory, newLoreCategory, newLoreEntry, newStory } from './defaults.ts';
import { flatten } from './history.ts';
import { uid } from './util.ts';
import type { ContextConfig, LoreCategory, LoreEntry, Lorebook, PhraseBiasGroup, Placeholder, Story } from './types.ts';

// ---------------------------------------------------------------- story files

export interface StoryFile {
  format: 'novelwriter-story';
  version: number;
  story: Story;
}

export function exportStoryFile(story: Story): string {
  const f: StoryFile = { format: 'novelwriter-story', version: 1, story };
  return JSON.stringify(f);
}

export interface ScenarioFile {
  format: 'novelwriter-scenario';
  version: number;
  title: string;
  description: string;
  author: string;
  tags: string[];
  mode: Story['mode'];
  prompt: string;
  memory: string;
  authorsNote: string;
  lorebook: Lorebook;
  contextSettings: Story['contextSettings'];
  ephemeral: Story['ephemeral'];
  placeholders: Placeholder[];
  params: Story['params'];
  presetId: string;
  systemPrompt: string;
  phraseBias: PhraseBiasGroup[];
  bannedTokens: string[];
  stopSequences: string[];
}

export function exportScenario(story: Story, extra: Partial<ScenarioFile> = {}): string {
  const f: ScenarioFile = {
    format: 'novelwriter-scenario',
    version: 1,
    title: story.title,
    description: story.description,
    author: story.author,
    tags: story.tags,
    mode: story.mode,
    prompt: docText(story.doc),
    memory: story.memory,
    authorsNote: story.authorsNote,
    lorebook: story.lorebook,
    contextSettings: story.contextSettings,
    ephemeral: story.ephemeral,
    placeholders: story.placeholders,
    params: story.params,
    presetId: story.presetId,
    systemPrompt: story.systemPrompt,
    phraseBias: story.phraseBias,
    bannedTokens: story.bannedTokens,
    stopSequences: story.stopSequences,
    ...extra,
  };
  return JSON.stringify(f, null, 2);
}

export function scenarioToStory(f: Partial<ScenarioFile>): Story {
  const doc = plainDoc(f.prompt ?? '', 'prompt');
  return migrateStory({
    ...newStory({ mode: f.mode ?? 'storyteller' }),
    title: f.title ?? 'Imported Scenario',
    description: f.description ?? '',
    author: f.author ?? '',
    tags: f.tags ?? [],
    doc,
    history: flatten(doc),
    memory: f.memory ?? '',
    authorsNote: f.authorsNote ?? '',
    lorebook: f.lorebook ?? emptyLorebook(),
    contextSettings: f.contextSettings,
    ephemeral: f.ephemeral ?? [],
    placeholders: f.placeholders ?? [],
    params: f.params,
    presetId: f.presetId ?? 'default',
    systemPrompt: f.systemPrompt ?? '',
    phraseBias: f.phraseBias ?? [biasGroup()],
    bannedTokens: f.bannedTokens ?? [],
    stopSequences: f.stopSequences ?? [],
  } as Partial<Story>);
}

/** Plain text export. */
export function exportPlaintext(story: Story): string {
  return docText(story.doc);
}

export type ImportResult =
  | { kind: 'story'; story: Story; needsPlaceholders: boolean }
  | { kind: 'lorebook'; lorebook: Lorebook }
  | { kind: 'bias'; groups: PhraseBiasGroup[] }
  | { kind: 'preset'; preset: { name: string; params: Story['params'] } }
  | { kind: 'theme'; theme: unknown };

/** Import any supported file. `name` is used to guess the type for plain text. */
export function importFile(name: string, content: string | Uint8Array): ImportResult {
  if (content instanceof Uint8Array) {
    const lb = readPngLorebook(content);
    if (lb) return { kind: 'lorebook', lorebook: lb };
    throw new Error('Image does not contain an embedded lorebook.');
  }
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    const doc = plainDoc(content, 'prompt');
    const title = name.replace(/\.[^.]+$/, '') || 'Imported Story';
    return { kind: 'story', story: newStory({ title, doc, history: flatten(doc) }), needsPlaceholders: false };
  }
  const data = JSON.parse(trimmed) as Record<string, unknown>;
  if (Array.isArray(data)) return { kind: 'bias', groups: data.map(importBiasGroup) };
  if (data.format === 'novelwriter-story') {
    const s = migrateStory({ ...(data.story as Story), id: uid() });
    return { kind: 'story', story: s, needsPlaceholders: false };
  }
  if (data.format === 'novelwriter-scenario') {
    const s = scenarioToStory(data as Partial<ScenarioFile>);
    return { kind: 'story', story: s, needsPlaceholders: s.placeholders.length > 0 || /\$\{/.test(docText(s.doc) + s.memory + s.authorsNote) };
  }
  if ('lorebookVersion' in data || ('entries' in data && Array.isArray(data.entries))) {
    return { kind: 'lorebook', lorebook: importLorebook(data) };
  }
  if ('scenarioVersion' in data) {
    const s = importNovelAIScenario(data);
    return { kind: 'story', story: s, needsPlaceholders: s.placeholders.length > 0 };
  }
  if ('storyContainerVersion' in data) return { kind: 'story', story: importNovelAIStory(data), needsPlaceholders: false };
  if ('presetVersion' in data || 'parameters' in data) {
    return { kind: 'preset', preset: { name: String(data.name ?? 'Imported Preset'), params: importParams(data.parameters as Record<string, unknown>) } };
  }
  if ('colors' in data && 'fonts' in data) return { kind: 'theme', theme: data };
  throw new Error('Unrecognized file format.');
}

// ---------------------------------------------------------------- lorebooks

function importContextConfig(raw: unknown, fallback: ContextConfig): ContextConfig {
  const r = (raw ?? {}) as Partial<ContextConfig> & { trimDirection?: string };
  return contextConfig({ ...fallback, ...r });
}

function phraseText(p: unknown): string | null {
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object') {
    const o = p as Record<string, unknown>;
    if (typeof o.sequence === 'string') return o.sequence;
    if (typeof o.text === 'string') return o.text;
  }
  return null;
}

export function importBiasGroup(raw: unknown): PhraseBiasGroup {
  const r = (raw ?? {}) as Record<string, unknown>;
  const phrases = Array.isArray(r.phrases) ? (r.phrases.map(phraseText).filter(Boolean) as string[]) : [];
  return biasGroup({
    phrases,
    bias: Number(r.bias ?? 0),
    ensureSequenceFinish: Boolean(r.ensureSequenceFinish ?? r.ensure_sequence_finish ?? false),
    generateOnce: Boolean(r.generateOnce ?? r.generate_once ?? true),
    enabled: r.enabled === undefined ? true : Boolean(r.enabled),
    whenInactive: Boolean(r.whenInactive ?? false),
  });
}

export function exportBiasGroups(groups: PhraseBiasGroup[]): string {
  return JSON.stringify(
    groups.map((g) => ({ ...g, phrases: g.phrases.map((p) => ({ sequence: p, type: 'text' })) })),
    null,
    2,
  );
}

export function importLorebook(raw: Record<string, unknown>): Lorebook {
  const defaults = newLoreEntry().contextConfig;
  const catsRaw = Array.isArray(raw.categories) ? (raw.categories as Record<string, unknown>[]) : [];
  const categories: LoreCategory[] = catsRaw.map((c) => {
    const sub = (c.subcontextSettings ?? {}) as { contextConfig?: unknown };
    return newLoreCategory({
      id: String(c.id ?? uid()),
      name: String(c.name ?? 'Category'),
      enabled: c.enabled === undefined ? true : Boolean(c.enabled),
      createSubcontext: Boolean(c.createSubcontext),
      subcontextSettings: importContextConfig(sub.contextConfig ?? sub, contextConfig()),
      useCategoryDefaults: Boolean(c.useCategoryDefaults),
      categoryDefaults: (c.categoryDefaults ?? {}) as Partial<LoreEntry>,
      categoryBiasGroups: Array.isArray(c.categoryBiasGroups) ? c.categoryBiasGroups.map(importBiasGroup) : [biasGroup()],
      entryHeader: String(c.entryHeader ?? ''),
    });
  });
  const entriesRaw = Array.isArray(raw.entries) ? (raw.entries as Record<string, unknown>[]) : [];
  const entries: LoreEntry[] = entriesRaw.map((e) =>
    newLoreEntry({
      id: String(e.id ?? uid()),
      displayName: String(e.displayName ?? (Array.isArray(e.keys) && e.keys[0]) ?? 'Entry'),
      text: String(e.text ?? ''),
      keys: Array.isArray(e.keys) ? e.keys.map(String) : [],
      enabled: e.enabled === undefined ? true : Boolean(e.enabled),
      forceActivation: Boolean(e.forceActivation),
      hidden: Boolean(e.hidden),
      searchRange: Number(e.searchRange ?? 1000),
      keyRelative: Boolean(e.keyRelative),
      nonStoryActivatable: Boolean(e.nonStoryActivatable),
      category: e.category ? String(e.category) : null,
      contextConfig: importContextConfig(e.contextConfig, defaults),
      loreBiasGroups: Array.isArray(e.loreBiasGroups) ? e.loreBiasGroups.map(importBiasGroup) : [biasGroup()],
      conditions: Array.isArray(e.conditions) ? (e.conditions as LoreEntry['conditions']) : [],
      lastUpdatedAt: Number(e.lastUpdatedAt ?? Date.now()),
    }),
  );
  const settings = (raw.settings ?? {}) as Lorebook['settings'];
  return { entries, categories, settings: { orderByKeyLocations: Boolean(settings.orderByKeyLocations) } };
}

/** Export in the NovelAI lorebook JSON layout (lorebookVersion 5). */
export function exportLorebook(lb: Lorebook): string {
  return JSON.stringify(
    {
      lorebookVersion: 5,
      entries: lb.entries.map((e) => ({
        ...e,
        loreBiasGroups: e.loreBiasGroups.map((g) => ({ ...g, phrases: g.phrases.map((p) => ({ sequence: p, type: 'text' })) })),
      })),
      settings: lb.settings,
      categories: lb.categories.map((c) => ({ ...c, subcontextSettings: { text: '', contextConfig: c.subcontextSettings } })),
    },
    null,
    2,
  );
}

/** Merge an imported lorebook into an existing one, re-keying colliding ids. */
export function mergeLorebook(into: Lorebook, add: Lorebook): Lorebook {
  const ids = new Set(into.entries.map((e) => e.id));
  const catIds = new Set(into.categories.map((c) => c.id));
  const catMap = new Map<string, string>();
  const categories = [...into.categories];
  for (const c of add.categories) {
    const id = catIds.has(c.id) ? uid() : c.id;
    catMap.set(c.id, id);
    categories.push({ ...c, id });
  }
  const entries = [...into.entries];
  for (const e of add.entries) {
    entries.push({ ...e, id: ids.has(e.id) ? uid() : e.id, category: e.category ? (catMap.get(e.category) ?? e.category) : null });
  }
  return { ...into, entries, categories };
}

// ---------------------------------------------------------------- NovelAI story / scenario

function importParams(raw: Record<string, unknown> | undefined): Story['params'] {
  const base = newStory().params;
  if (!raw) return base;
  const n = (k: string, d: number) => (typeof raw[k] === 'number' ? (raw[k] as number) : d);
  return {
    ...base,
    temperature: n('temperature', base.temperature),
    maxLength: n('max_length', base.maxLength / 4) * 4,
    minLength: n('min_length', base.minLength),
    topK: n('top_k', base.topK),
    topP: n('top_p', base.topP),
    topA: n('top_a', base.topA),
    minP: n('min_p', base.minP),
    typicalP: n('typical_p', base.typicalP),
    tailFreeSampling: n('tail_free_sampling', base.tailFreeSampling),
    repetitionPenalty: n('repetition_penalty', base.repetitionPenalty),
    repetitionPenaltyRange: n('repetition_penalty_range', base.repetitionPenaltyRange),
    repetitionPenaltySlope: n('repetition_penalty_slope', base.repetitionPenaltySlope),
    repetitionPenaltyFrequency: n('repetition_penalty_frequency', base.repetitionPenaltyFrequency),
    repetitionPenaltyPresence: n('repetition_penalty_presence', base.repetitionPenaltyPresence),
    mirostatTau: n('mirostat_tau', base.mirostatTau),
    mirostatLr: n('mirostat_lr', base.mirostatLr),
  };
}

function importNovelAIScenario(d: Record<string, unknown>): Story {
  const ctx = Array.isArray(d.context) ? (d.context as { text?: string; contextConfig?: unknown }[]) : [];
  const settings = (d.settings ?? {}) as { parameters?: Record<string, unknown> };
  const prompt = String(d.prompt ?? '');
  const doc = plainDoc(prompt, 'prompt');
  const s = newStory({
    title: String(d.title ?? 'Imported Scenario'),
    description: String(d.description ?? ''),
    author: String(d.author ?? ''),
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    doc,
    history: flatten(doc),
    memory: ctx[0]?.text ?? '',
    authorsNote: ctx[1]?.text ?? '',
    lorebook: d.lorebook ? importLorebook(d.lorebook as Record<string, unknown>) : emptyLorebook(),
    params: importParams(settings.parameters),
    placeholders: Array.isArray(d.placeholders)
      ? (d.placeholders as Record<string, string>[]).map((p) => ({ key: p.key, defaultValue: p.defaultValue ?? '', description: p.description ?? '', longDescription: p.longDescription }))
      : [],
  });
  if (ctx[0]?.contextConfig) s.contextSettings.memory = importContextConfig(ctx[0].contextConfig, s.contextSettings.memory);
  if (ctx[1]?.contextConfig) s.contextSettings.authorsNote = importContextConfig(ctx[1].contextConfig, s.contextSettings.authorsNote);
  return s;
}

/** Best-effort import of legacy NovelAI .story files with plaintext fragments. */
function importNovelAIStory(d: Record<string, unknown>): Story {
  const meta = (d.metadata ?? {}) as Record<string, unknown>;
  const content = (d.content ?? {}) as Record<string, unknown>;
  const storyRaw = (content.story ?? {}) as { fragments?: { data: string; origin: string }[] };
  const doc = (storyRaw.fragments ?? []).map((f) => ({
    text: f.data,
    origin: (f.origin === 'ai' ? 'ai' : f.origin === 'edit' ? 'edit' : f.origin === 'prompt' ? 'prompt' : 'user') as Story['doc'][number]['origin'],
  }));
  const ctx = Array.isArray(content.context) ? (content.context as { text?: string }[]) : [];
  return newStory({
    title: String(meta.title ?? 'Imported Story'),
    description: String(meta.description ?? ''),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    doc,
    history: flatten(doc),
    memory: ctx[0]?.text ?? '',
    authorsNote: ctx[1]?.text ?? '',
    lorebook: content.lorebook ? importLorebook(content.lorebook as Record<string, unknown>) : emptyLorebook(),
  });
}

// ---------------------------------------------------------------- PNG embedding

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function isPng(b: Uint8Array): boolean {
  return PNG_SIG.every((v, i) => b[i] === v);
}

/** Read `tEXt` chunks from a PNG. */
export function readPngText(png: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isPng(png)) return out;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p + 8 <= png.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    if (type === 'tEXt') {
      const data = png.subarray(p + 8, p + 8 + len);
      const nul = data.indexOf(0);
      const key = new TextDecoder('latin1').decode(data.subarray(0, nul));
      out[key] = new TextDecoder('latin1').decode(data.subarray(nul + 1));
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return out;
}

/** Insert a `tEXt` chunk before IEND. */
export function writePngText(png: Uint8Array, key: string, value: string): Uint8Array {
  if (!isPng(png)) throw new Error('Not a PNG file.');
  const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
  const data = new Uint8Array([...enc(key), 0, ...enc(value)]);
  const typeAndData = new Uint8Array([...enc('tEXt'), ...data]);
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk.set(typeAndData, 4);
  dv.setUint32(8 + data.length, crc32(typeAndData));
  // Find IEND
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p + 8 <= png.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, p), 0);
  out.set(chunk, p);
  out.set(png.subarray(p), p + chunk.length);
  return out;
}

export function readPngLorebook(png: Uint8Array): Lorebook | null {
  const t = readPngText(png);
  const raw = t.naidata;
  if (!raw) return null;
  try {
    return importLorebook(JSON.parse(fromBase64(raw)) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function embedPngLorebook(png: Uint8Array, lb: Lorebook): Uint8Array {
  return writePngText(png, 'naidata', toBase64(exportLorebook(lb)));
}
