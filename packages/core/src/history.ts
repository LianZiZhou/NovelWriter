import { applyChanges, revertChanges } from './doc.ts';
import { uid } from './util.ts';
import type { TokenProb, Change, History, HistoryNode, HistoryNodeType, Span } from './types.ts';

export function createHistory(): History {
  return {
    nodes: { root: { id: 'root', parent: null, children: [], type: 'root', changes: [], time: Date.now() } },
    current: 'root',
  };
}

function clone(h: History): History {
  return { nodes: { ...h.nodes }, current: h.current };
}

/** Record `changes` (already applied to `doc`) as a new child of the current node. */
export function commit(h: History, type: HistoryNodeType, changes: Change[]): { history: History; node: HistoryNode } {
  const next = clone(h);
  const parent = { ...next.nodes[h.current] };
  const node: HistoryNode = { id: uid(), parent: parent.id, children: [], type, changes, time: Date.now() };
  parent.children = [...parent.children, node.id];
  parent.preferred = node.id;
  next.nodes[parent.id] = parent;
  next.nodes[node.id] = node;
  next.current = node.id;
  return { history: next, node };
}

/** Merge additional changes into the current node (e.g. continuing to type). */
export function amend(h: History, changes: Change[]): History {
  const next = clone(h);
  const cur = next.nodes[h.current];
  next.nodes[cur.id] = { ...cur, changes: [...cur.changes, ...changes], time: Date.now() };
  return next;
}

export function canUndo(h: History): boolean {
  return h.nodes[h.current].parent !== null;
}

export function canRedo(h: History): boolean {
  return h.nodes[h.current].children.length > 0;
}

export function undo(h: History, doc: Span[]): { history: History; doc: Span[] } | null {
  const cur = h.nodes[h.current];
  if (!cur.parent) return null;
  const next = clone(h);
  const parent = { ...next.nodes[cur.parent], preferred: cur.id };
  next.nodes[parent.id] = parent;
  next.current = parent.id;
  return { history: next, doc: revertChanges(doc, cur.changes) };
}

export function redo(h: History, doc: Span[], childId?: string): { history: History; doc: Span[] } | null {
  const cur = h.nodes[h.current];
  const target = childId ?? cur.preferred ?? cur.children[cur.children.length - 1];
  if (!target || !cur.children.includes(target)) return null;
  const next = clone(h);
  next.nodes[cur.id] = { ...cur, preferred: target };
  next.current = target;
  return { history: next, doc: applyChanges(doc, next.nodes[target].changes) };
}

/** Path of node ids from root to `id` (inclusive). */
export function pathTo(h: History, id: string): string[] {
  const path: string[] = [];
  let n: HistoryNode | undefined = h.nodes[id];
  while (n) {
    path.unshift(n.id);
    n = n.parent ? h.nodes[n.parent] : undefined;
  }
  return path;
}

/** Jump to any node by reverting to the common ancestor and replaying forward. */
export function jumpTo(h: History, doc: Span[], id: string): { history: History; doc: Span[] } {
  if (!h.nodes[id]) return { history: h, doc };
  const from = pathTo(h, h.current);
  const to = pathTo(h, id);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common++;
  let d = doc;
  for (let i = from.length - 1; i >= common; i--) d = revertChanges(d, h.nodes[from[i]].changes);
  const next = clone(h);
  for (let i = common; i < to.length; i++) {
    d = applyChanges(d, h.nodes[to[i]].changes);
    if (i > 0) next.nodes[to[i - 1]] = { ...next.nodes[to[i - 1]], preferred: to[i] };
  }
  next.current = id;
  return { history: next, doc: d };
}

/** Rebuild the document at `id` by replaying from the root. */
export function materialize(h: History, id = h.current): Span[] {
  let d: Span[] = [];
  for (const nid of pathTo(h, id)) d = applyChanges(d, h.nodes[nid].changes);
  return d;
}

/**
 * The AI generations selectable at the current point: siblings of the current
 * node when it is an AI node, else the AI children of the current node.
 */
export function retryOptions(h: History): HistoryNode[] {
  const cur = h.nodes[h.current];
  if (cur.type === 'ai' && cur.parent) {
    return h.nodes[cur.parent].children.map((c) => h.nodes[c]).filter((n) => n.type === 'ai');
  }
  return cur.children.map((c) => h.nodes[c]).filter((n) => n.type === 'ai');
}

/** Remove every node not on the current path or reachable forward via preferred children. */
export function trim(h: History): History {
  const keep = new Set(pathTo(h, h.current));
  let n = h.nodes[h.current];
  while (n.preferred && h.nodes[n.preferred]) {
    keep.add(n.preferred);
    n = h.nodes[n.preferred];
  }
  const nodes: Record<string, HistoryNode> = {};
  for (const id of keep) {
    const node = h.nodes[id];
    nodes[id] = { ...node, children: node.children.filter((c) => keep.has(c)) };
  }
  return { nodes, current: h.current };
}

/** Collapse all history into a single node holding the current document. */
export function flatten(doc: Span[]): History {
  const h = createHistory();
  if (!doc.length) return h;
  return commit(h, 'prompt', [{ pos: 0, removed: [], inserted: doc }]).history;
}

