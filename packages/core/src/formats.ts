import { docText, plainDoc } from './doc.ts';
import { biasGroup, contextConfig, emptyLorebook, migrateStory, newLoreCategory, newLoreEntry, newStory } from './defaults.ts';
import { flatten } from './history.ts';
import { uid } from './util.ts';
import { applyNovelAIExtras, bannedSequences, importAIDungeon, importKoboldSave, isAIDungeon, isKoboldSave, isNovelAIModule, moduleNote, novelAIDocumentText } from './foreign.ts';
import type { ContextConfig, GenerationParams, LoreCategory, LoreEntry, Lorebook, PhraseBiasGroup, Placeholder, SamplerId, Story } from './types.ts';

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
  | { kind: 'theme'; theme: unknown }
  /** Banned token sequences (`.badwords`). */
  | { kind: 'banned'; phrases: string[] }
  /** A NovelAI AI module: can't run here; imported as a style note for the Author's Note. */
  | { kind: 'module'; name: string; note: string };

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
  if (/\.badwords$/i.test(name) || (!Array.isArray(data) && 'bannedSequenceGroups' in data && !('content' in data) && !('scenarioVersion' in data))) {
    return { kind: 'banned', phrases: bannedSequences((data as { bannedSequenceGroups?: unknown }).bannedSequenceGroups ?? data) };
  }
  if (!Array.isArray(data) && isNovelAIModule(data, name)) return { kind: 'module', name: String(data.name ?? 'Module'), note: moduleNote(data) };
  if (!Array.isArray(data) && isKoboldSave(data)) return { kind: 'story', story: importKoboldSave(data, name), needsPlaceholders: false };
  const foreign = importForeignLorebook(data);
  if (foreign) return { kind: 'lorebook', lorebook: foreign };
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
  if ('presetVersion' in data || 'parameters' in data || ('temperature' in data && 'max_length' in data)) {
    return { kind: 'preset', preset: importPreset(data, name.replace(/\.[^.]+$/, '') || 'Imported Preset') };
  }
  if ('colors' in data && 'fonts' in data) return { kind: 'theme', theme: data };
  if (isAIDungeon(data)) return { kind: 'story', story: importAIDungeon(data), needsPlaceholders: false };
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
    if (typeof o.phrase === 'string') return o.phrase;
  }
  return null;
}

