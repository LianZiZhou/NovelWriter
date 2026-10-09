import { create } from 'zustand';
import { docText, normalizeEmbeddingConfig, stripComments, type EmbeddingConfig, type EmbeddingConfigPatch, type Story, type VectorHits } from '@novelwriter/core';
import { api } from '../api.ts';

interface EmbeddingState {
  config: EmbeddingConfig | null;
  /** The latest vector search per story, so the context viewer shows what the last generation recalled. */
  hits: Record<string, VectorHits & { scores: number[]; at: number }>;
  load: () => Promise<EmbeddingConfig>;
  save: (patch: EmbeddingConfigPatch) => Promise<void>;
}

export const useEmbeddings = create<EmbeddingState>((set, get) => ({
  config: null,
  hits: {},
  async load() {
    let c: EmbeddingConfig;
    try {
      c = await api.embeddingConfig();
    } catch {
      c = normalizeEmbeddingConfig({});
    }
    set({ config: c });
    return c;
  },
  async save(patch) {
    const prev = get().config ?? normalizeEmbeddingConfig({});
    const next = normalizeEmbeddingConfig({ ...prev, ...patch, onnx: { ...prev.onnx, ...patch.onnx }, llama: { ...prev.llama, ...patch.llama }, endpoint: { ...prev.endpoint, ...patch.endpoint } });
    set({ config: next });
    await api.saveEmbeddingConfig(patch);
  },
}));

async function config(): Promise<EmbeddingConfig> {
  return useEmbeddings.getState().config ?? (await useEmbeddings.getState().load());
}

/** Vector search is on for this story: the setting and the story's own recall. */
export async function vectorsEnabled(story: Story): Promise<EmbeddingConfig | null> {
  if (!story.recall?.enabled) return null;
  const c = await config();
  return c.enabled ? c : null;
}

/**
 * Passages of the story that are close in meaning to the latest text. Falls back to none (keyword recall only)
 * when the engine fails or takes longer than the configured time.
 */
export async function searchVectors(story: Story, storyText: string): Promise<VectorHits | undefined> {
  const c = await vectorsEnabled(story);
  if (!c) return undefined;
  const query = `${storyText.slice(-c.queryChars)}\n${story.authorsNote}`.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), c.queryTimeoutMs);
  try {
    const r = await api.searchVectors(story.id, query, controller.signal);
    const hits = { hashes: r.hashes, weight: c.vectorWeight, scores: r.scores, at: Date.now() };
    useEmbeddings.setState((s) => ({ hits: { ...s.hits, [story.id]: hits } }));
    return hits;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

const lastSynced = new Map<string, number>();

/** Index the story's new text in the background (after a generation). */
export async function syncVectors(story: Story, force = false): Promise<void> {
  const c = await vectorsEnabled(story);
  if (!c || (!c.autoIndex && !force)) return;
  // The same text the context is built from, so the passages (and their hashes) match.
  const text = stripComments(docText(story.doc));
  // Wait for a few hundred new characters, unless asked.
  if (!force && Math.abs(text.length - (lastSynced.get(story.id) ?? -Infinity)) < 300) return;
  lastSynced.set(story.id, text.length);
  try {
    await api.syncVectors(story.id, text);
  } catch {
    /* shown in the story tab's index status */
  }
}
