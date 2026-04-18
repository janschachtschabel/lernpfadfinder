'use client';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { GraphCanvas } from './GraphCanvas';
import { TreeView } from './TreeView';
import { computeLearningPath, totalMinutes, formatMinutes } from '@/lib/graph';
import { speak } from './VoiceButton';
import { EDUCATION_LEVELS } from '@/lib/types';
import type { EducationLevel, Topic, TopicEdge } from '@/lib/types';
import { PathSummaryCard } from './PathSummaryCard';
import { NodeDetailDrawer } from './NodeDetailDrawer';
import { PrintView } from './PrintView';

type ViewMode = 'graph' | 'tree';

/**
 * Fetches a short LLM-generated path briefing and stores it in the zustand store.
 * No-ops when store isn't ready yet; errors are swallowed (briefing is purely additive).
 */
async function fetchPathSummary() {
  const s = useStore.getState();
  if (!s.graph || !s.target) return;
  try {
    const res = await fetch('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: s.graph,
        baseline: s.baseline,
        path: s.path,
        targetLabel: s.target.label,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data && (data.summary || data.biggestChunks || data.criticalPrereqs || data.fit)) {
      useStore.getState().setSummary({
        summary: data.summary ?? '',
        biggestChunks: data.biggestChunks ?? '',
        criticalPrereqs: data.criticalPrereqs ?? '',
        fit: data.fit ?? '',
      });
    }
  } catch {
    /* briefing is optional — fail silently */
  }
}

