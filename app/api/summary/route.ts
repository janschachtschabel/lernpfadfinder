import { getOpenAI, MODELS } from '@/lib/openai';
import type { Baseline, LearningGraph } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface SummaryRequest {
  graph?: LearningGraph;
  baseline?: Baseline;
  path?: string[];
  targetLabel?: string;
}

/**
 * Produces a concise, user-facing Pfad-Steckbrief:
 *   - 2–3 Sätze Gesamteinschätzung
 *   - Top-3 Zeitfresser (welche Cluster machen das meiste Volumen aus)
 *   - Kritische Voraussetzungen (was du NICHT weglassen kannst)
 *   - ggf. Passung zum Zeitrahmen
 */
export async function POST(req: Request) {
  let body: SummaryRequest = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  const g = body.graph;
  if (!g) return Response.json({ error: 'graph fehlt' }, { status: 400 });
  const baseline = body.baseline;
  const path = body.path ?? [];
  const targetLabel = body.targetLabel ?? '';

  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const leaves = g.nodes.filter(n => n.isLeaf && !n.isTarget);
  const activeLeaves = leaves.filter(n => !n.known && !n.belowBaseline);
  const totalMinutes = activeLeaves.reduce((s, n) => s + n.estimatedMinutes, 0);

  // Top-3 heaviest direct children of target (level-1 clusters)
  const directChildren = g.edges
    .filter(e => e.to === g.targetId)
    .map(e => byId.get(e.from))
    .filter((n): n is NonNullable<typeof n> => !!n);

  const weights = directChildren.map(c => {
    // subtree minutes (active leaves only)
    const childrenIds = new Set<string>([c.id]);
    const visited = new Set<string>();
    const queue = [c.id];
    while (queue.length) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const e of g.edges) if (e.to === cur) { childrenIds.add(e.from); queue.push(e.from); }
    }
    const activeInSubtree = Array.from(childrenIds)
      .map(id => byId.get(id))
      .filter((n): n is NonNullable<typeof n> => !!n && n.isLeaf && !n.known && !n.belowBaseline);
    const mins = activeInSubtree.reduce((s, n) => s + n.estimatedMinutes, 0);
    return { label: c.label, mins };
  }).sort((a, b) => b.mins - a.mins).slice(0, 5);

  // External prerequisites (relation='prerequisite') — didaktisch oft kritisch
  const externals = g.nodes
    .filter(n => n.relation === 'prerequisite' && !n.known && !n.belowBaseline)
    .slice(0, 8)
    .map(n => n.label);

  const instructions = [
    'Du bist ein didaktischer Coach. Du bekommst einen fertig generierten Lernpfad und formulierst eine kurze, persönliche Einschätzung.',
    'Sprache: Deutsch, zweite Person ("du"), warm-professionell, ohne Marketing-Floskeln.',
    'Maximal 4 kompakte Absätze. KEINE Aufzählungen länger als 3 Punkte.',
    'Antworte ausschließlich als JSON.',
  ].join('\n');

  const input = [
    `Lernziel: "${targetLabel}"`,
    baseline ? `Baseline: Stufe=${baseline.level}, Vorwissen=${baseline.prior}, Zweck=${baseline.purpose ?? '?'}${baseline.purposeNote ? ` ("${baseline.purposeNote}")` : ''}` : '',
    baseline?.hoursPerWeek ? `Zeitbudget: ${baseline.hoursPerWeek} h/Woche${baseline.deadline ? `, Deadline ${baseline.deadline}` : ''}` : '',
    `Aktive atomare Lernschritte: ${activeLeaves.length}`,
    `Gesamte Netto-Lernzeit: ${Math.round(totalMinutes / 6) / 10} h`,
    '',
    `Größte Teil-Themen (Zeit in Minuten):`,
    ...weights.map(w => `  - ${w.label}: ${w.mins} min`),
    '',
    externals.length ? `Externe Voraussetzungen (aus anderen Gebieten): ${externals.join(', ')}` : '',
    '',
    'Gib JSON zurück:',
    '{',
    '  "summary": "2-3 Sätze Gesamteinschätzung dieses Pfads (was lernst du da eigentlich?)",',
    '  "biggestChunks": "1-2 Sätze zu den größten Brocken — was macht den Aufwand aus?",',
    '  "criticalPrereqs": "1-2 Sätze zu kritischen Voraussetzungen, die man NICHT weglassen kann (wenn externe Voraussetzungen bestehen)",',
    '  "fit": "1 Satz zur Passung zum angegebenen Zeitrahmen (nur wenn Zeitbudget angegeben war); sonst leer lassen"',
    '}',
  ].filter(Boolean).join('\n');

  try {
    const openai = getOpenAI();
    const resp = await openai.responses.create({
      model: MODELS.chat,
      instructions,
      input,
      reasoning: { effort: 'low' },
      // @ts-ignore
      text: { verbosity: 'low', format: { type: 'json_object' } },
    });
    const raw = resp.output_text ?? '{}';
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    return Response.json({
      summary: String(parsed.summary ?? '').trim(),
      biggestChunks: String(parsed.biggestChunks ?? '').trim(),
      criticalPrereqs: String(parsed.criticalPrereqs ?? '').trim(),
      fit: String(parsed.fit ?? '').trim(),
    });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
