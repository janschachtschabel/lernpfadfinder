'use client';
import { useStore } from '@/lib/store';

/**
 * Compact, collapsible briefing about the generated learning path.
 * Renders nothing until the /api/summary call has populated the store.
 */
export function PathSummaryCard({ compact = false }: { compact?: boolean }) {
  const summary = useStore(s => s.summary);
  if (!summary) return null;

  const hasAny =
    summary.summary || summary.biggestChunks || summary.criticalPrereqs || summary.fit;
  if (!hasAny) return null;

  return (
    <details
      open={!compact}
      className="rounded-lg border border-brand-100 bg-brand-50/60 text-slate-800 mb-3"
    >
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-brand-800 select-none">
        Steckbrief zu diesem Pfad
      </summary>
      <div className="px-3 pb-3 text-sm space-y-2">
        {summary.summary && <p>{summary.summary}</p>}
        {summary.biggestChunks && (
          <p><span className="font-medium">Größter Aufwand: </span>{summary.biggestChunks}</p>
        )}
        {summary.criticalPrereqs && (
          <p><span className="font-medium">Nicht weglassen: </span>{summary.criticalPrereqs}</p>
        )}
        {summary.fit && (
          <p className="text-brand-800"><span className="font-medium">Zeitpassung: </span>{summary.fit}</p>
        )}
      </div>
    </details>
  );
}
