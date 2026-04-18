'use client';
import { useMemo, useState, useCallback } from 'react';
import { useStore } from '@/lib/store';
import {
  buildChildrenMap, leafDescendants, subtreeMinutes, formatMinutes,
} from '@/lib/graph';
import { EDUCATION_LEVELS } from '@/lib/types';
import type { EducationLevel, Topic } from '@/lib/types';

const LEVEL_SHORT: Record<EducationLevel, string> = {
  elementarbereich:   'Elem',
  primarstufe:        'Prim',
  sekundarstufe_1:    'Sek I',
  sekundarstufe_2:    'Sek II',
  hochschule:         'Hoch',
  berufliche_bildung: 'Beruf',
  fortbildung:        'Fortb',
  erwachsenenbildung: 'EwB',
  foerderschule:      'Förder',
  fernunterricht:     'Fern',
  informelles_lernen: 'Info',
};
const LEVEL_TITLE: Record<EducationLevel, string> = Object.fromEntries(
  EDUCATION_LEVELS.map(l => [l.value, l.title])
) as Record<EducationLevel, string>;

/**
 * Outline-style tree visualisation.
 *
 *  - Target at top-left, children indented one column to the right.
 *  - Each row shows: expand/collapse chevron, title, Schwierigkeit, Zeit, Pfad-#.
 *  - Clusters show aggregated subtree time and "x/y bekannt".
 *  - Clicking the row toggles `known` (leaf) or applies bulk-toggle to subtree (cluster).
 *  - Chevron independently expands/collapses the subtree.
 *  - Overflow is handled naturally by normal vertical scrolling — wide/tall trees
 *    simply push siblings down in their column.
 */

const DIFF_LABEL: Record<number, string> = {
  1: 'Grundschule', 2: 'Mittelstufe', 3: 'Oberstufe', 4: 'Studium', 5: 'Experte',
};

function rowColor(n: Topic, known: boolean) {
  if (known)           return { bg: '#d1fae5', border: '#10b981', text: '#065f46' };
  if (n.isTarget)      return { bg: '#ede9fe', border: '#6a3fed', text: '#2e1065' };
  if (n.belowBaseline) return { bg: '#f1f5f9', border: '#94a3b8', text: '#475569' };
  if (!n.isLeaf)       return { bg: '#fef3c7', border: '#d97706', text: '#78350f' };
  if (n.estimatedMinutes >= 360) return { bg: '#fde68a', border: '#d97706', text: '#78350f' };
  if (n.estimatedMinutes >= 90)  return { bg: '#dbeafe', border: '#3b82f6', text: '#1e3a8a' };
  return { bg: '#ecfdf5', border: '#10b981', text: '#065f46' };
}

interface RowProps {
  node: Topic;
  depth: number;
  childrenIds: string[];
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  byId: Map<string, Topic>;
  childrenMap: Map<string, string[]>;
  interactive: boolean;
  path: string[];
  onRowClick: (id: string) => void;
  /** Vertical line markers: true at each ancestor depth where more siblings exist below */
  ancestorLines: boolean[];
  /** Is this row the last sibling in its parent? (for the └ / ├ glyph) */
  isLastSibling: boolean;
  /** Reason text from the edge to the parent — why this node is needed. */
  edgeReason?: string;
  /** Highlight because it matches the active search query. */
  isSearchMatch?: boolean;
}