export function GraphView() {
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const phase = useStore(s => s.phase);
  const setPhase = useStore(s => s.setPhase);
  const target = useStore(s => s.target);
  const baseline = useStore(s => s.baseline);
  const graph = useStore(s => s.graph);
  const resetGraph = useStore(s => s.resetGraph);
  const upsertNode = useStore(s => s.upsertNode);
  const upsertEdge = useStore(s => s.upsertEdge);
  const status = useStore(s => s.status);
  const setStatus = useStore(s => s.setStatus);
  const error = useStore(s => s.error);
  const setError = useStore(s => s.setError);
  const setPath = useStore(s => s.setPath);

  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (phase !== 'generating' || !target || !baseline) return;
    const key = `${target.label}|${target.field}|${baseline.level}|${baseline.prior}`;
    if (fetchedFor.current === key) return;
    fetchedFor.current = key;

    (async () => {
      setError(null);
      // Placeholder target id so the graph store is ready
      resetGraph('__pending__');
      setStatus(`Starte Analyse für „${target.label}“ …`);
      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: target.label,
            description: target.description,
            field: target.field,
            baseline,
            maxDepth: 4,
          }),
        });
        if (!res.ok || !res.body) {
          const t = await res.text().catch(() => '');
          throw new Error(t || `Fehler ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          for (const evt of events) handleEvent(evt);
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(String(e?.message ?? e));
      }
    })();

    function handleEvent(raw: string) {
      const lines = raw.split('\n');
      const type = lines.find(l => l.startsWith('event:'))?.slice(6).trim();
      const dataLine = lines.find(l => l.startsWith('data:'))?.slice(5).trim();
      if (!type || !dataLine) return;
      let data: any;
      try { data = JSON.parse(dataLine); } catch { return; }
      if (type === 'status') setStatus(data.message);
      else if (type === 'node') {
        const n: Topic = data.node;
        // On first node (the target), replace the pending targetId in the store
        if (n.isTarget) {
          useStore.setState({ graph: { targetId: n.id, nodes: [n], edges: [] } });
        } else {
          upsertNode(n);
        }
      }
      else if (type === 'edge') upsertEdge(data.edge as TopicEdge);
      else if (type === 'error') setError(data.message);
      else if (type === 'done') {
        // Dedup + cycle-break, then compute initial path and jump to explore.
        const { merged } = useStore.getState().finalizeGraph();
        const g = useStore.getState().graph;
        if (g) {
          const p = computeLearningPath(g);
          setPath(p);
        }
        setStatus(merged > 0
          ? `Lernpfad erzeugt (${merged} doppelte Voraussetzungen zusammengeführt).`
          : 'Lernpfad erzeugt.');
        // Kick off path briefing generation in the background (D1).
        fetchPathSummary();
        setTimeout(() => setPhase('explore'), 300);
      }
    }

  }, [phase, target, baseline]);

  const recomputePath = () => {
    if (!graph) return;
    const p = computeLearningPath(graph);
    setPath(p);
    setPhase('path');
    const firstId = p[0];
    const first = graph.nodes.find(n => n.id === firstId)?.label;
    if (first) speak(`Dein Lernpfad beginnt bei ${first}.`);
  };

  return (
    <div className="h-screen flex flex-col">
      <Header viewMode={viewMode} setViewMode={setViewMode} />
      <div className="no-print flex-1 relative overflow-hidden">
        {viewMode === 'graph'
          ? <GraphCanvas interactive={phase === 'explore' || phase === 'path'} />
          : <TreeView interactive={phase === 'explore' || phase === 'path'} />
        }
        {viewMode === 'graph' && <Legend />}
        {phase === 'generating' && <PhaseHint title="Lernpfad wird erzeugt" text={status || 'Das LLM zerlegt dein Thema …'} />}
        {phase === 'explore' && <ExplorePanel onCompute={recomputePath} />}
        {phase === 'path' && <PathPanel />}
        {(phase === 'explore' || phase === 'path') && <NodeDetailDrawer />}
      </div>
      <PrintView />
      {error && (
        <div className="no-print bg-red-50 border-t border-red-200 text-red-700 px-4 py-2 text-sm">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

function Header({ viewMode, setViewMode }: { viewMode: ViewMode; setViewMode: (m: ViewMode) => void }) {
  const target = useStore(s => s.target);
  const baseline = useStore(s => s.baseline);
  const setPhase = useStore(s => s.setPhase);
  const phase = useStore(s => s.phase);
  const steps: Array<{ k: any; label: string }> = [
    { k: 'generating', label: '1 · Erzeugen' },
    { k: 'explore', label: '2 · Vorwissen' },
    { k: 'path', label: '3 · Lernpfad' },
  ];
  const idx = steps.findIndex(s => s.k === phase);
  return (
    <header className="no-print bg-white border-b border-brand-100 px-4 py-3 flex items-center gap-4 shadow-sm">
      <button
        onClick={() => {
          // Full reset so persistence doesn't re-save the old graph.
          useStore.setState({
            phase: 'welcome',
            target: null,
            baseline: null,
            graph: null,
            path: [],
            summary: null,
            candidates: [],
            status: '',
            error: null,
          });
        }}
        className="text-brand-600 hover:text-brand-800 text-sm font-medium"
      >
        ← Neues Thema
      </button>
      <h1 className="font-semibold text-slate-900">
        Lernziel: <span className="text-brand-700">{target?.label}</span>
        {target?.field && <span className="ml-2 text-xs text-slate-500">· {target.field}</span>}
      </h1>
      {baseline && (
        <span className="text-xs text-slate-500 bg-slate-100 rounded px-2 py-0.5">
          {baseline.level} · {baseline.prior}
        </span>
      )}
      <div className="flex-1" />
      <div className="flex rounded-md border border-brand-200 overflow-hidden text-xs" role="tablist" aria-label="Ansicht">
        <button
          onClick={() => setViewMode('tree')}
          className={'px-3 py-1 ' + (viewMode === 'tree' ? 'bg-brand-600 text-white' : 'bg-white text-brand-700 hover:bg-brand-50')}
          role="tab" aria-selected={viewMode === 'tree'}
        >🗂 Baum</button>
        <button
          onClick={() => setViewMode('graph')}
          className={'px-3 py-1 ' + (viewMode === 'graph' ? 'bg-brand-600 text-white' : 'bg-white text-brand-700 hover:bg-brand-50')}
          role="tab" aria-selected={viewMode === 'graph'}
        >🕸 Graph</button>
      </div>
      <nav className="flex gap-2 text-xs">
        {steps.map((s, i) => (
          <span key={s.k} className={
            'px-2 py-1 rounded-full ' +
            (i === idx ? 'bg-brand-600 text-white' :
             i < idx ? 'bg-brand-100 text-brand-800' : 'bg-slate-100 text-slate-400')
          }>{s.label}</span>
        ))}
      </nav>
    </header>
  );
}

function Legend() {
  return (
    <div className="no-print absolute bottom-4 left-4 bg-white/90 backdrop-blur rounded-lg shadow border border-brand-100 p-3 text-xs space-y-1">
      <div className="font-semibold text-slate-700 mb-1">Legende</div>
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#ede9fe', border: '2px solid #6a3fed' }}></span> Lernziel</div>
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#fef3c7', border: '2px solid #d97706' }}></span> Cluster (noch zerlegbar)</div>
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#fde68a', border: '2px solid #d97706' }}></span> Großer Lernschritt (&gt; 6 h)</div>
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#dbeafe', border: '2px solid #3b82f6' }}></span> Mittlerer Lernschritt (1,5 – 6 h)</div>
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#ecfdf5', border: '2px solid #10b981' }}></span> Kleiner Lernschritt (&lt; 1,5 h)</div>
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#fff', border: '2px dashed #d97706' }}></span> Externe Voraussetzung</div>
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#f1f5f9', border: '2px dashed #94a3b8' }}></span> Unter Baseline</div>
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-emerald-200 border-2 border-emerald-500"></span> Schon bekannt (Haken ✓)</div>
      <div className="mt-2 pt-2 border-t border-slate-200 text-slate-500">●●○○○ = Schwierigkeit</div>
    </div>
  );
}

function PhaseHint({ title, text }: { title: string; text: string }) {
  const graph = useStore(s => s.graph);
  return (
    <div className="no-print absolute top-4 right-4 bg-white/95 backdrop-blur rounded-lg shadow border border-brand-100 px-4 py-3 max-w-sm">
      <div className="text-xs font-semibold text-brand-700">{title}</div>
      <div className="text-sm text-slate-700 mt-1">{text}</div>
      {graph && (
        <div className="text-xs text-slate-500 mt-2">
          {graph.nodes.length} Knoten · {graph.edges.length} Kanten
        </div>
      )}
    </div>
  );
}

function ExplorePanel({ onCompute }: { onCompute: () => void }) {
  const graph = useStore(s => s.graph);
  const path = useStore(s => s.path);
  const setKnown = useStore(s => s.setKnown);
  if (!graph) return null;

  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const leaves = graph.nodes.filter(n => n.isLeaf && !n.isTarget);
  const knownCount = leaves.filter(n => n.known || n.belowBaseline).length;
  const remaining = leaves.filter(n => !n.known && !n.belowBaseline);
  const estTotal = remaining.reduce((s, n) => s + n.estimatedMinutes, 0);
  // Die ersten 3 aktiven Schritte nach aktueller Lernreihenfolge — als „nächste Schritte"-Teaser.
  const nextThree = path
    .map(id => byId.get(id))
    .filter((n): n is NonNullable<typeof n> => !!n && n.isLeaf && !n.isTarget && !n.known && !n.belowBaseline)
    .slice(0, 3);

  // Welche Stufen kommen im Baum tatsächlich vor?
  const levelsPresent = new Map<EducationLevel, { total: number; known: number }>();
  for (const n of leaves) {
    if (!n.educationLevel) continue;
    const e = levelsPresent.get(n.educationLevel) ?? { total: 0, known: 0 };
    e.total += 1;
    if (n.known || n.belowBaseline) e.known += 1;
    levelsPresent.set(n.educationLevel, e);
  }
  const levelOrder = EDUCATION_LEVELS.filter(l => levelsPresent.has(l.value));

  const markLevel = (lvl: EducationLevel, known: boolean) => {
    const ids = leaves
      .filter(n => n.educationLevel === lvl && !n.belowBaseline)
      .map(n => n.id);
    if (ids.length > 0) setKnown(ids, known);
  };

  return (
    <div className="no-print absolute top-4 right-4 bottom-4 w-96 bg-white/95 backdrop-blur rounded-lg shadow-lg border border-brand-100 flex flex-col">
      <div className="p-4 border-b border-brand-100">
        <div className="text-xs font-semibold text-brand-700 mb-1">Schritt 2 – Dein Vorwissen</div>
        <PathSummaryCard compact />
        <p className="text-sm text-slate-700">
          Klicke Boxen, die du schon beherrschst — ein grüner Haken erscheint.
          Ein Klick auf einen <b>Cluster</b> markiert den ganzen Teilbaum.
        </p>
        <div className="mt-3 space-y-1 text-xs text-slate-600">
          <div>{leaves.length} atomare Schritte im Baum</div>
          <div>{knownCount} bekannt / unter Baseline</div>
          <div>{remaining.length} Schritte offen · ca. <b>{formatMinutes(estTotal)}</b> Lernzeit</div>
        </div>
      </div>

      {/* Massen-Markierung nach Bildungsstufe */}
      {levelOrder.length > 0 && (
        <div className="p-4 border-b border-brand-100 overflow-auto">
          <div className="text-xs font-semibold text-slate-700 mb-2">
            Wissen aus diesen Stufen beherrsche ich bereits:
          </div>
          <div className="text-[11px] text-slate-500 mb-2">
            Klick setzt alle Schritte dieser Stufe auf „bekannt"; nochmal klicken macht es rückgängig.
          </div>
          <div className="space-y-1">
            {levelOrder.map(l => {
              const stats = levelsPresent.get(l.value)!;
              const allKnown = stats.known >= stats.total;
              return (
                <div key={l.value} className="flex items-center gap-2">
                  <button
                    onClick={() => markLevel(l.value, !allKnown)}
                    className={
                      'flex-1 text-left px-2 py-1.5 rounded border text-xs flex items-center justify-between ' +
                      (allKnown
                        ? 'bg-emerald-50 border-emerald-400 text-emerald-800'
                        : 'bg-white border-slate-200 hover:border-brand-300')
                    }
                  >
                    <span>
                      <span className={
                        'inline-block w-3.5 h-3.5 rounded border mr-2 align-middle text-[9px] text-center leading-[12px] ' +
                        (allKnown ? 'bg-emerald-500 border-emerald-600 text-white' : 'bg-white border-slate-300 text-transparent')
                      }>✓</span>
                      <b>{l.title}</b>
                      <span className="text-slate-500 ml-1">{l.hint}</span>
                    </span>
                    <span className="text-[10px] text-slate-500 ml-2 whitespace-nowrap">
                      {stats.known}/{stats.total}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 border-t border-brand-100">
        <div className="text-xs font-semibold text-slate-700 mb-2">
          Deine nächsten 3 Schritte
        </div>
        {nextThree.length === 0 ? (
          <div className="text-xs text-slate-500 italic">
            Super — aktuell sind keine offenen Schritte übrig. Klick auf „Lernpfad anzeigen" für den vollständigen Pfad.
          </div>
        ) : (
          <ol className="space-y-2 text-xs">
            {nextThree.map((n, i) => (
              <li key={n.id} className="flex gap-2">
                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {i + 1}
                </div>
                <div>
                  <div className="font-medium text-slate-900">{n.label}</div>
                  {n.description && <div className="text-slate-500 line-clamp-2">{n.description}</div>}
                  <div className="text-[10px] text-slate-400 mt-0.5">{formatMinutes(n.estimatedMinutes)} · Schwierigkeit {n.difficulty}/5</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="p-4 border-t border-brand-100">
        <button
          onClick={onCompute}
          className="w-full px-4 py-3 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700"
        >
          Lernpfad anzeigen →
        </button>
      </div>
    </div>
  );
}

function PathPanel() {
  const path = useStore(s => s.path);
  const graph = useStore(s => s.graph);
  const setPhase = useStore(s => s.setPhase);
  if (!graph) return null;
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const total = totalMinutes(graph, path);

  return (
    <div className="no-print absolute top-4 right-4 bottom-4 w-96 bg-white/95 backdrop-blur rounded-lg shadow-lg border border-brand-100 flex flex-col">
      <div className="p-4 border-b border-brand-100">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-xs font-semibold text-brand-700">Schritt 3 – Dein Lernpfad</div>
            <div className="text-sm text-slate-700">{path.length} Schritte · {formatMinutes(total)}</div>
          </div>
          <button onClick={() => window.print()} className="text-xs px-2 py-1 bg-brand-100 rounded hover:bg-brand-200">🖨 Drucken</button>
        </div>
        <PathSummaryCard />
      </div>
      <ol className="p-4 flex-1 overflow-auto space-y-2">
        {path.map((id, i) => {
          const n = byId.get(id); if (!n) return null;
          const isGoal = n.isTarget;
          return (
            <li key={id} className={'flex gap-3 ' + (isGoal ? 'pt-3 mt-2 border-t-2 border-dashed border-brand-300' : '')}>
              <div className={
                'flex-shrink-0 w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center ' +
                (isGoal ? 'bg-brand-700 text-white ring-2 ring-brand-300' : 'bg-brand-600 text-white')
              }>
                {isGoal ? '★' : i + 1}
              </div>
              <div className="flex-1">
                <div className="font-medium text-slate-900">
                  {n.label}
                  {isGoal && <span className="ml-2 text-xs font-normal text-brand-700">Lernziel erreicht</span>}
                </div>
                {n.description && <div className="text-xs text-slate-500">{n.description}</div>}
                {n.testTask && <div className="text-xs italic text-slate-400 mt-0.5">Prüfaufgabe: {n.testTask}</div>}
                <div className="text-[10px] text-slate-400 mt-0.5 flex gap-2">
                  <span>Schwierigkeit: {n.difficulty}/5</span>
                  <span>·</span>
                  <span>{formatMinutes(n.estimatedMinutes)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="p-3 border-t border-brand-100">
        <button onClick={() => setPhase('explore')} className="text-xs text-brand-700 hover:text-brand-900">← Vorwissen anpassen</button>
      </div>
    </div>
  );
}