export function importBiasGroup(raw: unknown): PhraseBiasGroup {
  const r = (raw ?? {}) as Record<string, unknown>;
  // NovelAI groups list `phrases`; single-phrase formats (HoloAI and others) put the phrase on the item itself.
  const phrases = Array.isArray(r.phrases) ? (r.phrases.map(phraseText).filter(Boolean) as string[]) : [phraseText(r)].filter((x): x is string => !!x);
  return biasGroup({
    phrases,
    bias: Number(r.bias ?? r.value ?? r.strength ?? 0),
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

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strList = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(str) : typeof v === 'string' ? v.split(',') : []).map((k) => k.trim()).filter(Boolean);

function foreignEntry(p: { name: string; text: string; keys: string[]; enabled?: boolean; constant?: boolean; order?: number }): LoreEntry {
  const e = newLoreEntry({ displayName: p.name || p.keys[0] || 'Entry', text: p.text, keys: p.keys, enabled: p.enabled ?? true, forceActivation: !!p.constant });
  // Higher order/priority goes in earlier, like NovelAI's budget priority.
  if (p.order !== undefined && Number.isFinite(p.order)) e.contextConfig = { ...e.contextConfig, budgetPriority: Math.round(p.order) };
  return e;
}

/**
 * Lorebooks from other tools: SillyTavern World Info (and character-card `character_book`), Agnai memory books and
 * AI Dungeon World Info exports. Returns null for anything else.
 */
export function importForeignLorebook(data: unknown): Lorebook | null {
  const lb = (entries: LoreEntry[]): Lorebook => ({ ...emptyLorebook(), entries });
  // AI Dungeon: a bare array (or { worldInfo: [...] }) of { keys: "a, b", entry | value }.
  const aid = Array.isArray(data) ? data : Array.isArray((data as { worldInfo?: unknown })?.worldInfo) ? (data as { worldInfo: unknown[] }).worldInfo : null;
  if (aid) {
    const items = aid as Record<string, unknown>[];
    if (!items.length || !items.every((x) => x && typeof x === 'object' && 'keys' in x && ('entry' in x || 'value' in x))) return null;
    return lb(items.map((x) => foreignEntry({ name: str(x.name ?? x.title), text: str(x.entry ?? x.value), keys: strList(x.keys) })));
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  // Character cards carry their lorebook in data.character_book.
  const card = (d.data as Record<string, unknown> | undefined)?.character_book ?? d.character_book;
  if (card && typeof card === 'object') return importForeignLorebook(card);
  // Agnai memory book.
  if (d.kind === 'memory' && Array.isArray(d.entries)) {
    return lb(
      (d.entries as Record<string, unknown>[]).map((x) =>
        foreignEntry({ name: str(x.name), text: str(x.entry), keys: strList(x.keywords), enabled: x.enabled === undefined ? true : Boolean(x.enabled), order: Number(x.priority ?? NaN) }),
      ),
    );
  }
  // SillyTavern World Info: entries is an object keyed by uid. Character-book (V2 spec): an array with keys/content.
  const stEntries = d.entries && !Array.isArray(d.entries) && typeof d.entries === 'object' ? Object.values(d.entries as Record<string, unknown>) : Array.isArray(d.entries) && (d.entries as Record<string, unknown>[]).every((x) => x && 'content' in x) ? (d.entries as unknown[]) : null;
  if (stEntries) {
    return lb(
      (stEntries as Record<string, unknown>[]).map((x) => {
        const e = foreignEntry({
          name: str(x.comment || x.name),
          text: str(x.content),
          keys: strList(x.key ?? x.keys),
          enabled: x.disable !== undefined ? !x.disable : x.enabled === undefined ? true : Boolean(x.enabled),
          constant: Boolean(x.constant),
          order: Number(x.order ?? x.insertion_order ?? NaN),
        });
        // Secondary keys with "AND ANY" logic map onto NovelAI's A & B keys.
        const secondary = strList(x.keysecondary ?? x.secondary_keys);
        if ((x.selective ?? false) && secondary.length) e.keys = e.keys.flatMap((k) => secondary.map((s) => `${k} & ${s}`));
        if (typeof x.scanDepth === 'number' && x.scanDepth > 0) e.searchRange = Math.min(50000, x.scanDepth * 400);
        return e;
      }),
    );
  }
  return null;
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

const NAI_ORDER: Record<string, SamplerId> = { temperature: 'temperature', top_k: 'top_k', top_p: 'top_p', tfs: 'tfs', top_a: 'top_a', typical_p: 'typical_p', mirostat: 'mirostat', math1: 'unified', min_p: 'min_p' };
const NAI_ORDER_IDS: Record<number, SamplerId> = { 0: 'temperature', 1: 'top_k', 2: 'top_p', 3: 'tfs', 4: 'top_a', 5: 'typical_p', 8: 'mirostat', 9: 'unified', 10: 'min_p' };
const PHRASE_REP_PEN = ['off', 'very_light', 'light', 'medium', 'aggressive', 'very_aggressive'] as const;

/** NovelAI generation parameters (`textGenerationSettingsVersion` 3-5) to ours. */
export function importParams(raw: Record<string, unknown> | undefined): Story['params'] {
  const base = newStory().params;
  if (!raw) return base;
  const n = (k: string, d: number) => (typeof raw[k] === 'number' ? (raw[k] as number) : d);
  const out: GenerationParams = {
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
    repetitionPenaltyWhitelist: typeof raw.repetition_penalty_default_whitelist === 'boolean' ? raw.repetition_penalty_default_whitelist : base.repetitionPenaltyWhitelist,
    mirostatTau: n('mirostat_tau', base.mirostatTau),
    mirostatLr: n('mirostat_lr', base.mirostatLr),
    unifiedLinear: n('math1_temp', base.unifiedLinear),
    unifiedQuad: n('math1_quad', base.unifiedQuad),
    unifiedConf: n('math1_quad_entropy_scale', base.unifiedConf),
  };
  if (typeof raw.phrase_rep_pen === 'string' && (PHRASE_REP_PEN as readonly string[]).includes(raw.phrase_rep_pen)) out.phraseRepPen = raw.phrase_rep_pen as GenerationParams['phraseRepPen'];
  if (Array.isArray(raw.order)) {
    // Either [{id, enabled}] (v3+) or plain numeric ids (older presets: listed ones are enabled).
    const listed: { id: SamplerId; enabled: boolean }[] = [];
    for (const o of raw.order as unknown[]) {
      const id = typeof o === 'number' ? NAI_ORDER_IDS[o] : typeof o === 'object' && o ? NAI_ORDER[String((o as { id?: unknown }).id)] : undefined;
      if (id && !listed.some((x) => x.id === id)) listed.push({ id, enabled: typeof o === 'number' ? true : (o as { enabled?: boolean }).enabled !== false });
    }
    if (listed.length) out.order = [...listed, ...base.order.filter((b) => !listed.some((x) => x.id === b.id)).map((b) => ({ ...b, enabled: false }))];
  }
  return out;
}

/** Export in NovelAI's preset layout, plus our own fields under `novelwriter` (context size, dynamic range). */
export function exportPreset(name: string, p: GenerationParams): string {
  const inv = Object.fromEntries(Object.entries(NAI_ORDER).map(([k, v]) => [v, k]));
  return JSON.stringify(
    {
      presetVersion: 3,
      name,
      id: uid(),
      parameters: {
        textGenerationSettingsVersion: 5,
        temperature: p.temperature,
        max_length: Math.round(p.maxLength / 4),
        min_length: p.minLength,
        top_k: p.topK,
        top_p: p.topP,
        top_a: p.topA,
        typical_p: p.typicalP,
        tail_free_sampling: p.tailFreeSampling,
        repetition_penalty: p.repetitionPenalty,
        repetition_penalty_range: p.repetitionPenaltyRange,
        repetition_penalty_slope: p.repetitionPenaltySlope,
        repetition_penalty_frequency: p.repetitionPenaltyFrequency,
        repetition_penalty_presence: p.repetitionPenaltyPresence,
        repetition_penalty_default_whitelist: p.repetitionPenaltyWhitelist,
        phrase_rep_pen: p.phraseRepPen,
        mirostat_tau: p.mirostatTau,
        mirostat_lr: p.mirostatLr,
        math1_temp: p.unifiedLinear,
        math1_quad: p.unifiedQuad,
        math1_quad_entropy_scale: p.unifiedConf,
        min_p: p.minP,
        order: p.order.map((o) => ({ id: inv[o.id], enabled: o.enabled })),
      },
      novelwriter: { maxContext: p.maxContext, dynamicPenaltyRange: p.dynamicPenaltyRange },
    },
    null,
    2,
  );
}

/** Read a preset: ours (old `novelwriter` params), NovelAI `.preset`, or `.gensettings` / `.generationset`. */
export function importPreset(raw: unknown, fallbackName = 'Imported Preset'): { name: string; params: GenerationParams } {
  const d = (raw ?? {}) as Record<string, unknown>;
  const name = String(d.name ?? fallbackName);
  // Our own pre-release export: full params under `novelwriter`.
  if (d.novelwriter && !d.parameters && typeof d.novelwriter === 'object' && 'temperature' in (d.novelwriter as object)) {
    return { name, params: { ...newStory().params, ...(d.novelwriter as Partial<GenerationParams>) } };
  }
  const params = importParams((d.parameters ?? d) as Record<string, unknown>);
  const extra = (d.novelwriter ?? {}) as { maxContext?: number; dynamicPenaltyRange?: boolean };
  if (typeof extra.maxContext === 'number') params.maxContext = extra.maxContext;
  if (typeof extra.dynamicPenaltyRange === 'boolean') params.dynamicPenaltyRange = extra.dynamicPenaltyRange;
  return { name, params };
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
  applyNovelAIExtras(s, d, importBiasGroup);
  if ((d.settings as { prefix?: string } | undefined)?.prefix === 'special_openings' || d.isTA) s.mode = 'adventure';
  return s;
}

/**
 * NovelAI `.story` files: V1 keeps the text as origin-tagged fragments; V2 keeps it in a msgpack `document`
 * (text comes in as prompt text, since its origin data isn't documented).
 */
function importNovelAIStory(d: Record<string, unknown>): Story {
  const meta = (d.metadata ?? {}) as Record<string, unknown>;
  const content = (d.content ?? {}) as Record<string, unknown>;
  const storyRaw = (content.story ?? {}) as { fragments?: { data: string; origin: string }[] };
  let doc: Story['doc'] = (storyRaw.fragments ?? []).map((f) => ({
    text: f.data,
    origin: (f.origin === 'ai' ? 'ai' : f.origin === 'edit' ? 'edit' : f.origin === 'prompt' || f.origin === 'root' ? 'prompt' : 'user') as Story['doc'][number]['origin'],
  }));
  if (typeof content.document === 'string') {
    const text = novelAIDocumentText(content.document);
    if (text !== null && (text.length >= docText(doc).length || !doc.length)) doc = plainDoc(text, 'prompt');
  }
  const ctx = Array.isArray(content.context) ? (content.context as { text?: string; contextConfig?: unknown }[]) : [];
  const settings = (content.settings ?? {}) as { parameters?: Record<string, unknown> };
  const s = newStory({
    title: String(meta.title ?? 'Imported Story'),
    description: String(meta.description ?? ''),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    favorite: Boolean(meta.favorite),
    mode: meta.isTA ? 'adventure' : 'storyteller',
    doc,
    history: flatten(doc),
    memory: ctx[0]?.text ?? '',
    authorsNote: ctx[1]?.text ?? '',
    lorebook: content.lorebook ? importLorebook(content.lorebook as Record<string, unknown>) : emptyLorebook(),
    params: settings.parameters ? importParams(settings.parameters) : newStory().params,
    step: Number((content.story as { step?: number } | undefined)?.step ?? 0),
  });
  if (ctx[0]?.contextConfig) s.contextSettings.memory = importContextConfig(ctx[0].contextConfig, s.contextSettings.memory);
  if (ctx[1]?.contextConfig) s.contextSettings.authorsNote = importContextConfig(ctx[1].contextConfig, s.contextSettings.authorsNote);
  applyNovelAIExtras(s, content, importBiasGroup);
  return s;
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