function Row({
  node, depth, childrenIds, collapsed, onToggleCollapse,
  byId, childrenMap, interactive, path, onRowClick,
  ancestorLines, isLastSibling, edgeReason, isSearchMatch,
}: RowProps) {
  const hasChildren = childrenIds.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const known = !!node.known;
  const color = rowColor(node, known);
  const inPath = path.indexOf(node.id);

  // Cluster UND Target zeigen konsistent die Summe aller enthaltenen Lernschritte
  // — damit sich die Zahlen von oben nach unten sauber aufaddieren.
  const subMin = !node.isLeaf
    ? subtreeMinutes(node.id, childrenMap, byId)
    : node.estimatedMinutes;

  // Cluster progress (known leaves out of total leaves) + path range
  let clusterDone: { known: number; total: number } | null = null;
  let clusterRange: { min: number; max: number } | null = null;
  if (!node.isLeaf && !node.isTarget) {
    const leaves = leafDescendants(node.id, childrenMap, byId);
    const total = leaves.length;
    const k = leaves.reduce((s, id) => {
      const x = byId.get(id);
      return s + (x && (x.known || x.belowBaseline) ? 1 : 0);
    }, 0);
    clusterDone = { known: k, total };
    // Collect path positions (1-indexed) for leaves that appear in the path.
    const positions = leaves
      .map(id => path.indexOf(id))
      .filter(i => i >= 0)
      .map(i => i + 1);
    if (positions.length > 0) {
      clusterRange = { min: Math.min(...positions), max: Math.max(...positions) };
    }
  }

  const clickable = interactive && !node.isTarget;

  return (
    <div
      className={'flex items-start select-none ' + (isSearchMatch ? 'rounded ring-2 ring-yellow-300 bg-yellow-50/60' : '')}
      style={{ paddingLeft: 0 }}
    >
      {/* Indent rails */}
      <div className="flex-shrink-0 flex" aria-hidden>
        {ancestorLines.map((show, i) => (
          <div
            key={i}
            className="w-5 h-full relative"
            style={{
              borderLeft: show ? '1px solid #cbd5e1' : '1px solid transparent',
            }}
          />
        ))}
        {depth > 0 && (
          <div className="w-5 relative" style={{ minHeight: 36 }}>
            {/* Elbow glyph */}
            <div
              className="absolute left-0 top-0 bottom-0"
              style={{
                borderLeft: '1px solid #cbd5e1',
                height: isLastSibling ? '50%' : '100%',
              }}
            />
            <div
              className="absolute left-0"
              style={{
                top: 18,
                width: 18,
                borderTop: '1px solid #cbd5e1',
              }}
            />
          </div>
        )}
      </div>

      {/* Chevron */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggleCollapse(node.id); }}
        className={
          'flex-shrink-0 w-5 h-8 flex items-center justify-center text-slate-500 ' +
          (hasChildren ? 'hover:text-slate-900 cursor-pointer' : 'opacity-0 cursor-default')
        }
        aria-label={isCollapsed ? 'aufklappen' : 'zuklappen'}
        aria-expanded={!isCollapsed}
      >
        {hasChildren ? (isCollapsed ? '▸' : '▾') : ''}
      </button>

      {/* Pill */}
      <button
        type="button"
        onClick={() => clickable && onRowClick(node.id)}
        title={[
          node.description,
          edgeReason ? `Warum nötig: ${edgeReason}` : '',
          node.testTask ? `Prüfaufgabe: ${node.testTask}` : '',
        ].filter(Boolean).join('\n\n') || undefined}
        className={
          'flex-1 min-w-0 flex items-center gap-2 rounded-md px-2 py-1.5 my-0.5 text-left transition ' +
          (clickable ? 'hover:brightness-95' : '')
        }
        style={{
          background: color.bg,
          color: color.text,
          border: `1.5px ${(node.belowBaseline || node.relation === 'prerequisite') ? 'dashed' : 'solid'} ${color.border}`,
          cursor: clickable ? 'pointer' : 'default',
        }}
      >
        {/* Check badge */}
        {clickable && (
          <span
            className={
              'flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center text-[10px] ' +
              (known ? 'bg-emerald-500 border-emerald-600 text-white' : 'bg-white border-slate-300 text-transparent')
            }
            aria-label={known ? 'bekannt' : 'unbekannt'}
          >✓</span>
        )}

        <span className="font-semibold text-[13px] truncate">
          {node.isTarget && <span className="mr-1">★</span>}
          {node.label}
        </span>

        <span className="text-[10px] opacity-70 ml-1" title={DIFF_LABEL[node.difficulty]}>
          {'●'.repeat(node.difficulty)}{'○'.repeat(5 - node.difficulty)}
        </span>

        <span className="text-[11px] opacity-80 font-mono">
          {formatMinutes(subMin)}
        </span>

        {clusterDone && clusterDone.total > 0 && (
          <span className="text-[10px] opacity-70 bg-white/60 rounded px-1.5 py-0.5">
            {clusterDone.known}/{clusterDone.total}
          </span>
        )}

        {node.relation === 'prerequisite' && (
          <span className="text-[10px] italic opacity-70">extern</span>
        )}

        {node.educationLevel && (
          <span
            title={LEVEL_TITLE[node.educationLevel]}
            className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5"
          >
            {LEVEL_SHORT[node.educationLevel]}
          </span>
        )}

        {inPath >= 0 && (
          <span className="ml-auto text-[10px] font-bold bg-brand-600 text-white rounded-full px-2 py-0.5">
            #{inPath + 1}
          </span>
        )}
        {inPath < 0 && clusterRange && (
          <span className="ml-auto text-[10px] font-bold bg-brand-100 text-brand-800 rounded-full px-2 py-0.5">
            {clusterRange.min === clusterRange.max
              ? `#${clusterRange.min}`
              : `#${clusterRange.min}–${clusterRange.max}`}
          </span>
        )}
        {inPath < 0 && !clusterRange && node.belowBaseline && (
          <span className="ml-auto text-[10px] italic text-slate-500">übersprungen</span>
        )}
      </button>

      {/* Info / Materialien-Button — opens the detail drawer */}
      {!node.isTarget && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            useStore.getState().setFocusedNodeId(node.id);
          }}
          className="flex-shrink-0 ml-2 my-0.5 px-2 h-8 inline-flex items-center gap-1 rounded-md bg-brand-100 text-brand-800 hover:bg-brand-600 hover:text-white text-xs font-medium border border-brand-200 hover:border-brand-600 transition shadow-sm"
          title="Details & passende Lernmaterialien aus WirLernenOnline"
          aria-label="Lernmaterialien anzeigen"
        >
          <span aria-hidden>📚</span>
          <span>Materialien</span>
        </button>
      )}
    </div>
  );
}

