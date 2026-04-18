import { searchWloContent, type WloResource } from '@/lib/wlo';
import type { EducationLevel } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 15;

interface WloRequest {
  query: string;
  educationLevel?: EducationLevel;
  maxItems?: number;
}

// --- simple in-memory LRU-ish cache (per server instance) --------------------
const cache = new Map<string, { at: number; data: WloResource[] }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const CACHE_MAX_ENTRIES = 500;

function cacheGet(key: string): WloResource[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}
function cacheSet(key: string, data: WloResource[]): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Drop oldest entry (first key in insertion order).
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { at: Date.now(), data });
}

/**
 * POST /api/wlo
 * Returns up to N learning resources from WLO Prod for a given free-text query.
 * Responses are cached in memory to avoid hammering WLO with repeat requests.
 */
export async function POST(req: Request) {
  let body: WloRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  const query = (body.query ?? '').trim();
  if (!query) return Response.json({ resources: [] });
  const maxItems = Math.min(Math.max(body.maxItems ?? 6, 1), 12);

  const cacheKey = JSON.stringify({ q: query, el: body.educationLevel ?? null, m: maxItems });
  const cached = cacheGet(cacheKey);
  if (cached) {
    return Response.json({ resources: cached, cached: true });
  }

  try {
    const resources = await searchWloContent({
      query,
      educationLevel: body.educationLevel,
      maxItems,
    });
    cacheSet(cacheKey, resources);
    return Response.json({ resources });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e), resources: [] }, { status: 200 });
  }
}
