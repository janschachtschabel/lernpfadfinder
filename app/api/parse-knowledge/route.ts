import { NextResponse } from 'next/server';
import { getOpenAI, MODELS } from '@/lib/openai';
import type { Graph } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST { text, graph } -> { knownIds: string[] }
 * User describes existing knowledge in free text. LLM returns matching node IDs.
 */
export async function POST(req: Request) {
  const { text, graph } = (await req.json()) as { text: string; graph: Graph };
  if (!text?.trim()) return NextResponse.json({ knownIds: [] });

  const openai = getOpenAI();
  const nodes = graph.nodes.map(n => `${n.id}: ${n.label}`).join('\n');
  const prompt = [
    `Ein Nutzer beschreibt freies Vorwissen. Ordne es den folgenden Themen zu.`,
    `Antworte NUR als JSON: {"knownIds":["Qxxx", ...]}.`,
    `Nur echte Treffer, keine Vermutungen. Wenn nichts passt: leere Liste.`,
    ``,
    `Themen:`,
    nodes,
    ``,
    `Nutzer-Text: "${text}"`,
  ].join('\n');

  try {
    const resp = await openai.chat.completions.create({
      model: MODELS.chat,
      messages: [
        { role: 'system', content: 'Du extrahierst strukturiert Vorwissen. JSON-only.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      // @ts-ignore
      reasoning: { effort: 'low' },
      // @ts-ignore
      verbosity: 'low',
      temperature: 0.1,
    });
    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { knownIds?: string[] };
    const validIds = new Set(graph.nodes.map(n => n.id));
    const knownIds = (parsed.knownIds ?? []).filter(id => validIds.has(id));
    return NextResponse.json({ knownIds });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e), knownIds: [] }, { status: 500 });
  }
}