export function TreeView({ interactive = false }: { interactive?: boolean }) {
  const graph = useStore(s => s.graph);
  const toggleKnown = useStore(s => s.toggleKnown);
  const setKnown = useStore(s => s.setKnown);
  const path = useStore(s => s.path);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const childrenMap = useMemo(() => buildChildrenMap(edges), [edges]);

  // Parent map (child → parent) — every node has at most one tree-parent in our rendering.
  const parentMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of edges) {
      // edge (child → parent): from=child, to=parent
      if (!m.has(e.from)) m.set(e.from, e.to);
    }
    return m;
  }, [edges]);

  // Depth of each node from root (used for "nur bis Ebene N"-Schnellwahl).
  const depthOf = useMemo(() => {
    const d = new Map<string, number>();
    if (!graph) return d;
    const q: Array<[string, number]> = [[graph.targetId, 0]];
    while (q.length) {
      const [id, depth] = q.shift()!;
      if (d.has(id)) continue;
      d.set(id, depth);
      for (const c of childrenMap.get(id) ?? []) q.push([c, depth + 1]);
    }
    return d;
  }, [graph, childrenMap]);

  // Search matching + ancestor reveal.
  const searchTrim = search.trim().toLowerCase();
  const { matchIds, revealIds } = useMemo(() => {
    if (!searchTrim) return { matchIds: new Set<string>(), revealIds: new Set<string>() };
    const matches = new Set<string>();
    for (const n of nodes) {
      if (n.label.toLowerCase().includes(searchTrim)) matches.add(n.id);
    }
    // Walk ancestors up so matches are visible.
    const reveal = new Set<string>();
    for (const id of matches) {
      let cur = parentMap.get(id);
      while (cur && !reveal.has(cur)) {
        reveal.add(cur);
        cur = parentMap.get(cur);
      }
    }
    return { matchIds: matches, revealIds: reveal };
  }, [searchTrim, nodes, parentMap]);
  // For each child id, remember the reason text of the edge that attaches it to its
  // (first) parent. Edges are child→parent (from=child, to=parent).
  const reasonByChildId = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of edges) {
      if (e.reason && !m.has(e.from)) m.set(e.from, e.reason);
    }
    return m;
  }, [edges]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleRowClick = useCallback((id: string) => {
    const n = byId.get(id);
    if (!n || n.isTarget) return;
    if (n.isLeaf) { toggleKnown(id); return; }
    const leaves = leafDescendants(id, childrenMap, byId).filter(x => {
      const t = byId.get(x);
      return t && !t.belowBaseline;
    });
    if (leaves.length === 0) return;
    const anyUnknown = leaves.some(lid => !byId.get(lid)!.known);
    setKnown(leaves, anyUnknown);
  }, [byId, childrenMap, toggleKnown, setKnown]);

  // Effective collapsed: during search, force-reveal the ancestor chain of every match.
  // Defined here (before any early-return) so React's hook order stays stable.
  const effectiveCollapsed = useMemo(() => {
    if (revealIds.size === 0) return collapsed;
    const next = new Set(collapsed);
    for (const id of revealIds) next.delete(id);
    return next;
  }, [collapsed, revealIds]);

  if (!graph || nodes.length === 0) {
    return <div className="p-8 text-slate-500 text-sm">Noch keine Daten.</div>;
  }

  // Sort children: externals (prerequisites) first, then by difficulty asc, then time desc
  const sortChildren = (ids: string[]) => {
    // Filter to ids we actually have a node for (edges may arrive before nodes while streaming).
    return ids.filter(id => byId.has(id)).sort((a, b) => {
      const na = byId.get(a)!, nb = byId.get(b)!;
      const ra = na.relation === 'prerequisite' ? 0 : 1;
      const rb = nb.relation === 'prerequisite' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      if (na.difficulty !== nb.difficulty) return na.difficulty - nb.difficulty;
      return nb.estimatedMinutes - na.estimatedMinutes;
    });
  };

  // Recursive rendering via flattened list with depth info
  const rows: React.ReactNode[] = [];
  const visited = new Set<string>();
  const walk = (id: string, depth: number, ancestorLines: boolean[], isLast: boolean) => {
    if (visited.has(id)) return;
    visited.add(id);
    const n = byId.get(id);
    if (!n) return;
    const children = sortChildren(childrenMap.get(id) ?? []);
    rows.push(
      <Row
        key={id}
        node={n}
        depth={depth}
        childrenIds={children}
        collapsed={effectiveCollapsed}
        onToggleCollapse={toggleCollapse}
        byId={byId}
        childrenMap={childrenMap}
        interactive={interactive}
        path={path}
        onRowClick={handleRowClick}
        ancestorLines={ancestorLines}
        isLastSibling={isLast}
        edgeReason={reasonByChildId.get(id)}
        isSearchMatch={matchIds.has(id)}
      />
    );
    if (!effectiveCollapsed.has(id)) {
      const nextLines = [...ancestorLines];
      if (depth > 0) nextLines.push(!isLast); // continue rail if parent has more siblings
      children.forEach((cid, i) => {
        walk(cid, depth + 1, nextLines, i === children.length - 1);
      });
    }
  };

  walk(graph.targetId, 0, [], true);

  // Append truly orphaned nodes (no parent edge at all) so nothing gets lost.
  // Nodes that belong to a currently-collapsed subtree already HAVE a parent —
  // we must NOT re-render them as top-level rows.
  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    if (parentMap.has(n.id)) continue;
    walk(n.id, 0, [], true);
  }

  // --- Actions: expand/collapse all, limit to level N -----------------------
  const maxDepth = Math.max(0, ...Array.from(depthOf.values()));
  const allNonLeafIds = nodes.filter(n => !n.isLeaf).map(n => n.id);

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(allNonLeafIds));
  const limitToLevel = (lvl: number) => {
    // Collapse every non-leaf node whose depth >= lvl (so descendants beyond level stay hidden).
    const next = new Set<string>();
    for (const id of allNonLeafIds) {
      const d = depthOf.get(id) ?? 0;
      if (d >= lvl) next.add(id);
    }
    setCollapsed(next);
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="no-print border-b border-slate-200 px-4 py-2 flex flex-wrap gap-2 items-center">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Im Baum suchen …"
            className="text-sm px-3 py-1.5 pr-16 rounded-md border border-slate-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 w-64"
          />
          {searchTrim && (
            <span className="absolute right-8 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">
              {matchIds.size}
            </span>
          )}
          {searchTrim && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-sm"
              aria-label="Suche löschen"
            >
              ✕
            </button>
          )}
        </div>

        <div className="h-6 w-px bg-slate-200" />

        <button
          onClick={expandAll}
          className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
          title="Alle Cluster aufklappen"
        >Alle auf</button>
        <button
          onClick={collapseAll}
          className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
          title="Alle Cluster zuklappen"
        >Alle zu</button>

        {maxDepth >= 2 && (
          <>
            <div className="h-6 w-px bg-slate-200" />
            <span className="text-xs text-slate-500">nur bis:</span>
            {[1, 2, 3].filter(lvl => lvl <= maxDepth).map(lvl => (
              <button
                key={lvl}
                onClick={() => limitToLevel(lvl)}
                className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
                title={`Nur Ebenen bis ${lvl} anzeigen`}
              >Ebene {lvl}</button>
            ))}
          </>
        )}

        <div className="ml-auto text-xs text-slate-500 flex items-center gap-1">
          <span aria-hidden>📚</span>
          <span>= passende Lernmaterialien aus WirLernenOnline</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-4xl mx-auto font-sans">
          {rows}
        </div>
      </div>
    </div>
  );
}
