'use client';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { formatMinutes, totalMinutes } from '@/lib/graph';
import type { Topic } from '@/lib/types';
import type { WloResource } from '@/lib/wlo';

/**
 * Print-only learning-path briefing. Hidden on screen (`.print-only`),
 * shown when the user hits Cmd/Ctrl-P or the explicit "Drucken"-Button.
 *
 * Layout (in this order):
 *   1. Kopf mit Lernziel + Baseline
 *   2. Steckbrief-Text (LLM)
 *   3. Deine nächsten 3 Schritte — je Schritt: Beschreibung, Prüfaufgabe,
 *      2-3 WLO-Materialien mit Titel + Typ + Link
 *   4. Weitere offene Schritte — kompakt mit Beschreibung und Prüfaufgabe
 *   5. Bereits bekannt / übersprungen — reine Liste (zur Vollständigkeit)
 */

const MAX_MATERIALS_PER_NEXT_STEP = 3;

export function PrintView() {
  const phase = useStore(s => s.phase);
  const graph = useStore(s => s.graph);
  const path = useStore(s => s.path);
  const target = useStore(s => s.target);
  const baseline = useStore(s => s.baseline);
  const summary = useStore(s => s.summary);

  // For the next-3 active leaves: pre-fetch WLO resources so they're available when printing.
  const nextThreeIds = (() => {
    if (!graph) return [] as string[];
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    return path
      .map(id => byId.get(id))
      .filter((n): n is Topic => !!n && n.isLeaf && !n.isTarget && !n.known && !n.belowBaseline)
      .slice(0, 3)
      .map(n => n.id);
  })();
  const [resourcesById, setResourcesById] = useState<Record<string, WloResource[]>>({});

  useEffect(() => {
    if (phase !== 'path' || !graph) return;
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    nextThreeIds.forEach((id) => {
      if (resourcesById[id]) return;
      const node = byId.get(id);
      if (!node) return;
      fetch('/api/wlo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: node.label,
          educationLevel: node.educationLevel ?? baseline?.level,
          maxItems: 4,
        }),
      })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
        .then((data: { resources?: WloResource[] }) => {
          setResourcesById(prev => ({ ...prev, [id]: data.resources ?? [] }));
        })
        .catch(() => {
          setResourcesById(prev => ({ ...prev, [id]: [] }));
        });
    });
    // we intentionally only re-run when the path or phase changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, path.join('|')]);

  if (!graph || !target) return null;
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const total = totalMinutes(graph, path);

  // Split the path into "next 3 open leaves" + "further open leaves" + "already
  // known / skipped" — so the print layout can emphasise what comes next.
  const pathNodes = path.map(id => byId.get(id)).filter((n): n is Topic => !!n);
  const openLeaves = pathNodes.filter(n => n.isLeaf && !n.isTarget && !n.known && !n.belowBaseline);
  const nextSteps = openLeaves.slice(0, 3);
  const furtherOpen = openLeaves.slice(3);
  const doneOrSkipped = pathNodes.filter(n => n.isLeaf && !n.isTarget && (n.known || n.belowBaseline));
  const targetNode = pathNodes.find(n => n.isTarget) ?? null;

  const fmtType = (t?: string) =>
    t ? t.replace(/^.*[\/#]/, '').replace(/_/g, ' ') : '';

  return (
    <div className="print-only text-slate-900">
      <style>{`
        @page { size: A4; margin: 18mm 16mm; }
        .print-only { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 11pt; line-height: 1.45; color: #111; }
        .print-only h1 { font-size: 20pt; font-weight: 800; letter-spacing: -0.01em; margin: 0; }
        .print-only h2 { font-size: 13pt; font-weight: 700; color: #4f46e5; margin: 18pt 0 6pt 0; border-bottom: 1px solid #cbd5e1; padding-bottom: 3pt; }
        .print-only h3 { font-size: 12pt; font-weight: 700; margin: 0; }
        .print-only .meta-row { color: #475569; font-size: 10pt; }
        .print-only .step { break-inside: avoid; margin-bottom: 14pt; padding: 8pt 10pt; border: 1px solid #e2e8f0; border-radius: 6pt; }
        .print-only .step-head { display: flex; align-items: baseline; gap: 8pt; }
        .print-only .step-num { flex: 0 0 auto; font-weight: 800; color: #4f46e5; min-width: 22pt; }
        .print-only .chips { display: inline-flex; gap: 6pt; font-size: 9pt; color: #475569; margin-left: 8pt; font-weight: 400; }
        .print-only .note-label { font-weight: 700; color: #334155; }
        .print-only .mat-list { list-style: none; padding: 0; margin: 6pt 0 0 0; }
        .print-only .mat-item { break-inside: avoid; border-left: 2pt solid #c7d2fe; padding: 3pt 0 3pt 8pt; margin-bottom: 6pt; }
        .print-only .mat-url { color: #475569; font-size: 8.5pt; word-break: break-all; }
        .print-only .done-list li { color: #475569; }
      `}</style>

      <header style={{ borderBottom: '2px solid #4f46e5', paddingBottom: '8pt' }}>
        <div style={{ fontSize: '9pt', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#4f46e5', fontWeight: 700 }}>
          Dein Lernpfadfinder
        </div>
        <h1>{target.label}</h1>
        <div className="meta-row" style={{ marginTop: '4pt' }}>
          {pathNodes.length} Schritte · Gesamtaufwand ca. <b>{formatMinutes(total)}</b>
          {baseline && <> · Bildungsstufe: {baseline.level.replace(/_/g, ' ')}</>}
          {baseline?.purpose && <> · Anlass: {baseline.purpose.replace(/_/g, ' ')}</>}
          {baseline?.hoursPerWeek && <> · {baseline.hoursPerWeek} h/Woche</>}
          {baseline?.deadline && <> · Deadline: {baseline.deadline}</>}
        </div>
        {baseline?.prior && (
          <div className="meta-row" style={{ marginTop: '3pt', fontStyle: 'italic' }}>
            Vorwissen: „{baseline.prior}"
          </div>
        )}
      </header>

      {/* 1) STECKBRIEF */}
      {summary && (summary.summary || summary.biggestChunks || summary.criticalPrereqs || summary.fit) && (
        <section style={{ breakInside: 'avoid', marginTop: '14pt', background: '#f8fafc', padding: '10pt 12pt', borderLeft: '3pt solid #4f46e5', borderRadius: '4pt' }}>
          <h2 style={{ marginTop: 0, border: 'none', color: '#4f46e5' }}>Steckbrief</h2>
          {summary.summary && <p style={{ margin: '0 0 6pt 0' }}>{summary.summary}</p>}
          {summary.biggestChunks && (
            <p style={{ margin: '0 0 4pt 0' }}><span className="note-label">Größter Aufwand:</span> {summary.biggestChunks}</p>
          )}
          {summary.criticalPrereqs && (
            <p style={{ margin: '0 0 4pt 0' }}><span className="note-label">Nicht weglassen:</span> {summary.criticalPrereqs}</p>
          )}
          {summary.fit && (
            <p style={{ margin: 0 }}><span className="note-label">Zeitpassung:</span> {summary.fit}</p>
          )}
        </section>
      )}

      {/* 2) NÄCHSTE SCHRITTE */}
      {nextSteps.length > 0 && (
        <section>
          <h2>Deine nächsten {nextSteps.length} Schritte</h2>
          <p className="meta-row" style={{ margin: '0 0 8pt 0' }}>
            Beginne hier. Zu jedem Schritt findest du unten 2–3 konkrete Lernmaterialien von WirLernenOnline.
          </p>
          {nextSteps.map((n, idx) => {
            const res = (resourcesById[n.id] ?? []).slice(0, MAX_MATERIALS_PER_NEXT_STEP);
            const resState = resourcesById[n.id];
            return (
              <div key={n.id} className="step">
                <div className="step-head">
                  <span className="step-num">{idx + 1}.</span>
                  <h3 style={{ flex: 1 }}>
                    {n.label}
                    <span className="chips">
                      <span>⏱ {formatMinutes(n.estimatedMinutes)}</span>
                      <span>·</span>
                      <span>Schwierigkeit {n.difficulty}/5</span>
                      {n.educationLevel && <><span>·</span><span>{n.educationLevel.replace(/_/g, ' ')}</span></>}
                    </span>
                  </h3>
                </div>
                {n.description && (
                  <p style={{ margin: '6pt 0 4pt 0' }}>{n.description}</p>
                )}
                {n.testTask && (
                  <p style={{ margin: '4pt 0', background: '#fef9c3', padding: '4pt 6pt', borderRadius: '3pt', fontSize: '10pt' }}>
                    <span className="note-label">Prüfaufgabe: </span>{n.testTask}
                  </p>
                )}
                <div style={{ marginTop: '6pt', fontSize: '10pt', fontWeight: 700, color: '#4f46e5' }}>
                  Lernmaterialien
                </div>
                {resState === undefined && (
                  <p className="meta-row" style={{ fontStyle: 'italic', margin: '4pt 0 0 0' }}>
                    Materialien werden noch geladen — ggf. erneut drucken.
                  </p>
                )}
                {resState && res.length === 0 && (
                  <p className="meta-row" style={{ fontStyle: 'italic', margin: '4pt 0 0 0' }}>
                    Keine passenden Materialien bei WLO gefunden — probiere es im Detail-Drawer mit alternativen Suchbegriffen.
                  </p>
                )}
                {res.length > 0 && (
                  <ul className="mat-list">
                    {res.map(r => (
                      <li key={r.id} className="mat-item">
                        <div style={{ fontWeight: 600 }}>{r.title}</div>
                        {(r.resourceType || r.description) && (
                          <div className="meta-row" style={{ marginTop: '1pt' }}>
                            {r.resourceType && <b>{fmtType(r.resourceType)}</b>}
                            {r.resourceType && r.description && ' · '}
                            {r.description}
                          </div>
                        )}
                        <div className="mat-url">{r.renderUrl}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* 3) WEITERE OFFENE SCHRITTE */}
      {furtherOpen.length > 0 && (
        <section>
          <h2>Weitere Schritte ({furtherOpen.length})</h2>
          <p className="meta-row" style={{ margin: '0 0 8pt 0' }}>
            Nach den ersten drei Schritten geht es hier weiter.
            Öffne für passende Materialien im Browser den Detail-Drawer (📚-Button).
          </p>
          {furtherOpen.map((n, idx) => (
            <div key={n.id} className="step" style={{ padding: '6pt 10pt' }}>
              <div className="step-head">
                <span className="step-num">{nextSteps.length + idx + 1}.</span>
                <h3 style={{ flex: 1, fontSize: '11pt' }}>
                  {n.label}
                  <span className="chips">
                    <span>⏱ {formatMinutes(n.estimatedMinutes)}</span>
                    <span>·</span>
                    <span>{n.difficulty}/5</span>
                    {n.educationLevel && <><span>·</span><span>{n.educationLevel.replace(/_/g, ' ')}</span></>}
                  </span>
                </h3>
              </div>
              {n.description && (
                <p style={{ margin: '3pt 0 0 0', fontSize: '10pt' }}>{n.description}</p>
              )}
              {n.testTask && (
                <p style={{ margin: '3pt 0 0 0', fontSize: '9.5pt', fontStyle: 'italic', color: '#475569' }}>
                  <span className="note-label">Prüfaufgabe:</span> {n.testTask}
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {/* 4) ZIEL */}
      {targetNode && (
        <section className="step" style={{ background: '#ede9fe', borderColor: '#8b5cf6', borderWidth: '2pt', marginTop: '14pt' }}>
          <div style={{ fontSize: '9pt', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6d28d9', fontWeight: 700 }}>
            Lernziel erreicht ★
          </div>
          <h3 style={{ fontSize: '13pt', marginTop: '2pt' }}>{targetNode.label}</h3>
          {targetNode.description && (
            <p style={{ margin: '4pt 0 0 0' }}>{targetNode.description}</p>
          )}
          {targetNode.testTask && (
            <p style={{ margin: '4pt 0 0 0', fontStyle: 'italic' }}>
              <span className="note-label">Abschluss-Prüfaufgabe:</span> {targetNode.testTask}
            </p>
          )}
        </section>
      )}

      {/* 5) BEREITS BEKANNT */}
      {doneOrSkipped.length > 0 && (
        <section>
          <h2 style={{ color: '#64748b' }}>Bereits bekannt / übersprungen ({doneOrSkipped.length})</h2>
          <ul className="done-list" style={{ fontSize: '10pt', paddingLeft: '16pt', margin: 0 }}>
            {doneOrSkipped.map(n => (
              <li key={n.id}>
                {n.label}
                <span style={{ color: '#94a3b8', marginLeft: '6pt', fontSize: '9pt' }}>
                  {n.belowBaseline ? 'unter Baseline' : 'bekannt'} · {formatMinutes(n.estimatedMinutes)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer style={{ fontSize: '8pt', color: '#94a3b8', marginTop: '16pt', borderTop: '1px solid #e2e8f0', paddingTop: '6pt' }}>
        Erzeugt mit <b>Dein Lernpfadfinder</b> · Lernmaterialien von WirLernenOnline (redaktion.openeduhub.net)
      </footer>
    </div>
  );
}
