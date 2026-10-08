// Stories and settings from other tools: NovelAI (all story/scenario versions), KoboldAI, AI Dungeon,
// NovelAI .module and .badwords files.
import { plainDoc } from './doc.ts';
import { contextConfig, defaultContextSettings, emptyLorebook, newLoreEntry, newStory } from './defaults.ts';
import { flatten } from './history.ts';
import { uid } from './util.ts';
import type { ContextConfig, EphemeralEntry, LoreEntry, Lorebook, PhraseBiasGroup, Span, Story } from './types.ts';

// ---------------------------------------------------------------- msgpack (NovelAI V2 documents)

/** Minimal msgpack decoder. Extension payloads are decoded as nested msgpack when they parse, else kept as bytes. */
export function decodeMsgpack(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder();
  let p = 0;
  const need = (n: number) => {
    if (p + n > bytes.length) throw new Error('msgpack: truncated');
  };
  const str = (n: number) => {
    need(n);
    const s = text.decode(bytes.subarray(p, p + n));
    p += n;
    return s;
  };
  const bin = (n: number) => {
    need(n);
    const b = bytes.slice(p, p + n);
    p += n;
    return b;
  };
  const arr = (n: number): unknown[] => Array.from({ length: n }, () => read());
  const map = (n: number): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) {
      const k = read();
      o[typeof k === 'string' || typeof k === 'number' ? String(k) : JSON.stringify(k)] = read();
    }
    return o;
  };
  const ext = (n: number): unknown => {
    need(1);
    const type = view.getInt8(p++);
    const data = bin(n);
    try {
      const inner = decodeMsgpack(data);
      return { __ext: type, value: inner };
    } catch {
      return { __ext: type, bytes: data };
    }
  };
  const u8 = () => (need(1), bytes[p++]);
  const u16 = () => (need(2), (p += 2), view.getUint16(p - 2));
  const u32 = () => (need(4), (p += 4), view.getUint32(p - 4));
  function read(): unknown {
    const b = u8();
    if (b <= 0x7f) return b;
    if (b >= 0xe0) return b - 0x100;
    if ((b & 0xf0) === 0x80) return map(b & 0x0f);
    if ((b & 0xf0) === 0x90) return arr(b & 0x0f);
    if ((b & 0xe0) === 0xa0) return str(b & 0x1f);
    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return bin(u8());
      case 0xc5: return bin(u16());
      case 0xc6: return bin(u32());
      case 0xc7: return ext(u8());
      case 0xc8: return ext(u16());
      case 0xc9: return ext(u32());
      case 0xca: need(4); p += 4; return view.getFloat32(p - 4);
      case 0xcb: need(8); p += 8; return view.getFloat64(p - 8);
      case 0xcc: return u8();
      case 0xcd: return u16();
      case 0xce: return u32();
      case 0xcf: need(8); p += 8; return Number(view.getBigUint64(p - 8));
      case 0xd0: need(1); p += 1; return view.getInt8(p - 1);
      case 0xd1: need(2); p += 2; return view.getInt16(p - 2);
      case 0xd2: need(4); p += 4; return view.getInt32(p - 4);
      case 0xd3: need(8); p += 8; return Number(view.getBigInt64(p - 8));
      case 0xd4: return ext(1);
      case 0xd5: return ext(2);
      case 0xd6: return ext(4);
      case 0xd7: return ext(8);
      case 0xd8: return ext(16);
      case 0xd9: return str(u8());
      case 0xda: return str(u16());
      case 0xdb: return str(u32());
      case 0xdc: return arr(u16());
      case 0xdd: return arr(u32());
      case 0xde: return map(u16());
      case 0xdf: return map(u32());
    }
    throw new Error(`msgpack: bad byte 0x${b.toString(16)}`);
  }
  const out = read();
  if (p !== bytes.length) throw new Error('msgpack: trailing bytes');
  return out;
}

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Unwrap `{__ext, value}` and map-as-pairs (`[[k, v], …]`) shapes. */
function unwrap(v: unknown): unknown {
  if (v && typeof v === 'object' && '__ext' in (v as object) && 'value' in (v as object)) return unwrap((v as { value: unknown }).value);
  return v;
}
function asRecord(v: unknown): Record<string, unknown> | null {
  v = unwrap(v);
  if (Array.isArray(v) && v.every((x) => Array.isArray(x) && x.length === 2)) return Object.fromEntries(v.map(([k, val]) => [String(k), val]));
  return v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array) ? (v as Record<string, unknown>) : null;
}

/**
 * Text of a NovelAI V2 story document (base64 msgpack). The document keeps paragraphs as `sections` listed by
 * `order`; text origins are not recovered, so the text comes in as prompt text. Returns null if no sections are found.
 */
export function novelAIDocumentText(b64: string): string | null {
  let root: unknown;
  try {
    root = decodeMsgpack(base64Bytes(b64));
  } catch {
    return null;
  }
  const seen = new Set<unknown>();
  const find = (v: unknown, depth: number): string | null => {
    if (depth > 12 || v === null || typeof v !== 'object' || seen.has(v)) return null;
    seen.add(v);
    const rec = asRecord(v);
    if (rec && rec.sections !== undefined) {
      const sections = asRecord(rec.sections);
      const order = unwrap(rec.order);
      if (sections) {
        const ids = Array.isArray(order) ? order.map(String) : Object.keys(sections);
        const lines = ids.map((id) => asRecord(sections[id])).filter((s): s is Record<string, unknown> => !!s && typeof s.text === 'string').map((s) => s.text as string);
        if (lines.length) return lines.join('\n');
      }
    }
    for (const child of rec ? Object.values(rec) : Array.isArray(v) ? v : []) {
      const r = find(child, depth + 1);
      if (r !== null) return r;
    }
    return null;
  };
  return find(root, 0);
}

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

