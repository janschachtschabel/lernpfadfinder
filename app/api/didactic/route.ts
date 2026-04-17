import { getOpenAI, MODELS } from '@/lib/openai';
import type { Graph } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST { graph, targetQid }
 * Streams SSE events to classify edges and nodes.
 * Batches edges into groups of 6 and sends them to the LLM in parallel.
 *
 * Events:
 *   status    { message }
 *   edge      { id, kind, reason }
 *   node      { id, kind }
 *   addNode   { id, label, description }   (LLM-suggested missing prerequisite)
 *   addEdge   { id, source, target, kind, reason }
 *   done      {}
 *   error     { message }
 */
export async function POST(req: Request) {
  const body = await req.json() as { graph: Graph; targetQid: string; level?: string };
  const { graph, targetQid, level } = body;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        send('status', { message: 'Analysiere Knoten-Rollen …' });

        const openai = getOpenAI();
        const nodeLabel = (id: string) => graph.nodes.find(n => n.id === id)?.label ?? id;
        const nodesInfo = graph.nodes.map(n => `${n.id} | ${n.label}${n.description ? ' — ' + n.description.slice(0, 80) : ''}`).join('\n');

        // Step A: classify nodes in one call
        const nodePrompt = [
          `Lernziel: ${nodeLabel(targetQid)} (${targetQid}). Niveau: ${level ?? 'Studienanfänger'}.`,
          `Klassifiziere jedes Thema aus Sicht dieses Lernziels:`,
          `- "target" (nur ${targetQid})`,
          `- "prerequisite" (muss vorher gelernt werden)`,
          `- "core" (wichtiger Bestandteil / parallel nötig)`,
          `- "advanced" (Vertiefung, kommt danach)`,
          ``,
          `Antworte NUR als JSON: {"nodes":[{"id":"Qxxx","kind":"prerequisite"}, ...]}`,
          ``,
          `Themen:`,
          nodesInfo,
        ].join('\n');

        const nodeResp = await openai.chat.completions.create({
          model: MODELS.chat,
          messages: [
            { role: 'system', content: 'Du bist Lernpfad-Designer. Antworte kurz und strukturiert als JSON.' },
            { role: 'user', content: nodePrompt },
          ],
          response_format: { type: 'json_object' },
          // reasoning/verbosity are applied if model supports them – otherwise ignored
          // @ts-ignore — forward-compatible params
          reasoning: { effort: 'low' },
          // @ts-ignore
          verbosity: 'low',
          temperature: 0.2,
        });
        const raw = nodeResp.choices[0]?.message?.content ?? '{}';
        try {
          const parsed = JSON.parse(raw) as { nodes?: Array<{ id: string; kind: string }> };
          for (const n of parsed.nodes ?? []) {
            if (['target', 'prerequisite', 'core', 'advanced'].includes(n.kind)) {
              send('node', { id: n.id, kind: n.kind });
            }
          }
        } catch { /* fall through */ }

        // Step B: classify edges in parallel batches
        send('status', { message: 'Klassifiziere Kanten parallel …' });

        const edges = graph.edges;
        const BATCH = 6;
        const batches: typeof edges[] = [];
        for (let i = 0; i < edges.length; i += BATCH) batches.push(edges.slice(i, i + BATCH));

        await Promise.all(batches.map(async (batch) => {
          const edgeList = batch.map(e => {
            const s = nodeLabel(e.source), t = nodeLabel(e.target);
            return `${e.id} | ${s} (${e.source}) -> ${t} (${e.target}) [Wikidata: ${e.property ?? '-'}]`;
          }).join('\n');
          const prompt = [
            `Lernziel: ${nodeLabel(targetQid)}. Niveau: ${level ?? 'Studienanfänger'}.`,
            `Klassifiziere jede Kante didaktisch:`,
            `- "prerequisite": Quelle muss vor Ziel gelernt werden`,
            `- "extends": Ziel vertieft/erweitert Quelle`,
            `- "applies": Ziel ist Anwendung von Quelle`,
            `- "related": nur thematisch verwandt (keine Reihenfolge)`,
            ``,
            `Antworte NUR als JSON: {"edges":[{"id":"<edgeId>","kind":"prerequisite","reason":"kurz"}, ...]}`,
            ``,
            `Kanten:`,
            edgeList,
          ].join('\n');

          const resp = await openai.chat.completions.create({
            model: MODELS.chat,
            messages: [
              { role: 'system', content: 'Du bist Lernpfad-Designer. JSON-Output. Kurz und präzise.' },
              { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
            // @ts-ignore
            reasoning: { effort: 'low' },
            // @ts-ignore
            verbosity: 'low',
            temperature: 0.2,
          });
          const r = resp.choices[0]?.message?.content ?? '{}';
          try {
            const parsed = JSON.parse(r) as { edges?: Array<{ id: string; kind: string; reason?: string }> };
            for (const e of parsed.edges ?? []) {
              if (['prerequisite', 'extends', 'applies', 'related'].includes(e.kind)) {
                send('edge', { id: e.id, kind: e.kind, reason: e.reason });
              }
            }
          } catch { /* ignore batch */ }
        }));

        send('done', {});
        controller.close();
      } catch (e: any) {
        send('error', { message: String(e?.message ?? e) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
