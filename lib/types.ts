export type EdgeKind = 'prerequisite' | 'extends' | 'applies' | 'related' | 'structural';
export type NodeKind = 'target' | 'prerequisite' | 'core' | 'advanced' | 'unknown';

export interface WDEntity {
  id: string;           // Q-ID, e.g. "Q14620"
  label: string;
  description?: string;
  wikipediaUrl?: string;
}

export interface GraphNode extends WDEntity {
  /** Heuristic classification from LLM (prerequisite/core/advanced) */
  kind?: NodeKind;
  /** True when user marks this topic as already known */
  known?: boolean;
  /** True when this is the user's target topic */
  isTarget?: boolean;
  /** Depth from target (0 = target, >0 = sub, <0 = super) */
  depth?: number;
}

export interface GraphEdge {
  id: string;
  source: string;       // Q-ID
  target: string;       // Q-ID
  property?: string;    // P279 / P361 / P527 / P921
  /** LLM-classified directional kind */
  kind?: EdgeKind;
  /** Free-text reason (from LLM) */
  reason?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface WikidataSearchHit {
  id: string;
  label: string;
  description?: string;
}
