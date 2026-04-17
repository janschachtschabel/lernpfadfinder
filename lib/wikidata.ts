import type { Graph, GraphEdge, GraphNode, WikidataSearchHit } from './types';

const WDQS = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'WLOLernpfadfinder/0.1 (https://github.com/wlo; contact@example.org)';

/**
 * Resolve a free-text term to Wikidata Q-IDs via wbsearchentities.
 * Returns top N hits for user disambiguation.
 */
export async function searchEntities(term: string, lang = 'de', limit = 5): Promise<WikidataSearchHit[]> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(term)}&language=${lang}&format=json&origin=*&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Wikidata search failed: ${res.status}`);
  const json = await res.json() as { search: Array<{ id: string; label: string; description?: string }> };
  return json.search.map(h => ({ id: h.id, label: h.label, description: h.description }));
}

/**
 * Run SPARQL against Wikidata Query Service.
 */
async function sparql<T = any>(query: string): Promise<T[]> {
  const url = `${WDQS}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`SPARQL failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { results: { bindings: any[] } };
  return json.results.bindings as T[];
}

interface Binding { [key: string]: { value: string; type: string } }

function extractQId(uri: string): string | null {
  const m = uri.match(/\/entity\/(Q\d+)$/);
  return m ? m[1] : null;
}

/**
 * Build an initial Wikidata sub-graph around a seed Q-ID.
 * - Sub-topics via P279 (subclass of) and P361 (part of)  — 2 levels deep
 * - Super-topics via P279/P361 — 1 level up
 * - "Has part" via P527 for broader scope — 1 level
 * - Related via P921 (main subject) — skipped by default (too noisy)
 */
export async function fetchGraph(seedQid: string, lang = 'de'): Promise<Graph> {
  const subDown = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX schema: <http://schema.org/>
SELECT ?child ?childLabel ?childDesc ?parent ?prop WHERE {
  {
    ?child wdt:P279 ?parent .
    ?parent (wdt:P279|wdt:P361)* wd:${seedQid} .
    BIND(wdt:P279 AS ?prop)
  } UNION {
    ?child wdt:P361 ?parent .
    ?parent (wdt:P279|wdt:P361)* wd:${seedQid} .
    BIND(wdt:P361 AS ?prop)
  } UNION {
    wd:${seedQid} wdt:P527 ?child .
    BIND(wd:${seedQid} AS ?parent)
    BIND(wdt:P527 AS ?prop)
  }
  OPTIONAL { ?child schema:description ?childDesc . FILTER(LANG(?childDesc)="${lang}") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en" . ?child rdfs:label ?childLabel . }
}
LIMIT 150`;

  const supUp = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX schema: <http://schema.org/>
SELECT ?child ?childLabel ?childDesc ?parent ?prop WHERE {
  {
    wd:${seedQid} wdt:P279 ?parent .
    BIND(wd:${seedQid} AS ?child)
    BIND(wdt:P279 AS ?prop)
  } UNION {
    wd:${seedQid} wdt:P361 ?parent .
    BIND(wd:${seedQid} AS ?child)
    BIND(wdt:P361 AS ?prop)
  } UNION {
    wd:${seedQid} wdt:P279 ?mid . ?mid wdt:P279 ?parent .
    BIND(?mid AS ?child)
    BIND(wdt:P279 AS ?prop)
  }
  OPTIONAL { ?child schema:description ?childDesc . FILTER(LANG(?childDesc)="${lang}") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en" . ?child rdfs:label ?childLabel . ?parent rdfs:label ?parentLabel . }
}
LIMIT 40`;

  const [downRows, upRows] = await Promise.all([
    sparql<Binding>(subDown).catch(() => []),
    sparql<Binding>(supUp).catch(() => []),
  ]);

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const seenEdge = new Set<string>();

  // Seed node always included
  nodes.set(seedQid, { id: seedQid, label: seedQid, isTarget: true, depth: 0 });

  const process = (rows: Binding[], direction: 'down' | 'up') => {
    for (const r of rows) {
      const childUri = r['child']?.value; const parentUri = r['parent']?.value;
      const childQ = childUri ? extractQId(childUri) : null;
      const parentQ = parentUri ? extractQId(parentUri) : null;
      if (!childQ || !parentQ) continue;
      const label = r['childLabel']?.value ?? childQ;
      const desc = r['childDesc']?.value;
      const propUri = r['prop']?.value ?? '';
      const property = propUri.match(/P\d+$/)?.[0];

      if (!nodes.has(childQ)) {
        nodes.set(childQ, {
          id: childQ, label, description: desc,
          depth: direction === 'down' ? 1 : -1,
        });
      } else {
        const ex = nodes.get(childQ)!;
        if (!ex.label || ex.label === ex.id) ex.label = label;
        if (!ex.description && desc) ex.description = desc;
      }
      if (!nodes.has(parentQ)) {
        nodes.set(parentQ, { id: parentQ, label: parentQ, depth: direction === 'down' ? 0 : -1 });
      }

      const eid = `${childQ}->${parentQ}:${property ?? '?'}`;
      if (!seenEdge.has(eid)) {
        seenEdge.add(eid);
        edges.push({
          id: eid,
          source: childQ,   // child is "below" in taxonomy
          target: parentQ,  // parent is "above"
          property,
          kind: 'structural',
        });
      }
    }
  };

  process(downRows, 'down');
  process(upRows, 'up');

  // Resolve any remaining unlabeled seeds via a final label-only query
  const unlabeled = [...nodes.values()].filter(n => !n.label || n.label === n.id).map(n => n.id);
  if (unlabeled.length > 0) {
    const labelQuery = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX schema: <http://schema.org/>
SELECT ?item ?itemLabel ?itemDesc WHERE {
  VALUES ?item { ${unlabeled.map(q => `wd:${q}`).join(' ')} }
  OPTIONAL { ?item schema:description ?itemDesc . FILTER(LANG(?itemDesc)="${lang}") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en" }
}`;
    const rows = await sparql<Binding>(labelQuery).catch(() => []);
    for (const r of rows) {
      const q = extractQId(r['item']?.value ?? '');
      if (!q) continue;
      const ex = nodes.get(q);
      if (!ex) continue;
      ex.label = r['itemLabel']?.value ?? ex.label;
      ex.description = ex.description ?? r['itemDesc']?.value;
    }
  }

  // Cap size: prefer direct neighbours of seed + labeled nodes
  const MAX = 50;
  let nodeList = [...nodes.values()];
  if (nodeList.length > MAX) {
    const direct = new Set<string>([seedQid]);
    for (const e of edges) {
      if (e.source === seedQid) direct.add(e.target);
      if (e.target === seedQid) direct.add(e.source);
    }
    const rest = nodeList.filter(n => !direct.has(n.id) && n.label !== n.id);
    nodeList = [...nodeList.filter(n => direct.has(n.id)), ...rest].slice(0, MAX);
    const allow = new Set(nodeList.map(n => n.id));
    return {
      nodes: nodeList,
      edges: edges.filter(e => allow.has(e.source) && allow.has(e.target)),
    };
  }

  return { nodes: nodeList, edges };
}
