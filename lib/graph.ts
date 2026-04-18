import type { EducationLevel, LearningGraph, Topic, TopicEdge } from './types';

/** Rank along the formal school/university ladder — used for learning-order heuristics. */
const LEVEL_RANK: Partial<Record<EducationLevel, number>> = {
  elementarbereich: 1,
  primarstufe:      2,
  sekundarstufe_1:  3,
  sekundarstufe_2:  4,
  hochschule:       5,
};
const levelRankOf = (lvl?: EducationLevel): number => {
  if (!lvl) return 99;
  return LEVEL_RANK[lvl] ?? 50;
};

/**
 * Slug normalisation (mirrors server-side slugify). Used for node deduplication.
 * Two nodes whose labels slugify to the same string are treated as the same competence.
 */
function normaliseLabel(s: string): string {
  return s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/* ------------------------------------------------------------------ */
/* Tree helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Build parent→children adjacency (inverse of our edge model).
 * Our edges point from=child → to=parent (semantically: child is a prereq/part of parent).
 */
function buildChildrenMap(edges: TopicEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of edges) {
    if (!map.has(e.to)) map.set(e.to, []);
    map.get(e.to)!.push(e.from);
  }
  return map;
}

/** All leaf descendants of a given node (or [self] if self is a leaf). */
function leafDescendants(
  nodeId: string,
  childrenMap: Map<string, string[]>,
  byId: Map<string, Topic>,
  visited = new Set<string>(),
): string[] {
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);
  const n = byId.get(nodeId);
  if (!n) return [];
  // Echte Leaves zählen als sich selbst; das Target ist KEIN Leaf — in seine
  // Kinder absteigen, damit subtreeMinutes(target) die Gesamtsumme liefert.
  if (n.isLeaf && !n.isTarget) return [nodeId];
  const children = childrenMap.get(nodeId) ?? [];
  // Ohne Kinder und kein Leaf: wie ein (unvollständiger) Leaf behandeln,
  // ausser beim Target — dort hätten wir sonst ein irreführendes "0 min".
  if (children.length === 0) return n.isTarget ? [] : [nodeId];
  return children.flatMap(c => leafDescendants(c, childrenMap, byId, visited));
}

/** Total learning time across a subtree (sum of leaves). */
function subtreeMinutes(
  nodeId: string,
  childrenMap: Map<string, string[]>,
  byId: Map<string, Topic>,
): number {
  const leaves = leafDescendants(nodeId, childrenMap, byId);
  return leaves.reduce((s, id) => s + (byId.get(id)?.estimatedMinutes ?? 0), 0);
}

/* ------------------------------------------------------------------ */
/* Node sizing                                                         */
/* ------------------------------------------------------------------ */

/**
 * Node visual size.
 *  - target: largest
 *  - cluster: scaled by total subtree learning time
 *  - leaf: scaled by own learning time
 */
