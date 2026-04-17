import OpenAI from 'openai';

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY nicht gesetzt.');
  client = new OpenAI({ apiKey });
  return client;
}

export const MODELS = {
  chat: process.env.OPENAI_MODEL ?? 'gpt-5.4-mini',
  stt:  process.env.OPENAI_STT_MODEL ?? 'gpt-4o-transcribe',
  tts:  process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
  voice: process.env.OPENAI_TTS_VOICE ?? 'alloy',
};
