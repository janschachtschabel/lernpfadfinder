import { NextResponse } from 'next/server';
import { getOpenAI, MODELS } from '@/lib/openai';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** POST { text } -> audio/mpeg */
export async function POST(req: Request) {
  try {
    const { text } = (await req.json()) as { text: string };
    if (!text?.trim()) return NextResponse.json({ error: 'missing text' }, { status: 400 });
    const openai = getOpenAI();
    const resp = await openai.audio.speech.create({
      model: MODELS.tts,
      voice: MODELS.voice as any,
      input: text,
      format: 'mp3',
    });
    const buffer = Buffer.from(await resp.arrayBuffer());
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
