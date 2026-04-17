import type { Graph, GraphEdge, GraphNode } from './types';
import dagre from 'dagre';

/** Dagre layout for React Flow positioning. */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], dir: 'TB' | 'LR' = 'TB') {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: dir, nodesep: 40, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  const W = 180, H = 66;
  for (const n of nodes) g.setNode(n.id, { width: W, height: H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  return nodes.map(n => {
    const nd = g.node(n.id);
    return { id: n.id, x: (nd?.x ?? 0) - W / 2, y: (nd?.y ?? 0) - H / 2 };
  });
}

/** Compute learning path: topo-sort prerequisites of target that are NOT known. */
export function computeLearningPath(graph: Graph, targetId: string, knownIds: Set<string>): string[] {
  // Build reverse prerequisite graph: "to learn X, need prerequisite Y first"
  // Edge kind 'prerequisite' from A -> B means: B is prerequisite of A.
  // Some fallback: structural edges from child -> parent (child is sub-topic → parent is broader context, not a prereq)
  // We focus on explicit 'prerequisite' kind; structural child->parent reversed (parent before child when descending learning).
  const prereqs = new Map<string, Set<string>>();
  const ensure = (k: string) => { if (!prereqs.has(k)) prereqs.set(k, new Set()); return prereqs.get(k)!; };

  for (const e of graph.edges) {
    if (e.kind === 'prerequisite') {
      // source is prerequisite of target
      ensure(e.target).add(e.source);
    } else if (e.kind === 'extends' || e.kind === 'applies') {
      ensure(e.source).add(e.target); // extension requires base
    } else if (e.kind === 'structural') {
      // P279/P361: source is sub-concept of target → learning target often requires target (broader context first)
      ensure(e.source).add(e.target);
    }
    // 'related' → no ordering
  }

  // BFS back from target, collect all transitive prereqs
  const needed = new Set<string>();
  const queue = [targetId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const pre of prereqs.get(cur) ?? []) {
      if (!needed.has(pre) && !knownIds.has(pre)) {
        needed.add(pre);
        queue.push(pre);
      }
    }
  }
  needed.add(targetId);

  // Topological sort of `needed` subgraph
  const inDeg = new Map<string, number>();
  for (const n of needed) inDeg.set(n, 0);
  for (const [to, froms] of prereqs) {
    if (!needed.has(to)) continue;
    for (const f of froms) {
      if (needed.has(f)) inDeg.set(to, (inDeg.get(to) ?? 0) + 1);
    }
  }
  const ready: string[] = [];
  for (const [k, v] of inDeg) if (v === 0) ready.push(k);
  const out: string[] = [];
  while (ready.length) {
    const n = ready.shift()!;
    out.push(n);
    for (const [to, froms] of prereqs) {
      if (!needed.has(to) || !froms.has(n)) continue;
      inDeg.set(to, (inDeg.get(to) ?? 1) - 1);
      if (inDeg.get(to) === 0) ready.push(to);
    }
  }
  // Any leftovers (cycles) appended at end
  for (const n of needed) if (!out.includes(n)) out.push(n);
  return out;
}
