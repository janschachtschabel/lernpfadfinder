'use client';
import { useEffect, useMemo } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  MarkerType,
  type Node, type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '@/lib/store';
import { layoutGraph } from '@/lib/graph';
import type { EdgeKind, NodeKind } from '@/lib/types';

const NODE_COLORS: Record<NodeKind, { bg: string; border: string; text: string }> = {
  target:       { bg: '#6a3fed', border: '#4b26b0', text: 'white' },
  prerequisite: { bg: '#fef3c7', border: '#f59e0b', text: '#78350f' },
  core:         { bg: '#dbeafe', border: '#3b82f6', text: '#1e3a8a' },
  advanced:     { bg: '#fce7f3', border: '#ec4899', text: '#831843' },
  unknown:      { bg: 'white',    border: '#d1d5db', text: '#1f2937' },
};

const EDGE_COLORS: Record<EdgeKind, string> = {
  structural:   '#c4b5fd',
  prerequisite: '#ef4444',
  extends:      '#3b82f6',
  applies:      '#10b981',
  related:      '#9ca3af',
};

export function GraphCanvas({ interactive = false }: { interactive?: boolean }) {
  const graph = useStore(s => s.graph);
  const toggleKnown = useStore(s => s.toggleKnown);
  const target = useStore(s => s.target);
  const path = useStore(s => s.path);

  const positions = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph.nodes.length, graph.edges.length]);

  const rfNodes: Node[] = useMemo(() => graph.nodes.map((n, i) => {
    const kind: NodeKind = n.isTarget ? 'target' : (n.kind ?? 'unknown');
    const color = NODE_COLORS[kind];
    const known = !!n.known;
    const inPath = path.includes(n.id);
    const pathIdx = path.indexOf(n.id);
    return {
      id: n.id,
      position: positions[i] ?? { x: 0, y: 0 },
      data: {
        label: (
          <div className="text-center leading-tight">
            <div className="font-semibold">{n.label}</div>
            <div className="text-[10px] opacity-70 mt-0.5">
              {n.id}
              {inPath && <span className="ml-1 text-brand-700 font-bold">· #{pathIdx + 1}</span>}
            </div>
          </div>
        ),
      },
      style: {
        background: known ? '#d1fae5' : color.bg,
        color: known ? '#065f46' : color.text,
        border: `2px solid ${known ? '#10b981' : color.border}`,
        borderRadius: 12,
        padding: 8,
        width: 180,
        fontSize: 12,
        boxShadow: inPath
          ? '0 0 0 3px rgba(106,63,237,0.35), 0 4px 12px rgba(0,0,0,0.08)'
          : '0 2px 6px rgba(0,0,0,0.05)',
        cursor: interactive ? 'pointer' : 'default',
      },
    };
  }), [graph.nodes, positions, path, interactive]);

  const rfEdges: Edge[] = useMemo(() => graph.edges.map(e => {
    const kind: EdgeKind = e.kind ?? 'structural';
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      animated: kind === 'prerequisite',
      label: e.property || (kind !== 'structural' ? kind : ''),
      labelStyle: { fontSize: 10, fill: EDGE_COLORS[kind], fontWeight: 500 },
      style: { stroke: EDGE_COLORS[kind], strokeWidth: kind === 'prerequisite' ? 2.5 : kind === 'related' ? 1 : 1.6, strokeDasharray: kind === 'related' ? '4 4' : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS[kind] },
    };
  }), [graph.edges]);

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={interactive}
      onNodeClick={(_, node) => {
        if (interactive && node.id !== target?.id) toggleKnown(node.id);
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} color="#ddd6fe" />
      <Controls className="no-print" />
      <MiniMap className="no-print" pannable zoomable />
    </ReactFlow>
  );
}
