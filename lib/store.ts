'use client';
import { create } from 'zustand';
import type { Graph, GraphEdge, GraphNode, WikidataSearchHit, EdgeKind, NodeKind } from './types';

export type Phase = 'welcome' | 'resolve' | 'graph' | 'didactic' | 'knowledge' | 'path';

interface State {
  phase: Phase;
  setPhase: (p: Phase) => void;

  userQuery: string;
  setUserQuery: (q: string) => void;

  candidates: WikidataSearchHit[];
  setCandidates: (c: WikidataSearchHit[]) => void;

  target: WikidataSearchHit | null;
  setTarget: (t: WikidataSearchHit | null) => void;

  graph: Graph;
  resetGraph: () => void;
  addNodesEdges: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  classifyNode: (id: string, kind: NodeKind) => void;
  classifyEdge: (id: string, kind: EdgeKind, reason?: string) => void;
  toggleKnown: (id: string) => void;
  setKnown: (ids: string[], known: boolean) => void;

  path: string[];
  setPath: (p: string[]) => void;

  status: string;
  setStatus: (s: string) => void;

  error: string | null;
  setError: (e: string | null) => void;
}

export const useStore = create<State>((set) => ({
  phase: 'welcome',
  setPhase: (p) => set({ phase: p }),

  userQuery: '',
  setUserQuery: (q) => set({ userQuery: q }),

  candidates: [],
  setCandidates: (c) => set({ candidates: c }),

  target: null,
  setTarget: (t) => set({ target: t }),

  graph: { nodes: [], edges: [] },
  resetGraph: () => set({ graph: { nodes: [], edges: [] } }),
  addNodesEdges: (newNodes, newEdges) => set((s) => {
    const idx = new Map(s.graph.nodes.map(n => [n.id, n]));
    for (const n of newNodes) {
      if (idx.has(n.id)) {
        const ex = idx.get(n.id)!;
        idx.set(n.id, { ...ex, ...n, label: ex.label && ex.label !== ex.id ? ex.label : n.label });
      } else {
        idx.set(n.id, n);
      }
    }
    const eidx = new Map(s.graph.edges.map(e => [e.id, e]));
    for (const e of newEdges) if (!eidx.has(e.id)) eidx.set(e.id, e);
    return { graph: { nodes: [...idx.values()], edges: [...eidx.values()] } };
  }),
  classifyNode: (id, kind) => set((s) => ({
    graph: {
      ...s.graph,
      nodes: s.graph.nodes.map(n => n.id === id ? { ...n, kind } : n),
    },
  })),
  classifyEdge: (id, kind, reason) => set((s) => ({
    graph: {
      ...s.graph,
      edges: s.graph.edges.map(e => e.id === id ? { ...e, kind, reason } : e),
    },
  })),
  toggleKnown: (id) => set((s) => ({
    graph: {
      ...s.graph,
      nodes: s.graph.nodes.map(n => n.id === id ? { ...n, known: !n.known } : n),
    },
  })),
  setKnown: (ids, known) => set((s) => {
    const set2 = new Set(ids);
    return {
      graph: {
        ...s.graph,
        nodes: s.graph.nodes.map(n => set2.has(n.id) ? { ...n, known } : n),
      },
    };
  }),

  path: [],
  setPath: (p) => set({ path: p }),

  status: '',
  setStatus: (s) => set({ status: s }),

  error: null,
  setError: (e) => set({ error: e }),
}));