export function nodeSize(
  n: Topic,
  opts?: { subtreeMinutes?: number },
): { width: number; height: number } {
  if (n.isTarget) return { width: 280, height: 96 };
  if (!n.isLeaf) {
    const m = opts?.subtreeMinutes ?? n.estimatedMinutes;
    if (m >= 1800) return { width: 260, height: 84 }; // ≥ 30h
    if (m >= 600)  return { width: 230, height: 80 }; // ≥ 10h
    if (m >= 180)  return { width: 205, height: 76 }; // ≥ 3h
    return { width: 185, height: 72 };
  }
  // Leaf
  const t = n.estimatedMinutes;
  if (t >= 360) return { width: 200, height: 70 };
  if (t >= 90)  return { width: 180, height: 66 };
  return { width: 160, height: 60 };
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/**
 * Radial tree layout — Target sits in the centre, cluster-/leaf-descendants
 * are placed on concentric rings. Each subtree gets an angular sector that is
 * proportional to the number of its leaves, so densely-branched parts of the
 * graph get more room and sparse parts don't waste space.
 *
 *  - Zero edge crossings (the underlying graph is a tree after dedupe / cycle-break).
 *  - Symmetric, screen-filling layout instead of a tall TB dagre stack.
 *  - Node boxes auto-scale via `nodeSize()` as before; ring radii adapt to
 *    keep boxes from overlapping at each depth.
 *
 * We return top-left (x, y) — consistent with the previous dagre output.
 */
export function layoutGraph(
  nodes: Topic[],
  edges: TopicEdge[],
): Array<{ id: string; x: number; y: number }> {
  if (nodes.length === 0) return [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const childrenMap = buildChildrenMap(edges);

  const target = nodes.find(n => n.isTarget) ?? nodes[0];

  // Pre-compute node sizes and subtree leaf counts (weight for angular split).
  const sizeOf = new Map<string, { width: number; height: number }>();
  for (const n of nodes) {
    sizeOf.set(n.id, nodeSize(n, {
      subtreeMinutes: n.isLeaf || n.isTarget
        ? undefined
        : subtreeMinutes(n.id, childrenMap, byId),
    }));
  }

  const weightOf = new Map<string, number>();
  const weight = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    if (weightOf.has(id)) return weightOf.get(id)!;
    const kids = childrenMap.get(id) ?? [];
    const w = kids.length === 0
      ? 1
      : kids.reduce((acc, c) => acc + weight(c, seen), 0);
    weightOf.set(id, w);
    return w;
  };
  weight(target.id);

  // -------- Phase 1: determine angular slice per node ---------------------
  // Target owns the full 2π. Each child's slice is proportional to its own
  // leaf-weight within the parent's slice. We record each node's own slice
  // (angleWidth) so we can later pick a radius large enough to prevent
  // chord-overlap with its siblings.
  const angleCentre = new Map<string, number>();
  const angleWidth  = new Map<string, number>();
  const depthOf     = new Map<string, number>();

  const assignAngles = (
    id: string,
    angleFrom: number,
    angleTo: number,
    depth: number,
    seen = new Set<string>(),
  ) => {
    if (seen.has(id)) return;
    seen.add(id);
    depthOf.set(id, depth);
    angleCentre.set(id, (angleFrom + angleTo) / 2);
    angleWidth.set(id, angleTo - angleFrom);

    const kids = childrenMap.get(id) ?? [];
    if (kids.length === 0) return;
    const totalW = kids.reduce((acc, c) => acc + (weightOf.get(c) ?? 1), 0) || 1;

    // Heavy subtrees first → balanced visual weight around the ring.
    const sorted = [...kids].sort(
      (a, b) => (weightOf.get(b) ?? 0) - (weightOf.get(a) ?? 0),
    );

    const span = angleTo - angleFrom;
    let cursor = angleFrom;
    for (const c of sorted) {
      const w = weightOf.get(c) ?? 1;
      const slice = (span * w) / totalW;
      assignAngles(c, cursor, cursor + slice, depth + 1, seen);
      cursor += slice;
    }
  };
  assignAngles(target.id, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2, 0);

  // -------- Phase 2: choose ring radius per depth -------------------------
  // Constraints:
  //   (a) Neighbour chord: for any two angular NEIGHBOURS on the same ring,
  //       the chord between their centres (= 2·r·sin(Δangle/2)) must be at
  //       least the sum of their half-widths plus padding. This is what
  //       actually prevents sibling overlap — not the node's own sector size.
  //   (b) Ring gap: each ring sits far enough from its predecessor that
  //       stacked boxes don't collide vertically.
  const H_PAD = 24;            // extra horizontal air between neighbour boxes
  const RING_GAP = 55;         // vertical padding between concentric rings
  const FIRST_RING_MIN = 180;  // target → first ring (kept compact)
  const MAX_RING = 3500;       // hard cap against pathological cases

  // Collect nodes per depth, sorted by their centre angle, so we can pair
  // neighbours (wrapping around the circle).
  const perDepth = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depthOf.get(n.id);
    if (d === undefined || d === 0) continue;
    (perDepth.get(d) ?? perDepth.set(d, []).get(d)!).push(n.id);
  }
  for (const arr of perDepth.values()) {
    arr.sort((a, b) => (angleCentre.get(a) ?? 0) - (angleCentre.get(b) ?? 0));
  }

  const depthMaxH     = new Map<number, number>();
  const depthChordMin = new Map<number, number>();
  for (const [d, ids] of perDepth) {
    let ringMaxH = 0;
    let ringChordReq = 0;
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % ids.length];
      const sa = sizeOf.get(a) ?? { width: 200, height: 60 };
      const sb = sizeOf.get(b) ?? { width: 200, height: 60 };
      ringMaxH = Math.max(ringMaxH, sa.height);

      // Angular distance centre-to-centre (shortest path around the circle).
      let da = (angleCentre.get(b) ?? 0) - (angleCentre.get(a) ?? 0);
      // Wrap into (0, 2π]
      while (da <= 0) da += 2 * Math.PI;
      // If only 1 node at this depth, skip (no neighbour pressure).
      if (ids.length < 2) continue;
      const half = Math.max(da / 2, 0.001);
      const needed = sa.width / 2 + sb.width / 2 + H_PAD;
      // chord = 2r·sin(half) ⇒ r ≥ needed / (2·sin(half))
      const rReq = needed / (2 * Math.sin(Math.min(half, Math.PI / 2)));
      if (rReq > ringChordReq) ringChordReq = rReq;
    }
    depthMaxH.set(d, ringMaxH);
    depthChordMin.set(d, ringChordReq);
  }

  const radiusAt = new Map<number, number>();
  radiusAt.set(0, 0);
  let maxDepth = 0;
  for (const d of depthOf.values()) if (d > maxDepth) maxDepth = d;

  let prevRadius = 0;
  for (let d = 1; d <= maxDepth; d++) {
    const chord = depthChordMin.get(d) ?? 0;
    const prevH = depthMaxH.get(d - 1) ?? 0;
    const thisH = depthMaxH.get(d)     ?? 60;
    const minFromPrev = prevRadius + prevH / 2 + thisH / 2 + RING_GAP;
    const floor = d === 1 ? FIRST_RING_MIN : 0;
    const r = Math.min(MAX_RING, Math.max(chord, minFromPrev, floor));
    radiusAt.set(d, r);
    prevRadius = r;
  }

  // -------- Phase 3: materialise positions --------------------------------
  const posCentre = new Map<string, { x: number; y: number }>();
  posCentre.set(target.id, { x: 0, y: 0 });
  for (const n of nodes) {
    const d = depthOf.get(n.id);
    if (d === undefined || d === 0) continue;
    const a = angleCentre.get(n.id) ?? 0;
    const r = radiusAt.get(d) ?? 0;
    posCentre.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
  }

  // Fall-back: any node we didn't reach (orphan / disconnected) is pinned far
  // below so at least the graph doesn't crash — should be rare after dedupe.
  let orphanY = 0;
  for (const n of nodes) {
    if (posCentre.has(n.id)) continue;
    posCentre.set(n.id, { x: 0, y: 1200 + orphanY });
    orphanY += 120;
  }

  return nodes.map(n => {
    const c = posCentre.get(n.id) ?? { x: 0, y: 0 };
    const s = sizeOf.get(n.id) ?? { width: 200, height: 60 };
    return { id: n.id, x: c.x - s.width / 2, y: c.y - s.height / 2 };
  });
}

