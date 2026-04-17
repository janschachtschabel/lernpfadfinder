'use client';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useStore } from '@/lib/store';
import { GraphCanvas } from './GraphCanvas';
import { computeLearningPath } from '@/lib/graph';
import { VoiceButton, speak } from './VoiceButton';
import type { Graph } from '@/lib/types';

/** Phases: graph (Wikidata fetch) -> didactic (LLM) -> knowledge (user marks) -> path (result). */
export function GraphView() {
  const phase = useStore(s => s.phase);
  const setPhase = useStore(s => s.setPhase);
  const target = useStore(s => s.target);
  const graph = useStore(s => s.graph);
  const addNodesEdges = useStore(s => s.addNodesEdges);
  const resetGraph = useStore(s => s.resetGraph);
  const classifyNode = useStore(s => s.classifyNode);
  const classifyEdge = useStore(s => s.classifyEdge);
  const status = useStore(s => s.status);
  const setStatus = useStore(s => s.setStatus);
  const error = useStore(s => s.error);
  const setError = useStore(s => s.setError);
  const setKnown = useStore(s => s.setKnown);
  const setPath = useStore(s => s.setPath);
  const path = useStore(s => s.path);

  const fetchedFor = useRef<string | null>(null);

  // Phase 1: fetch Wikidata graph
  useEffect(() => {
    if (phase !== 'graph' || !target) return;
    if (fetchedFor.current === target.id) return;
    fetchedFor.current = target.id;
    (async () => {
      resetGraph();
      setError(null);
      setStatus(`Lade Wikidata-Struktur für ${target.label} …`);
      try {
        // Seed node first (immediate feedback)
        addNodesEdges([{ id: target.id, label: target.label, description: target.description, isTarget: true, depth: 0 }], []);
        const res = await fetch(`/api/wikidata?qid=${target.id}`);
        const json = await res.json() as Graph & { error?: string };
        if (!res.ok) throw new Error(json.error ?? 'Wikidata-Abfrage fehlgeschlagen');

        // Gradually reveal nodes for a nice animation
        const nodes = json.nodes.filter(n => n.id !== target.id);
        const edges = json.edges;
        const chunk = 4;
        for (let i = 0; i < nodes.length; i += chunk) {
          const slice = nodes.slice(i, i + chunk);
          const sliceIds = new Set(slice.map(n => n.id));
          const relatedEdges = edges.filter(e =>
            sliceIds.has(e.source) || sliceIds.has(e.target));
          addNodesEdges(slice, relatedEdges);
          setStatus(`${Math.min(i + chunk, nodes.length)} / ${nodes.length} Themen geladen …`);
          await new Promise(r => setTimeout(r, 120));
        }
        addNodesEdges([], edges); // ensure all edges added
        setStatus(`${json.nodes.length} Themen aus Wikidata geladen.`);
        // Auto-continue to didactic phase
        setTimeout(() => setPhase('didactic'), 600);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    })();
  }, [phase, target]);

  // Phase 2: LLM edge+node classification via SSE
  useEffect(() => {
    if (phase !== 'didactic' || !target) return;
    let cancelled = false;
    (async () => {
      setStatus('Didaktische Analyse läuft …');
      try {
        const res = await fetch('/api/didactic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graph, targetQid: target.id }),
        });
        if (!res.body) throw new Error('Kein Response-Stream');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          for (const evt of events) {
            const lines = evt.split('\n');
            const type = lines.find(l => l.startsWith('event:'))?.slice(7).trim();
            const dataLine = lines.find(l => l.startsWith('data:'))?.slice(5).trim();
            if (!type || !dataLine) continue;
            const data = JSON.parse(dataLine);
            if (type === 'status') setStatus(data.message);
            else if (type === 'node') classifyNode(data.id, data.kind);
            else if (type === 'edge') classifyEdge(data.id, data.kind, data.reason);
            else if (type === 'error') setError(data.message);
            else if (type === 'done') {
              setStatus('Didaktische Analyse abgeschlossen.');
              setTimeout(() => setPhase('knowledge'), 500);
            }
          }
        }
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    })();
    return () => { cancelled = true; };
  }, [phase, target]);

  // Phase 3 -> compute path when requested
  const computePath = () => {
    if (!target) return;
    const known = new Set(graph.nodes.filter(n => n.known).map(n => n.id));
    const p = computeLearningPath(graph, target.id, known);
    setPath(p);
    setPhase('path');
    const first = graph.nodes.find(n => n.id === p[0])?.label;
    if (first) speak(`Dein Lernpfad startet bei ${first}.`);
  };

  return (
    <div className="h-screen flex flex-col">
      <Header />
      <div className="flex-1 relative">
        <GraphCanvas interactive={phase === 'knowledge' || phase === 'path'} />
        <Legend />
        {phase === 'graph' && <PhaseHint title="Phase 1 – Wikidata-Struktur" text={status} />}
        {phase === 'didactic' && <PhaseHint title="Phase 2 – Didaktische Verknüpfungen" text={status} />}
        {phase === 'knowledge' && <KnowledgePanel onCompute={computePath} />}
        {phase === 'path' && <PathPanel />}
      </div>
      {error && (
        <div className="no-print bg-red-50 border-t border-red-200 text-red-700 px-4 py-2 text-sm">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

function Header() {
  const target = useStore(s => s.target);
  const setPhase = useStore(s => s.setPhase);
  const phase = useStore(s => s.phase);
  const steps: Array<{ k: any; label: string }> = [
    { k: 'graph', label: '1 · Struktur' },
    { k: 'didactic', label: '2 · Didaktik' },
    { k: 'knowledge', label: '3 · Vorwissen' },
    { k: 'path', label: '4 · Lernpfad' },
  ];
  const idx = steps.findIndex(s => s.k === phase);
  return (
    <header className="no-print bg-white border-b border-brand-100 px-4 py-3 flex items-center gap-4 shadow-sm">
      <button onClick={() => setPhase('welcome')} className="text-brand-600 hover:text-brand-800 text-sm font-medium">
        ← Neues Thema
      </button>
      <h1 className="font-semibold text-slate-900">
        Lernpfadfinder: <span className="text-brand-700">{target?.label}</span>
        <span className="ml-2 text-xs text-slate-400">{target?.id}</span>
      </h1>
      <div className="flex-1"></div>
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
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-brand-600"></span> Lernziel</div>
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#fef3c7', border: '2px solid #f59e0b' }}></span> Voraussetzung</div>
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#dbeafe', border: '2px solid #3b82f6' }}></span> Kern</div>
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#fce7f3', border: '2px solid #ec4899' }}></span> Vertiefung</div>
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-emerald-200 border-2 border-emerald-500"></span> Schon bekannt</div>
    </div>
  );
}

function PhaseHint({ title, text }: { title: string; text: string }) {
  return (
    <div className="no-print absolute top-4 right-4 bg-white/90 backdrop-blur rounded-lg shadow border border-brand-100 px-4 py-3 max-w-sm">
      <div className="text-xs font-semibold text-brand-700">{title}</div>
      <div className="text-sm text-slate-700 mt-1">{text}</div>
    </div>
  );
}

function KnowledgePanel({ onCompute }: { onCompute: () => void }) {
  const graph = useStore(s => s.graph);
  const setKnown = useStore(s => s.setKnown);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const parse = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/parse-knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, graph }),
      });
      const json = await res.json();
      if (json.knownIds?.length) setKnown(json.knownIds, true);
      setText('');
    } finally {
      setLoading(false);
    }
  };

  const knownCount = graph.nodes.filter(n => n.known).length;

  return (
    <div className="no-print absolute top-4 right-4 bottom-4 w-80 bg-white/95 backdrop-blur rounded-lg shadow-lg border border-brand-100 flex flex-col">
      <div className="p-4 border-b border-brand-100">
        <div className="text-xs font-semibold text-brand-700 mb-1">Phase 3 – Dein Vorwissen</div>
        <p className="text-sm text-slate-700">
          Klicke Themen im Graph an, die du schon kannst – oder beschreibe dein Wissen im Feld unten.
        </p>
        <div className="mt-2 text-xs text-slate-500">{knownCount} Themen als bekannt markiert</div>
      </div>
      <div className="p-4 flex-1 flex flex-col gap-2">
        <div className="flex gap-1 items-start">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="z. B. Ich kenne mich mit Wellenoptik gut aus und habe schon Beugung gemacht."
            className="flex-1 border border-slate-200 rounded-lg p-2 text-sm resize-none focus:border-brand-400 focus:outline-none"
          />
          <VoiceButton className="w-10 h-10" onTranscript={(t) => setText((prev) => (prev + ' ' + t).trim())} />
        </div>
        <button
          onClick={parse}
          disabled={loading || !text.trim()}
          className="px-3 py-2 rounded-lg bg-brand-100 text-brand-800 hover:bg-brand-200 text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Analysiere …' : 'Vorwissen erkennen'}
        </button>
      </div>
      <div className="p-4 border-t border-brand-100">
        <button
          onClick={onCompute}
          className="w-full px-4 py-3 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700"
        >
          Lernpfad berechnen →
        </button>
      </div>
    </div>
  );
}

