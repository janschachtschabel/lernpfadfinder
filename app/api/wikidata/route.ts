import { NextResponse } from 'next/server';
import { fetchGraph } from '@/lib/wikidata';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const qid = searchParams.get('qid')?.trim();
  if (!qid || !/^Q\d+$/.test(qid)) {
    return NextResponse.json({ error: 'invalid qid' }, { status: 400 });
  }
  try {
    const graph = await fetchGraph(qid);
    return NextResponse.json(graph);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
