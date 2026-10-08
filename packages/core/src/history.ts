import { applyChanges, revertChanges } from './doc.ts';
import { uid } from './util.ts';
import type { Change, History, HistoryNode, HistoryNodeType, Span } from './types.ts';

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