/* ------------------------------------------------------------------ */
/* Learning-path computation                                           */
/* ------------------------------------------------------------------ */

/**
 * Compute an ordered learning path over the LEAVES of the graph.
 *
 *  - Leaves below baseline or marked as known are skipped.
 *  - External prerequisites (relation='prerequisite') propagate their ordering
 *    transitively: every leaf under the external subtree must come before every
 *    leaf under the dependant subtree (and all its descendants).
 *  - Subtopic edges impose NO ordering between siblings (natural freedom).
 *  - Remaining freedom is resolved by ascending difficulty, then ascending time.
 *  - Target appended last as the final "you've arrived" marker.
 */
export function computeLearningPath(graph: LearningGraph): string[] {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const childrenMap = buildChildrenMap(graph.edges);

  // All active leaves (skip known/belowBaseline/target)
  const allLeaves = graph.nodes.filter(n => n.isLeaf && !n.isTarget);
  const activeLeaves = allLeaves.filter(n => !n.known && !n.belowBaseline);
  const activeLeafIds = new Set(activeLeaves.map(n => n.id));

  // Build pairwise "must come before" constraints via external prereq edges.
  // For every edge (child → parent) where child.relation === 'prerequisite':
  //   leaves(child) must come before leaves(parent) AND all leaves deeper under parent.
  const before = new Map<string, Set<string>>(); // key=leafB, value=set of leafA that must precede leafB
  const ensure = (id: string) => { if (!before.has(id)) before.set(id, new Set()); return before.get(id)!; };

  for (const e of graph.edges) {
    const fromNode = byId.get(e.from);
    if (!fromNode || fromNode.relation !== 'prerequisite') continue;

    const leavesFrom = leafDescendants(e.from, childrenMap, byId)
      .filter(id => activeLeafIds.has(id));
    const leavesTo = leafDescendants(e.to, childrenMap, byId)
      .filter(id => activeLeafIds.has(id));

    for (const lt of leavesTo) {
      for (const lf of leavesFrom) {
        if (lf !== lt) ensure(lt).add(lf);
      }
    }
  }

  // Learning-order heuristic within the freedom left by topological constraints:
  //   1. LOWER Bildungsstufe first  (Primar vor Sek I vor Sek II vor Hochschule)
  //   2. SHORTER time first           (Quick-Wins / kleine Bausteine vor großen)
  //   3. EASIER difficulty first
  //   4. alphabetical (stable tiebreak)
  // Topological constraints from external prerequisites are enforced via `before`;
  // this sort only governs the order among nodes that are free to be scheduled.
  const defaultOrder = [...activeLeaves].sort((a, b) => {
    const la = levelRankOf(a.educationLevel), lb = levelRankOf(b.educationLevel);
    if (la !== lb) return la - lb;
    if (a.estimatedMinutes !== b.estimatedMinutes) return a.estimatedMinutes - b.estimatedMinutes;
    if (a.difficulty !== b.difficulty) return a.difficulty - b.difficulty;
    return a.label.localeCompare(b.label, 'de');
  });

  // Topological placement honoring `before` constraints.
  const placed = new Set<string>();
  const result: string[] = [];
  const visit = (id: string, stack: Set<string>) => {
    if (placed.has(id) || stack.has(id)) return;
    stack.add(id);
    for (const pre of before.get(id) ?? []) {
      if (activeLeafIds.has(pre)) visit(pre, stack);
    }
    stack.delete(id);
    placed.add(id);
    result.push(id);
  };
  for (const n of defaultOrder) visit(n.id, new Set());

  if (byId.has(graph.targetId)) result.push(graph.targetId);
  return result;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function totalMinutes(graph: LearningGraph, path: string[]): number {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  return path.reduce((sum, id) => sum + (byId.get(id)?.estimatedMinutes ?? 0), 0);
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/* ------------------------------------------------------------------ */
/* Cycle detection                                                     */
/* ------------------------------------------------------------------ */

/**
 * Returns true iff adding edge (from → to) to the existing edges would create
 * a directed cycle. Used by the store to reject bogus LLM output.
 *
 *   Edge (f→t) creates a cycle iff `t` can already reach `f` in the graph.
 */
export function wouldCreateCycle(existing: TopicEdge[], from: string, to: string): boolean {
  if (from === to) return true;
  // adjacency from -> set of targets
  const adj = new Map<string, Set<string>>();
  for (const e of existing) {
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    adj.get(e.from)!.add(e.to);
  }
  // BFS from `to`; if we can reach `from` through existing edges, adding (from→to)
  // would close a cycle (… from → … → to → from).
  const queue: string[] = [to];
  const seen = new Set<string>([to]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const nexts = adj.get(cur);
    if (!nexts) continue;
    for (const n of nexts) {
      if (n === from) return true;
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return false;
}

/**
 * Hard pass: remove any edge that, together with earlier edges, forms a cycle.
 * The later edge wins (=is preserved); the edge that closed the cycle is dropped.
 * Returns the sanitised edge list and how many were removed.
 */
export function breakCycles(edges: TopicEdge[]): { edges: TopicEdge[]; removed: TopicEdge[] } {
  const kept: TopicEdge[] = [];
  const removed: TopicEdge[] = [];
  for (const e of edges) {
    if (wouldCreateCycle(kept, e.from, e.to)) {
      removed.push(e);
    } else {
      kept.push(e);
    }
  }
  return { edges: kept, removed };
}

/* ------------------------------------------------------------------ */
/* Deduplication                                                       */
/* ------------------------------------------------------------------ */

/**
 * Collapse nodes whose labels slugify to the same string into a single canonical
 * node (DAG-ify). Edges are re-pointed at the canonical id; self-loops and
 * duplicate edges are dropped.
 *
 * This is idempotent and safe to call repeatedly (e.g. on every streaming
 * update). Node merging preserves the *first* occurrence's metadata but keeps
 * the MAX of estimatedMinutes (so a fuller later estimate doesn't get lost).
 */
export function dedupeGraph(graph: LearningGraph): { graph: LearningGraph; merged: number } {
  const canonicalByKey = new Map<string, string>();
  const remap = new Map<string, string>();
  const mergedNodes = new Map<string, Topic>();

  for (const n of graph.nodes) {
    // The target is always its own canonical id — never collapse anything into or out of it.
    if (n.isTarget) {
      canonicalByKey.set('__target__' + n.id, n.id);
      mergedNodes.set(n.id, n);
      continue;
    }
    const key = normaliseLabel(n.label);
    const existingId = canonicalByKey.get(key);
    if (!existingId) {
      canonicalByKey.set(key, n.id);
      mergedNodes.set(n.id, n);
    } else {
      // Merge into existing canonical node: keep max time, take union of flags.
      remap.set(n.id, existingId);
      const prev = mergedNodes.get(existingId)!;
      mergedNodes.set(existingId, {
        ...prev,
        estimatedMinutes: Math.max(prev.estimatedMinutes, n.estimatedMinutes),
        // If either copy is an internal (non-leaf) cluster, preserve non-leaf-ness.
        isLeaf: prev.isLeaf && n.isLeaf,
        known: prev.known || n.known,
        belowBaseline: prev.belowBaseline || n.belowBaseline,
        testTask: prev.testTask || n.testTask,
        description: prev.description || n.description,
        educationLevel: prev.educationLevel ?? n.educationLevel,
      });
    }
  }

  if (remap.size === 0) {
    // Still run cycle-break in case of bad LLM output
    const { edges, removed } = breakCycles(graph.edges);
    if (removed.length === 0) return { graph, merged: 0 };
    return { graph: { ...graph, edges }, merged: 0 };
  }

  const canonicalId = (id: string) => remap.get(id) ?? id;
  const seenEdge = new Set<string>();
  const rewiredEdges: TopicEdge[] = [];
  for (const e of graph.edges) {
    const from = canonicalId(e.from);
    const to = canonicalId(e.to);
    if (from === to) continue;
    const key = `${from}->${to}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    rewiredEdges.push({ ...e, id: key, from, to });
  }

  const { edges: safeEdges } = breakCycles(rewiredEdges);

  return {
    graph: {
      ...graph,
      nodes: Array.from(mergedNodes.values()),
      edges: safeEdges,
    },
    merged: remap.size,
  };
}

/* Expose helpers for components that need subtree info. */
export { buildChildrenMap, leafDescendants, subtreeMinutes };
