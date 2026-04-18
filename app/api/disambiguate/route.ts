import { NextResponse } from 'next/server';
import { getOpenAI, MODELS } from '@/lib/openai';
import type { DisambiguationOption } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const { term } = await req.json() as { term?: string };
  const q = (term ?? '').trim();
  if (!q) return NextResponse.json({ error: 'term fehlt' }, { status: 400 });

  const openai = getOpenAI();
  const instructions =
    'Du bist ein didaktischer Assistent. Du bekommst einen Lernbegriff und gibst plausible Interpretationen zurück. ' +
    'Wenn der Begriff eindeutig ist (z. B. "Photosynthese"), gibst du nur EINE Option zurück. ' +
    'Bei Mehrdeutigkeiten gibst du 2–5 Optionen aus unterschiedlichen Fachbereichen. ' +
    'Antworte ausschließlich auf Deutsch, nur als JSON.';

  const input = [
    `Begriff: "${q}"`,
    '',
    'Gib JSON zurück:',
    '{ "options": [ { "label": "Kurzname inkl. Kontext", "description": "eine Zeile, was es ist", "field": "Fachbereich" } ] }',
    '',
    'Beispiel für "Optik":',
    '{ "options": [',
    '  { "label": "Optik (Physik)", "description": "Teilgebiet der Physik über Licht und Sehen", "field": "Physik" },',
    '  { "label": "Optik (Gerätekunde)", "description": "Linsen, Mikroskope, Ferngläser als Bauteile", "field": "Feinmechanik" }',
    ']}',
  ].join('\n');

  try {
    const resp = await openai.responses.create({
      model: MODELS.chat,
      instructions,
      input,
      reasoning: { effort: 'low' },
      // @ts-ignore
      text: { verbosity: 'low', format: { type: 'json_object' } },
    });
    const raw = resp.output_text ?? '{}';
    const parsed = JSON.parse(raw) as { options?: DisambiguationOption[] };
    const options = (parsed.options ?? []).filter(o => o.label && o.field).slice(0, 5);
    return NextResponse.json({ options });
  } catch (e: any) {
    console.error('[disambiguate] error:', e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