export function historyStats(h: History): { nodes: number; deadEnds: number; aiNodes: number; maxDepth: number } {
  const all = Object.values(h.nodes);
  let maxDepth = 0;
  const depth = (id: string): number => pathTo(h, id).length - 1;
  let deadEnds = 0;
  for (const n of all) {
    if (n.children.length === 0 && n.id !== h.current) deadEnds++;
    if (n.children.length === 0) maxDepth = Math.max(maxDepth, depth(n.id));
  }
  return { nodes: all.length - 1, deadEnds, aiNodes: all.filter((n) => n.type === 'ai').length, maxDepth };
}

export interface StructureStats {
  currentStep: number;
  furthestStep: number;
  deadEnds: number;
  /** AI steps in a row, ending at the current step, that were kept without a retry. */
  noRetryStreak: number;
  /** Most steps in any branch that leaves the current path. */
  longestAbandonedBranch: number;
  mostRetries: number;
  averageRetries: number;
}

/** Shape of the history tree, as reported by the Story Statistics "Structure" column. */
export function structureStats(h: History): StructureStats {
  const path = pathTo(h, h.current);
  const onPath = new Set(path);
  const height = (id: string): number => {
    const n = h.nodes[id];
    return n.children.length ? 1 + Math.max(...n.children.map(height)) : 0;
  };
  let furthest = 0;
  let deadEnds = 0;
  let longestAbandoned = 0;
  let mostRetries = 0;
  let retrySum = 0;
  let retryParents = 0;
  const walk = (id: string, depth: number) => {
    const n = h.nodes[id];
    furthest = Math.max(furthest, depth);
    if (!n.children.length && id !== h.current) deadEnds++;
    const ai = n.children.filter((c) => h.nodes[c].type === 'ai').length;
    if (ai > 0) {
      mostRetries = Math.max(mostRetries, ai - 1);
      retrySum += ai - 1;
      retryParents++;
    }
    for (const c of n.children) {
      if (onPath.has(id) && !onPath.has(c)) longestAbandoned = Math.max(longestAbandoned, 1 + height(c));
      walk(c, depth + 1);
    }
  };
  walk(path[0], 0);
  let streak = 0;
  for (let i = path.length - 1; i > 0; i--) {
    const n = h.nodes[path[i]];
    if (n.type !== 'ai') break;
    const parent = h.nodes[path[i - 1]];
    if (parent.children.filter((c) => h.nodes[c].type === 'ai').length > 1) break;
    streak++;
  }
  return {
    currentStep: path.length - 1,
    furthestStep: furthest,
    deadEnds,
    noRetryStreak: streak,
    longestAbandonedBranch: longestAbandoned,
    mostRetries,
    averageRetries: retryParents ? Math.round((retrySum / retryParents) * 100) / 100 : 0,
  };
}

/** How many AI nodes keep their token probabilities (older ones are dropped to bound story size). */
export const MAX_PROB_NODES = 30;

/** Attach token probabilities to a node and drop them from the oldest nodes beyond the limit. */
export function setNodeProbs(h: History, id: string, probs: TokenProb[]): History {
  const nodes = { ...h.nodes, [id]: { ...h.nodes[id], probs } };
  const withProbs = Object.values(nodes)
    .filter((n) => n.probs?.length)
    .sort((a, b) => b.time - a.time);
  for (const n of withProbs.slice(MAX_PROB_NODES)) nodes[n.id] = { ...n, probs: undefined };
  return { ...h, nodes };
}

/**
 * Token probabilities of AI text still present in the current document, as absolute text ranges.
 * Offsets are carried through later edits; tokens touched by an edit are dropped.
 */
export function visibleTokenProbs(h: History): { from: number; to: number; prob: TokenProb; node: string }[] {
  const path = pathTo(h, h.current);
  const out: { from: number; to: number; prob: TokenProb; node: string }[] = [];
  for (let i = 0; i < path.length; i++) {
    const n = h.nodes[path[i]];
    if (!n.probs?.length || n.type !== 'ai' || !n.changes[0]) continue;
    const base = n.changes[0].pos;
    let ranges = n.probs.map((p) => ({ from: base + p.o, to: base + p.o + p.t.length, prob: p, node: n.id }));
    // Later changes on the path (and the node's own changes after the first) shift or remove ranges.
    const later: Change[] = [...n.changes.slice(1)];
    for (let j = i + 1; j < path.length; j++) later.push(...h.nodes[path[j]].changes);
    for (const c of later) {
      const removed = c.removed.reduce((a, s) => a + s.text.length, 0);
      const inserted = c.inserted.reduce((a, s) => a + s.text.length, 0);
      const end = c.pos + removed;
      ranges = ranges
        .filter((r) => r.to <= c.pos || r.from >= end)
        .map((r) => (r.from >= end ? { ...r, from: r.from + inserted - removed, to: r.to + inserted - removed } : r));
    }
    out.push(...ranges);
  }
  return out.sort((a, b) => a.from - b.from);
}
