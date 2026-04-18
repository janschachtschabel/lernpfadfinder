'use client';
import { useCallback, useMemo } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  type Node, type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '@/lib/store';
import {
  layoutGraph, nodeSize, formatMinutes,
  buildChildrenMap, leafDescendants, subtreeMinutes,
} from '@/lib/graph';
import type { Topic } from '@/lib/types';

/** Visual style per node role. */
function nodeStyle(n: Topic) {
  if (n.isTarget)            return { bg: '#ede9fe', border: '#6a3fed', text: '#2e1065' }; // lernziel: hell lila
  if (n.belowBaseline)       return { bg: '#f1f5f9', border: '#94a3b8', text: '#475569' };
  if (!n.isLeaf)             return { bg: '#fef3c7', border: '#d97706', text: '#78350f' }; // Cluster: amber wie im Mockup
  if (n.estimatedMinutes >= 360) return { bg: '#fde68a', border: '#d97706', text: '#78350f' };
  if (n.estimatedMinutes >= 90)  return { bg: '#dbeafe', border: '#3b82f6', text: '#1e3a8a' };
  return { bg: '#ecfdf5', border: '#10b981', text: '#065f46' };
}

const DIFF_LABEL: Record<number, string> = {
  1: 'Grundschule', 2: 'Mittelstufe', 3: 'Oberstufe', 4: 'Studium', 5: 'Experte',
};

export function GraphCanvas({ interactive = false }: { interactive?: boolean }) {
  const graph = useStore(s => s.graph);
  const toggleKnown = useStore(s => s.toggleKnown);
  const setKnown = useStore(s => s.setKnown);
  const path = useStore(s => s.path);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const childrenMap = useMemo(() => buildChildrenMap(edges), [edges]);

  const positions = useMemo(
    () => layoutGraph(nodes, edges),
    [nodes.length, edges.length, nodes.map(n => n.id + n.isLeaf + n.depth).join('|')]
  );

  /** Click: leaf toggles its own flag; cluster toggles all descendant leaves. */
  const handleNodeClick = useCallback((nodeId: string) => {
    if (!interactive) return;
    const n = byId.get(nodeId);
    if (!n || n.isTarget) return;
    if (n.isLeaf) { toggleKnown(nodeId); return; }
    // Cluster: mark all descendant leaves uniformly.
    const leaves = leafDescendants(nodeId, childrenMap, byId).filter(id => {
      const x = byId.get(id);
      return x && !x.belowBaseline;
    });
    if (leaves.length === 0) return;
    // If any leaf is NOT known → mark all known. Else un-mark all.
    const anyUnknown = leaves.some(id => !byId.get(id)!.known);
    setKnown(leaves, anyUnknown);
  }, [interactive, byId, childrenMap, toggleKnown, setKnown]);

  const rfNodes: Node[] = useMemo(() => nodes.map((n, i) => {
    const style = nodeStyle(n);
    const known = !!n.known;
    const inPath = path.includes(n.id);
    const pathIdx = path.indexOf(n.id);
    // Cluster und Target zeigen konsistent die Summe ihrer Lernschritte.
    const subtreeMin = !n.isLeaf
      ? subtreeMinutes(n.id, childrenMap, byId)
      : undefined;
    const size = nodeSize(n, { subtreeMinutes: subtreeMin });
    const titleSize = n.isTarget ? 16 : size.width >= 220 ? 13 : 12;

    const clickable = interactive && !n.isTarget;
    // For cluster: compute "how many leaves are known" for the visual hint.
    let clusterDone: { known: number; total: number } | null = null;
    if (!n.isLeaf && !n.isTarget) {
      const leaves = leafDescendants(n.id, childrenMap, byId);
      const total = leaves.length;
      const k = leaves.reduce((s, id) => s + (byId.get(id)?.known || byId.get(id)?.belowBaseline ? 1 : 0), 0);
      clusterDone = { known: k, total };
    }

    const display = (
      <div className="leading-tight relative w-full h-full flex flex-col items-center justify-center">
        {clickable && (
          <span
            className={
              'absolute top-1 right-1 w-4 h-4 rounded border flex items-center justify-center text-[10px] ' +
              (known ? 'bg-emerald-500 border-emerald-600 text-white' : 'bg-white border-slate-300 text-transparent')
            }
            aria-label={known ? 'bekannt' : 'unbekannt'}
          >✓</span>
        )}
        <div style={{ fontSize: titleSize, fontWeight: 600 }}>{n.label}</div>
        <div className="text-[10px] opacity-80 mt-0.5 flex items-center justify-center gap-1.5">
          <span title={DIFF_LABEL[n.difficulty]}>{'●'.repeat(n.difficulty)}{'○'.repeat(5 - n.difficulty)}</span>
          <span>·</span>
          <span>{formatMinutes(subtreeMin ?? n.estimatedMinutes)}</span>
          {inPath && <><span>·</span><span className="font-bold">#{pathIdx + 1}</span></>}
        </div>
        {clusterDone && clusterDone.total > 0 && (
          <div className="text-[9px] opacity-70 mt-0.5">
            {clusterDone.known}/{clusterDone.total} bekannt
          </div>
        )}
        {n.relation === 'prerequisite' && (
          <div className="text-[9px] opacity-70 mt-0.5 italic">extern</div>
        )}
        {n.belowBaseline && (
          <div className="text-[9px] opacity-70 mt-0.5">schon bekannt</div>
        )}
      </div>
    );

    return {
      id: n.id,
      position: positions[i] ?? { x: 0, y: 0 },
      data: { label: display },
      style: {
        background: known ? '#d1fae5' : style.bg,
        color: known ? '#065f46' : style.text,
        border: `2px ${(n.belowBaseline || n.relation === 'prerequisite') ? 'dashed' : 'solid'} ${known ? '#10b981' : style.border}`,
        borderRadius: 12,
        padding: 6,
        width: size.width,
        height: size.height,
        textAlign: 'center' as const,
        boxShadow: inPath
          ? '0 0 0 3px rgba(106,63,237,0.35), 0 4px 12px rgba(0,0,0,0.08)'
          : '0 2px 6px rgba(0,0,0,0.05)',
        cursor: clickable ? 'pointer' : 'default',
      },
    };
  }), [nodes, positions, path, interactive, byId, childrenMap]);

  /**
   * Edges: render parent → child so arrows visually flow top-to-bottom.
   * (Our semantic from=child, to=parent ↔ swap for visuals.)
   */
  const rfEdges: Edge[] = useMemo(() => edges.map(e => ({
    id: e.id,
    source: e.to,        // parent (top)
    target: e.from,      // child (bottom)
    type: 'smoothstep',
    pathOptions: { borderRadius: 14 } as any,
    animated: false,
    style: { stroke: '#a8a29e', strokeWidth: 1.4 },
  })), [edges]);

  if (!graph) return null;

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={interactive}
      onNodeClick={(_, node) => handleNodeClick(node.id)}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} color="#e5e7eb" />
      <Controls className="no-print" />
      <MiniMap className="no-print" pannable zoomable />
    </ReactFlow>
  );
}