function PathPanel() {
  const path = useStore(s => s.path);
  const graph = useStore(s => s.graph);
  const setPhase = useStore(s => s.setPhase);
  const pathNodes = path.map(id => graph.nodes.find(n => n.id === id)).filter(Boolean);

  return (
    <div className="no-print absolute top-4 right-4 bottom-4 w-96 bg-white/95 backdrop-blur rounded-lg shadow-lg border border-brand-100 flex flex-col">
      <div className="p-4 border-b border-brand-100 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-brand-700">Phase 4 – Dein Lernpfad</div>
          <div className="text-sm text-slate-700">{pathNodes.length} Schritte</div>
        </div>
        <button onClick={() => window.print()} className="text-xs px-2 py-1 bg-brand-100 rounded hover:bg-brand-200">🖨 Drucken</button>
      </div>
      <ol className="p-4 flex-1 overflow-auto space-y-2">
        {pathNodes.map((n, i) => n && (
          <li key={n.id} className="flex gap-3">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">
              {i + 1}
            </div>
            <div className="flex-1">
              <div className="font-medium text-slate-900">{n.label}</div>
              {n.description && <div className="text-xs text-slate-500">{n.description}</div>}
              <div className="text-[10px] text-slate-400 mt-0.5">
                <a href={`https://www.wikidata.org/wiki/${n.id}`} target="_blank" rel="noreferrer" className="hover:text-brand-600">{n.id}</a>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="p-3 border-t border-brand-100">
        <button onClick={() => setPhase('knowledge')} className="text-xs text-brand-700 hover:text-brand-900">← Vorwissen anpassen</button>
      </div>
    </div>
  );
}
