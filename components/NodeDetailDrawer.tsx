'use client';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { formatMinutes } from '@/lib/graph';
import type { WloResource } from '@/lib/wlo';

/**
 * Side drawer showing rich details + matching WLO learning resources
 * for a single node. Opens when `focusedNodeId` is set in the store.
 *
 *  - Loads resources from /api/wlo on demand (once per node per session).
 *  - Shows description, test task, edge-reason, prerequisites, etc.
 *  - Resources are rendered as cards with thumbnail + title + type + "Öffnen".
 */

// Session-level cache so we don't re-fetch the same node's resources repeatedly.
const resourceCache = new Map<string, WloResource[]>();

export function NodeDetailDrawer() {
  const focusedId = useStore(s => s.focusedNodeId);
  const setFocusedId = useStore(s => s.setFocusedNodeId);
  const graph = useStore(s => s.graph);
  const baseline = useStore(s => s.baseline);
  const toggleKnown = useStore(s => s.toggleKnown);

  const node = useMemo(() => {
    if (!focusedId || !graph) return null;
    return graph.nodes.find(n => n.id === focusedId) ?? null;
  }, [focusedId, graph]);

  const edgeReason = useMemo(() => {
    if (!focusedId || !graph) return '';
    const e = graph.edges.find(x => x.from === focusedId);
    return e?.reason ?? '';
  }, [focusedId, graph]);

  const [resources, setResources] = useState<WloResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch WLO resources whenever the focused node changes (cache-first).
  useEffect(() => {
    if (!node) { setResources([]); return; }
    const cacheKey = `${node.id}::${baseline?.level ?? ''}`;
    const cached = resourceCache.get(cacheKey);
    if (cached) {
      setResources(cached);
      return;
    }
    setLoading(true);
    setFetchError(null);
    // Fire request
    fetch('/api/wlo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: node.label,
        educationLevel: node.educationLevel ?? baseline?.level,
        maxItems: 6,
      }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { resources?: WloResource[] }) => {
        const list = data.resources ?? [];
        resourceCache.set(cacheKey, list);
        setResources(list);
      })
      .catch((e: Error) => setFetchError(e.message ?? 'Fehler beim Laden'))
      .finally(() => setLoading(false));
  }, [node, baseline?.level]);

  if (!node) return null;

  return (
    <div className="no-print fixed inset-y-0 right-0 w-[420px] max-w-full bg-white border-l border-slate-200 shadow-2xl flex flex-col z-20 animate-fade-in">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-slate-500 mb-1">
            {node.isLeaf ? 'Lernschritt' : 'Cluster'}
            {node.relation === 'prerequisite' && ' · externe Voraussetzung'}
            {node.belowBaseline && ' · unter Baseline'}
          </div>
          <div className="font-semibold text-slate-900 text-lg leading-tight">{node.label}</div>
          <div className="text-xs text-slate-500 mt-1 flex gap-2">
            <span>{formatMinutes(node.estimatedMinutes)}</span>
            <span>·</span>
            <span>Schwierigkeit {node.difficulty}/5</span>
            {node.educationLevel && (
              <>
                <span>·</span>
                <span>{node.educationLevel.replace(/_/g, ' ')}</span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={() => setFocusedId(null)}
          className="text-slate-400 hover:text-slate-700 text-xl leading-none"
          aria-label="Schließen"
        >×</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4 space-y-4 text-sm">
        {node.description && (
          <section>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Beschreibung</div>
            <p className="text-slate-800 leading-relaxed">{node.description}</p>
          </section>
        )}

        {edgeReason && (
          <section>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Warum nötig</div>
            <p className="text-slate-800 leading-relaxed">{edgeReason}</p>
          </section>
        )}

        {node.testTask && (
          <section>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Prüfaufgabe</div>
            <p className="text-slate-800 leading-relaxed italic">{node.testTask}</p>
          </section>
        )}

        {/* WLO resources */}
        <section>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Lernmaterialien aus WirLernenOnline
          </div>
          {loading && <div className="text-xs text-slate-500 italic">Suche bei WLO …</div>}
          {!loading && fetchError && (
            <div className="text-xs text-red-600 italic">{fetchError}</div>
          )}
          {!loading && !fetchError && resources.length === 0 && (
            <div className="text-xs text-slate-500 italic">
              Keine passenden Ressourcen gefunden — versuche es mit einem allgemeineren Begriff.
            </div>
          )}
          {!loading && resources.length > 0 && (
            <ul className="space-y-2">
              {resources.map(r => (
                <li key={r.id} className="border border-slate-200 rounded-lg p-2 flex gap-3 hover:border-brand-300 hover:bg-brand-50/40 transition">
                  {r.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.previewUrl}
                      alt=""
                      className="w-16 h-16 object-cover rounded bg-slate-100 flex-shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-slate-100 rounded flex-shrink-0 flex items-center justify-center text-slate-400 text-xs">WLO</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <a
                      href={r.renderUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-brand-700 hover:text-brand-900 text-sm line-clamp-2"
                    >
                      {r.title}
                    </a>
                    {r.resourceType && (
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-0.5">
                        {r.resourceType.replace(/^.*\//, '').replace(/_/g, ' ')}
                      </div>
                    )}
                    {r.description && (
                      <div className="text-xs text-slate-500 line-clamp-2 mt-0.5">{r.description}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Footer actions */}
      {node.isLeaf && !node.isTarget && (
        <div className="p-3 border-t border-slate-200 flex gap-2">
          <button
            onClick={() => { toggleKnown(node.id); }}
            className={
              'flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ' +
              (node.known
                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                : 'bg-brand-600 text-white hover:bg-brand-700')
            }
          >
            {node.known ? '✓ Kann ich bereits' : 'Als bekannt markieren'}
          </button>
        </div>
      )}
    </div>
  );
}
