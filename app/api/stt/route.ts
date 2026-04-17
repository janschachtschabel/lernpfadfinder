import { NextResponse } from 'next/server';
import { getOpenAI, MODELS } from '@/lib/openai';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** POST audio (multipart/form-data 'audio') -> { text } */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('audio');
    if (!(file instanceof File)) return NextResponse.json({ error: 'missing audio' }, { status: 400 });

    const openai = getOpenAI();
    // Cast to any because the openai SDK type for file accepts File/ReadStream.
    const resp = await openai.audio.transcriptions.create({
      file: file as any,
      model: MODELS.stt,
      language: 'de',
    });
    return NextResponse.json({ text: resp.text });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
