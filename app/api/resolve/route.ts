import { NextResponse } from 'next/server';
import { searchEntities } from '@/lib/wikidata';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'missing q' }, { status: 400 });
  try {
    const hits = await searchEntities(q, 'de', 5);
    return NextResponse.json({ hits });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
