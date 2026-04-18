'use client';
import { create } from 'zustand';
import type { LearningGraph, DisambiguationOption, Baseline, Topic, TopicEdge } from './types';
import { dedupeGraph, wouldCreateCycle } from './graph';

export type Phase = 'welcome' | 'baseline' | 'generating' | 'explore' | 'path';

export interface PathSummary {
  summary: string;
  biggestChunks: string;
  criticalPrereqs: string;
  fit: string;
}

interface State {
  phase: Phase;
  setPhase: (p: Phase) => void;

  userQuery: string;
  setUserQuery: (q: string) => void;

  candidates: DisambiguationOption[];
  setCandidates: (c: DisambiguationOption[]) => void;

  target: DisambiguationOption | null;
  setTarget: (t: DisambiguationOption | null) => void;

  baseline: Baseline | null;
  setBaseline: (b: Baseline | null) => void;

  graph: LearningGraph | null;
  setGraph: (g: LearningGraph | null) => void;
  resetGraph: (targetId: string) => void;
  upsertNode: (n: Topic) => void;
  upsertEdge: (e: TopicEdge) => void;
  toggleKnown: (id: string) => void;
  setKnown: (ids: string[], known: boolean) => void;
  /** Collapse duplicate-labelled nodes + break cycles (run after streaming done). */
  finalizeGraph: () => { merged: number };

  path: string[];
  setPath: (p: string[]) => void;

  /** LLM-generated path briefing (D1). null while not yet fetched / on error. */
  summary: PathSummary | null;
  setSummary: (s: PathSummary | null) => void;

  /** Node currently shown in the detail drawer (null = drawer closed). */
  focusedNodeId: string | null;
  setFocusedNodeId: (id: string | null) => void;

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

  baseline: null,
  setBaseline: (b) => set({ baseline: b }),

  graph: null,
  setGraph: (g) => set({ graph: g }),
  resetGraph: (targetId) => set({ graph: { targetId, nodes: [], edges: [] } }),
  upsertNode: (n) => set((s) => {
    if (!s.graph) return {};
    const idx = s.graph.nodes.findIndex(x => x.id === n.id);
    const nodes = [...s.graph.nodes];
    if (idx >= 0) nodes[idx] = { ...nodes[idx], ...n };
    else nodes.push(n);
    return { graph: { ...s.graph, nodes } };
  }),
  upsertEdge: (e) => set((s) => {
    if (!s.graph) return {};
    if (s.graph.edges.some(x => x.id === e.id)) return {};
    // Cycle guard: silently drop edges that would introduce a directed cycle
    // (e.g. LLM produced contradictory "A requires B" + "B requires A").
    if (wouldCreateCycle(s.graph.edges, e.from, e.to)) {
      // eslint-disable-next-line no-console
      console.warn('[store] cycle-creating edge ignored:', e);
      return {};
    }
    return { graph: { ...s.graph, edges: [...s.graph.edges, e] } };
  }),
  toggleKnown: (id) => set((s) => {
    if (!s.graph) return {};
    return {
      graph: { ...s.graph, nodes: s.graph.nodes.map(n => n.id === id ? { ...n, known: !n.known } : n) },
    };
  }),
  setKnown: (ids, known) => set((s) => {
    if (!s.graph) return {};
    const set2 = new Set(ids);
    return {
      graph: { ...s.graph, nodes: s.graph.nodes.map(n => set2.has(n.id) ? { ...n, known } : n) },
    };
  }),
  finalizeGraph: () => {
    const s = useStore.getState();
    if (!s.graph) return { merged: 0 };
    const { graph, merged } = dedupeGraph(s.graph);
    if (merged > 0 || graph !== s.graph) {
      useStore.setState({ graph });
    }
    return { merged };
  },

  path: [],
  setPath: (p) => set({ path: p }),

  summary: null,
  setSummary: (s) => set({ summary: s }),

  focusedNodeId: null,
  setFocusedNodeId: (id) => set({ focusedNodeId: id }),

  status: '',
  setStatus: (s) => set({ status: s }),

  error: null,
  setError: (e) => set({ error: e }),
}));
