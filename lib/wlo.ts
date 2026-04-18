/**
 * Thin client for the WirLernenOnline edu-sharing REST API (production).
 * Mirrors the relevant bits of the reference `wlomcp` server.
 *
 *   POST /search/v1/queries/-home-/mds_oeh/ngsearch?contentType=FILES
 *     body: { criteria: [{ property, values }] }
 *
 * Criteria we use:
 *   - ngsearchword         → free-text query
 *   - ccm:educationalcontext → URI of the learning level (optional)
 *   - ccm:taxonid          → discipline id (optional — we currently skip; labels differ too much)
 */
import type { EducationLevel } from './types';

const BASE = 'https://redaktion.openeduhub.net/edu-sharing/rest';
const FRONTEND = 'https://redaktion.openeduhub.net/edu-sharing';

const EDU_CONTEXT_BASE = 'http://w3id.org/openeduhub/vocabs/educationalContext/';

/** Our internal EducationLevel keys → WLO context URI.
 *  NB: our "primarstufe" maps to the URI key "grundschule". */
const LEVEL_URI: Record<EducationLevel, string> = {
  elementarbereich:   EDU_CONTEXT_BASE + 'elementarbereich',
  primarstufe:        EDU_CONTEXT_BASE + 'grundschule',
  sekundarstufe_1:    EDU_CONTEXT_BASE + 'sekundarstufe_1',
  sekundarstufe_2:    EDU_CONTEXT_BASE + 'sekundarstufe_2',
  hochschule:         EDU_CONTEXT_BASE + 'hochschule',
  berufliche_bildung: EDU_CONTEXT_BASE + 'berufliche_bildung',
  fortbildung:        EDU_CONTEXT_BASE + 'fortbildung',
  erwachsenenbildung: EDU_CONTEXT_BASE + 'erwachsenenbildung',
  foerderschule:      EDU_CONTEXT_BASE + 'foerderschule',
  fernunterricht:     EDU_CONTEXT_BASE + 'fernunterricht',
  informelles_lernen: EDU_CONTEXT_BASE + 'informelles_lernen',
};

export interface WloResource {
  id: string;
  title: string;
  description?: string;
  /** Rendering URL inside WLO (iframe-friendly / browser). */
  renderUrl: string;
  /** Direct content URL, if provided. */
  contentUrl?: string;
  /** Thumbnail. */
  previewUrl?: string;
  /** Resource type label (e.g. "Video", "Arbeitsblatt") if deducible. */
  resourceType?: string;
}

/**
 * Search WLO for learning content matching a free-text query,
 * optionally scoped to an education level.
 */
export async function searchWloContent(opts: {
  query: string;
  educationLevel?: EducationLevel;
  maxItems?: number;
}): Promise<WloResource[]> {
  const query = opts.query.trim();
  if (!query) return [];

  const criteria: Array<{ property: string; values: string[] }> = [
    { property: 'ngsearchword', values: [query] },
  ];
  if (opts.educationLevel) {
    const uri = LEVEL_URI[opts.educationLevel];
    if (uri) criteria.push({ property: 'ccm:educationalcontext', values: [uri] });
  }

  const params = new URLSearchParams({
    contentType: 'FILES',
    maxItems: String(opts.maxItems ?? 6),
    skipCount: '0',
    propertyFilter: '-all-',
  });

  const url = `${BASE}/search/v1/queries/-home-/mds_oeh/ngsearch?${params}`;

  let data: any;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ criteria }),
      // Short timeout via AbortController — don't let slow WLO block the UI.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    return [];
  }

  const nodes: any[] = Array.isArray(data?.nodes) ? data.nodes : [];
  const out: WloResource[] = [];
  for (const n of nodes) {
    const id: string | undefined = n?.ref?.id;
    if (!id) continue;
    const props = (n?.properties ?? {}) as Record<string, string[]>;
    const title =
      (props['cclom:title']?.[0])
      || (props['cm:name']?.[0])
      || n?.title
      || n?.name
      || '(ohne Titel)';
    const description =
      (props['cclom:general_description']?.[0])
      || undefined;
    const resourceType =
      (props['ccm:oeh_lrt_aggregated']?.[0])
      || (props['ccm:oeh_lrt']?.[0])
      || undefined;
    out.push({
      id,
      title: String(title).trim(),
      description: description ? String(description).trim() : undefined,
      renderUrl: `${FRONTEND}/components/render/${id}`,
      contentUrl: n?.content?.url,
      previewUrl: n?.preview?.url,
      resourceType: resourceType ? String(resourceType) : undefined,
    });
  }
  return out;
}
