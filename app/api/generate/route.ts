import { getOpenAI, MODELS } from '@/lib/openai';
import type { Baseline, EducationLevel, GenerateEvent, Topic } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

/* ---------- in-memory cache (per process) ---------- */
interface NodeClassification {
  label: string;
  description: string;
  difficulty: number;
  learning_time_minutes: number;
  education_level: EducationLevel | null;
  below_baseline: boolean;
  is_single_competency: boolean;
  test_task: string | null;
  should_decompose: boolean;
  prerequisites: Array<{ name: string; reason: string; type: 'subtopic' | 'prerequisite' }>;
}

const VALID_LEVELS: EducationLevel[] = [
  'elementarbereich', 'primarstufe', 'sekundarstufe_1', 'sekundarstufe_2',
  'hochschule', 'berufliche_bildung', 'fortbildung', 'erwachsenenbildung',
  'foerderschule', 'fernunterricht', 'informelles_lernen',
];

/**
 * Rang-Ordnung entlang der formalen Schul-/Hochschulleiter.
 * Nur Werte mit Rang werden gegeneinander verglichen (z.B. "berufliche_bildung"
 * oder "fortbildung" bleiben ohne Rang und werden nicht ausgefiltert).
 */
const LEVEL_RANK: Partial<Record<EducationLevel, number>> = {
  elementarbereich: 1,
  primarstufe:      2,
  sekundarstufe_1:  3,
  sekundarstufe_2:  4,
  hochschule:       5,
};

function isAboveBaseline(nodeLvl: EducationLevel | null, baseLvl: EducationLevel): boolean {
  if (!nodeLvl) return false;
  const a = LEVEL_RANK[nodeLvl], b = LEVEL_RANK[baseLvl];
  if (a == null || b == null) return false;
  return a > b;
}

const cache = new Map<string, NodeClassification>();

/* ---------- utilities ---------- */
function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'node';
}

function clamp(v: any, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function baselineLabel(b: Baseline): string {
  const lvl: Record<EducationLevel, string> = {
    elementarbereich:    'Elementarbereich (Kita)',
    primarstufe:         'Primarstufe (Grundschule, Klasse 1–4)',
    sekundarstufe_1:     'Sekundarstufe I (Klasse 5–10)',
    sekundarstufe_2:     'Sekundarstufe II (Oberstufe, Abitur)',
    hochschule:          'Hochschule (Bachelor/Master)',
    berufliche_bildung:  'Berufliche Bildung (Ausbildung, Berufsschule)',
    fortbildung:         'Fortbildung / Weiterbildung',
    erwachsenenbildung:  'Erwachsenenbildung (VHS)',
    foerderschule:       'Förderschule',
    fernunterricht:      'Fernunterricht / Distance Learning',
    informelles_lernen:  'Informelles Lernen (Selbststudium)',
  };
  const p: Record<Baseline['prior'], string> = {
    nichts: 'keine Vorkenntnisse', grundlagen: 'Grundlagen bekannt',
    mittel: 'mittleres Vorwissen', viel: 'umfangreiches Vorwissen',
  };
  return `${lvl[b.level] ?? b.level}, ${p[b.prior]}`;
}

function purposeLabel(p?: Baseline['purpose']): string {
  const map: Record<string, string> = {
    pruefung: 'Prüfung/Klausur-Vorbereitung (prüfungssicher, Zeitdruck)',
    abschluss: 'Abschluss (Abitur, Bachelor, Zertifikat) — systematisch und vollständig',
    weiterbildung: 'berufliche Weiterbildung/Fortbildung — anwendungsorientiert',
    anwendung_beruf: 'konkrete Anwendung im Beruf — pragmatisch, werkzeugorientiert',
    hausaufgabenhilfe: 'Hausaufgaben/Nachhilfe — didaktisch, geduldig, kleinschrittig, für Kinder/Jugendliche erklärbar',
    hobby: 'Hobby/Interesse — ohne Druck, gern exploratorisch',
    auffrischung: 'Auffrischung bestehenden Wissens — Wiederholen und Lücken schließen',
    lebenslang: 'lebenslanges Lernen — tiefes Verstehen, keine Deadline, gern breit',
    kurz: 'nur wenige Stunden Zeit — stark fokussierter Mini-Pfad',
    sonstiges: 'individueller Anlass',
  };
  return p ? (map[p] ?? p) : '';
}

/* ---------- LLM per-node classifier ---------- */
async function classifyNode(opts: {
  nodeLabel: string;
  parentPath: string[];      // from root to this node's parent
  parentDescription?: string; // short description of direct parent to keep context
  rootGoal: string;
  field?: string;
  baseline: Baseline;
  depth: number;
  maxDepth: number;
  isTargetLevel: boolean;    // true when this is the root node itself
  /** Parent's time budget in minutes — for conservation across siblings */
  parentTimeMinutes?: number;
  /** Total number of siblings (incl. this one) sharing that budget */
  siblingCount?: number;
}): Promise<NodeClassification> {
  const key = JSON.stringify({
    n: opts.nodeLabel, p: opts.parentPath, r: opts.rootGoal,
    b: {
      l: opts.baseline.level, pr: opts.baseline.prior,
      pu: opts.baseline.purpose, pn: opts.baseline.purposeNote,
      hw: opts.baseline.hoursPerWeek, dl: opts.baseline.deadline,
    },
    d: opts.depth >= opts.maxDepth ? 'max' : 'ok',
    pt: opts.parentTimeMinutes, sc: opts.siblingCount,
  });
  const cached = cache.get(key);
  if (cached) return cached;

  const openai = getOpenAI();
  const atMax = opts.depth >= opts.maxDepth;

  const baselineRank = LEVEL_RANK[opts.baseline.level];
  const allowedLevels = VALID_LEVELS.filter(lv => {
    const r = LEVEL_RANK[lv];
    return r == null || baselineRank == null || r <= baselineRank;
  });

  const budgetLine = (opts.parentTimeMinutes && opts.siblingCount && opts.siblingCount > 0)
    ? `Parent-Budget: ${opts.parentTimeMinutes} min, verteilt auf ${opts.siblingCount} Geschwister → Ø ${Math.round(opts.parentTimeMinutes / opts.siblingCount)} min pro Kind.`
    : '';

  const instructions = [
    'Du bist ein erfahrener Didaktiker mit tiefem Wissen über Schul- und Hochschul-Lehrpläne (Abitur, Bachelor) im deutschsprachigen Raum.',
    'Du bekommst einen EINZELNEN Knoten in einem Lernbaum. Entscheide nur für DIESEN Knoten, ob er weiter zerlegt werden muss — nicht für seine Kinder.',
    'Antworte ausschließlich auf Deutsch, ausschließlich als JSON.',
    '',
    '===== HARTE BASELINE-REGEL (Zielbildungsstufe des Users) =====',
    `Die gewählte Bildungsstufe des Users ist: "${opts.baseline.level}".`,
    'Der Lernbaum MUSS sich strikt auf diese Stufe (oder darunter) beschränken.',
    `Erlaubte Werte für education_level in deiner Ausgabe: ${allowedLevels.map(l => `"${l}"`).join(', ')}.`,
    'Verboten: Kompetenzen, die typischerweise ERST auf einer HÖHEREN Stufe erworben werden.',
    '- Beispiel: Bei Baseline="sekundarstufe_1" (Klasse 5–10) sind Themen wie Vektorräume, Matrixinversion, Determinanten, Vektorraumaxiome OUT-OF-SCOPE.',
    '- Für "Lineare Algebra für Sek I" erlaubt: Termumformungen, lineare Gleichungen mit einer/zwei Variablen, einfache Gleichungssysteme, Koordinatensystem, Geradengleichungen.',
    '- Bei Baseline="sekundarstufe_2" NICHT: Eigenwerttheorie, abstrakte Vektorräume, komplexe Analysis auf Uni-Niveau.',
    'Wenn der aktuelle Knoten NICHT in Baseline oder darunter passt (also education_level > baseline):',
    '  → Setze should_decompose=false UND below_baseline=true UND gib KEINE Kinder zurück. Er wird dann als "außerhalb des Lernziels" ausgeblendet.',
    'Beim Auswählen von prerequisites (Kindern) gilt dasselbe: KEINE Kinder vorschlagen, die über der Baseline liegen.',
    '',
    '===== ZEITBUDGET-REGEL (wichtig gegen Overestimation) =====',
    budgetLine || 'Dies ist die Wurzel — dein Wert ist das Gesamt-Budget für den ganzen Baum.',
    'Falls du ein Budget bekommst: dein learning_time_minutes sollte REALISTISCH Anteil am Parent-Budget sein.',
    '- Summe aller Geschwister ≈ Parent-Budget (mit leichtem Overhead für Übung/Wiederholung; max Faktor 1.3).',
    '- NIE mehr Zeit als das Parent. Ein einzelnes Kind darf das Parent-Budget nicht überschreiten.',
    '- Wenn du unsicher bist: gib den Ø-Wert (Parent/Siblings) und passe nur leicht an, wenn dein Knoten offensichtlich umfangreicher oder kompakter ist als die anderen.',
    '',
    'Abbruchkriterien (dann ist der Knoten ein Leaf, should_decompose=false):',
    '1. Max-Tiefe erreicht',
    '2. Unter User-Baseline — der User beherrscht das bereits (für seine Stufe und sein Vorwissen)',
    '3. Lernzeit < 90 Minuten — eine einzelne Lerneinheit reicht',
    '4. Einzelkompetenz — du kannst EINE konkrete Prüfaufgabe formulieren, mit der Beherrschung überprüfbar ist',
    '',
    'Sonst: zerlege in 3–7 Kinder.',
    '',
    'WICHTIGE UNTERSCHEIDUNG pro Kind:',
    '- type="subtopic"     — echter Bestandteil des aktuellen Themas (z. B. Optik → Geometrische Optik)',
    '- type="prerequisite" — Wissen aus einem ANDEREN Themengebiet, das man VORHER können muss (z. B. Optik → Wellenlehre, oder Linsen → Trigonometrie). Wird im UI gestrichelt dargestellt.',
    '',
    'Orientierung für Zeit (learning_time_minutes):',
    '- Realistische Lehr-Lernzeit in FORMALEN Settings (Schule, Hochschule, Ausbildung), inkl. Unterricht + Übung + Prüfungsvorbereitung.',
    '- Beispiele als Kalibrierung:',
    '  • Lineare Algebra als Schulthema (Sek II): ca. 100 Zeitstunden über Halbjahr.',
    '  • Lineare Algebra als Uni-Bachelor (1 Semester, 5 ECTS): ca. 150 Zeitstunden (Vorlesung+Übung+Selbst).',
    '  • Optik für Abitur-Klausur: ca. 60–80 Zeitstunden.',
    '  • Einzelne Sek-I-Kompetenz wie "Klammern ausmultiplizieren": 60–120 Minuten.',
    '  • Ein Grundschul-Einmaleins-Fakt: 20–40 Minuten.',
    '- Also KEIN Schätzen nach Bauchgefühl, sondern Orientierung an realen Curricula.',
    '',
    'Orientierung für Bildungsstufe (education_level):',
    '- Ordne zu, in welcher Bildungsstufe diese Kompetenz typischerweise formal erworben wird.',
    '- Erlaubte Werte (genau einer): "elementarbereich", "primarstufe", "sekundarstufe_1",',
    '  "sekundarstufe_2", "hochschule", "berufliche_bildung", "fortbildung",',
    '  "erwachsenenbildung", "foerderschule", "fernunterricht", "informelles_lernen".',
    '- Beispiele: Bruchrechnung → sekundarstufe_1, Infinitesimalrechnung → sekundarstufe_2,',
    '  Lineare Algebra (Matrizen/Vektorräume auf Uni-Niveau) → hochschule,',
    '  Zahlbereich natürliche Zahlen → primarstufe.',
    '- Auch externe Voraussetzungen bekommen ihre eigene Stufe (nicht die des Zielknotens!).',
    '',
    'Orientierung für Tiefe:',
    '- Zerlegung soll ASYMMETRISCH sein: manche Kinder sofort Leaf, andere weiter zerlegt.',
    '- Denke das User-Lernziel (Wurzel) IMMER mit: bei "Optik für Abitur" gehört Quantenoptik nicht rein, bei "Optik für Physik-Bachelor" schon.',
    '',
    'LERNANLASS berücksichtigen (falls angegeben):',
    '- "Prüfung/Klausur" → klausurrelevante Standardaufgaben, typische Prüfungsformate als Prüfaufgaben nutzen.',
    '- "Hausaufgaben/Nachhilfe" → kleinschrittig, für Kinder/Jugendliche erklärbar, keine abstrakte Theorie, wenn nicht nötig.',
    '- "Hobby/Interesse" oder "lebenslang" → exploratorischer Pfad, ruhig breiter; keine harte Prüfungsrelevanz.',
    '- "Anwendung im Beruf"/"Weiterbildung" → werkzeugorientiert, echte Use-Cases als Prüfaufgaben.',
    '- "Kurzes Szenario" (wenige Stunden) → stark fokussierter Mini-Pfad, nur absolut Notwendiges, aggressiv ausdünnen.',
    '- "Auffrischung" → Fokus auf schnelles Reaktivieren, weniger Einführung.',
  ].join('\n');

  const pathStr = opts.parentPath.length
    ? opts.parentPath.concat(opts.nodeLabel).join(' → ')
    : opts.nodeLabel;

  const parentCtx = opts.parentDescription
    ? `Kontext des Elternknotens: ${opts.parentDescription}`
    : '';

  const purposeStr = purposeLabel(opts.baseline.purpose);
  const purposeNoteStr = opts.baseline.purposeNote?.trim();
  const timeFrameParts: string[] = [];
  if (opts.baseline.hoursPerWeek && opts.baseline.hoursPerWeek > 0) {
    timeFrameParts.push(`${opts.baseline.hoursPerWeek} h/Woche verfügbar`);
  }
  if (opts.baseline.deadline) {
    timeFrameParts.push(`Deadline: ${opts.baseline.deadline}`);
  }
  const timeFrameStr = timeFrameParts.join(' · ');

  const input = [
    `Lernziel des Users (Wurzel): "${opts.rootGoal}"${opts.field ? ` (${opts.field})` : ''}`,
    `User-Baseline: ${baselineLabel(opts.baseline)}`,
    purposeStr ? `Lernanlass: ${purposeStr}` : '',
    purposeNoteStr ? `Konkreter Anlass: ${purposeNoteStr}` : '',
    timeFrameStr ? `Zeitrahmen des Users: ${timeFrameStr}` : '',
    `⚠ Scope: ausschließlich Inhalte auf Niveau "${opts.baseline.level}" oder darunter.`,
    budgetLine ? `Zeit-Constraint: ${budgetLine}` : '',
    `Aktueller Knoten: "${opts.nodeLabel}"`,
    `Pfad (Wurzel → aktuell): ${pathStr}`,
    parentCtx,
    `Tiefe: ${opts.depth}/${opts.maxDepth}${atMax ? ' (MAX erreicht — Leaf erzwungen)' : ''}`,
    opts.isTargetLevel
      ? 'Dies ist die WURZEL. Zerlege sie, sofern sie nicht unter Baseline liegt.'
      : '',
    '',
    'Gib JSON zurück:',
    '{',
    '  "label": "normalisiertes Label",',
    '  "description": "ein kurzer Satz",',
    '  "learning_time_minutes": <int, realistische Lehr-Lernzeit in Minuten>,',
    '  "education_level": "<eine der erlaubten Bildungsstufen>",',
    '  "difficulty": <1-5>,',
    '  "below_baseline": <bool>,',
    '  "is_single_competency": <bool>,',
    '  "test_task": "konkrete Prüfaufgabe (wenn Leaf)" | null,',
    '  "should_decompose": <bool>,',
    '  "prerequisites": [ { "name": "...", "reason": "1 Satz", "type": "subtopic|prerequisite" } ]  // 3-7 wenn should_decompose, sonst []',
    '}',
  ].filter(Boolean).join('\n');

  const resp = await openai.responses.create({
    model: MODELS.chat,
    instructions,
    input,
    reasoning: { effort: 'low' },
    // @ts-ignore
    text: { verbosity: 'low', format: { type: 'json_object' } },
  });

  const raw = resp.output_text ?? '{}';
  let parsed: any = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }

  // Defensive normalization
  let time = Math.max(5, Math.round(Number(parsed.learning_time_minutes) || 60));
  // Time conservation: ein Kind darf nie mehr Zeit beanspruchen als sein Parent
  // (Ausnahme: Wurzel, hat kein Parent-Budget). Wenn das LLM das ignoriert hat,
  // clippen wir auf das faire anteilige Budget (Parent/Siblings * 2 als Obergrenze).
  if (opts.parentTimeMinutes && opts.siblingCount && opts.siblingCount > 0) {
    const fairMax = Math.round((opts.parentTimeMinutes / opts.siblingCount) * 2);
    const hardMax = opts.parentTimeMinutes; // niemals mehr als das Parent selbst
    const clipped = Math.min(time, Math.min(fairMax, hardMax));
    if (clipped !== time) {
      time = clipped;
    }
  }

  const rawLevel = typeof parsed.education_level === 'string'
    ? parsed.education_level.trim() as EducationLevel
    : null;
  const educationLevel: EducationLevel | null = rawLevel && VALID_LEVELS.includes(rawLevel)
    ? rawLevel
    : null;

  // Scope-Enforcement: liegt der Knoten über der Baseline → als übersprungen markieren.
  const outOfScope = isAboveBaseline(educationLevel, opts.baseline.level);
  const belowBaseline = !!parsed.below_baseline || outOfScope;

  let shouldDecompose = !!parsed.should_decompose && !belowBaseline && !atMax;
  if (time < 90) shouldDecompose = false;           // hard cut: short time = leaf
  if (parsed.is_single_competency) shouldDecompose = false;
  if (outOfScope) shouldDecompose = false;           // out-of-scope nodes never decompose

  const result: NodeClassification = {
    label: String(parsed.label || opts.nodeLabel).trim(),
    description: String(parsed.description || '').trim(),
    difficulty: clamp(parsed.difficulty, 1, 5, 3),
    learning_time_minutes: time,
    education_level: educationLevel,
    below_baseline: belowBaseline,
    is_single_competency: !!parsed.is_single_competency,
    test_task: parsed.test_task || null,
    should_decompose: shouldDecompose,
    prerequisites: Array.isArray(parsed.prerequisites)
      ? parsed.prerequisites
          .filter((p: any) => p && typeof p.name === 'string' && p.name.trim())
          .slice(0, 7)
          .map((p: any) => ({
            name: String(p.name).trim(),
            reason: String(p.reason ?? '').trim(),
            type: (p.type === 'prerequisite' ? 'prerequisite' : 'subtopic') as 'subtopic' | 'prerequisite',
          }))
      : [],
  };
  cache.set(key, result);
  return result;
}

/* ---------- SSE streaming route ---------- */
export async function POST(req: Request) {
  let body: {
    label?: string;
    description?: string;
    field?: string;
    baseline?: Baseline;
    maxDepth?: number;
  } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return new Response('Ungültiger Request-Body', { status: 400 });
  }
  const label = (body.label ?? '').trim();
  if (!label) return new Response('label fehlt', { status: 400 });
  const baseline: Baseline = body.baseline ?? { level: 'sekundarstufe_2', prior: 'grundlagen', purpose: 'pruefung' };
  const maxDepth = Math.min(Math.max(body.maxDepth ?? 4, 2), 5);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (evt: GenerateEvent) => {
        controller.enqueue(encoder.encode(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`));
      };

      const usedIds = new Set<string>();
      const mkUniqueId = (label: string) => {
        let id = slugify(label);
        let i = 2;
        const base = id;
        while (usedIds.has(id)) id = `${base}_${i++}`;
        usedIds.add(id);
        return id;
      };

      const targetId = mkUniqueId(label);
      let aborted = false;

      const t0 = Date.now();

      /**
       * Decompose a node recursively. Child calls at depth >= 1 run in parallel.
       * The target node and its edges are emitted BEFORE decomposition recurses.
       */
      async function decompose(
        nodeId: string,
        nodeLabel: string,
        parentPath: string[],
        parentDescription: string | undefined,
        depth: number,
        isTarget: boolean,
        relation: 'subtopic' | 'prerequisite' | 'target',
        parentBudget?: { parentTimeMinutes: number; siblingCount: number },
      ): Promise<void> {
        if (aborted) return;
        emit({ type: 'status', message: `Klassifiziere „${nodeLabel}“ (Tiefe ${depth}) …` });

        let cls: NodeClassification;
        try {
          cls = await classifyNode({
            nodeLabel,
            parentPath,
            parentDescription,
            rootGoal: label,
            field: body.field,
            baseline,
            depth,
            maxDepth,
            isTargetLevel: isTarget,
            parentTimeMinutes: parentBudget?.parentTimeMinutes,
            siblingCount: parentBudget?.siblingCount,
          });
        } catch (e: any) {
          emit({ type: 'error', message: `Klassifikation fehlgeschlagen bei ${nodeLabel}: ${e?.message ?? e}` });
          return;
        }

        const node: Topic = {
          id: nodeId,
          label: cls.label || nodeLabel,
          description: cls.description || undefined,
          difficulty: cls.difficulty,
          educationLevel: cls.education_level ?? undefined,
          estimatedMinutes: cls.learning_time_minutes,
          depth,
          isLeaf: !cls.should_decompose,
          belowBaseline: cls.below_baseline,
          testTask: cls.test_task ?? undefined,
          isTarget,
          relation,
        };
        emit({ type: 'node', node });

        if (!cls.should_decompose) return;

        // Create child ids first so we can emit edges immediately
        const children = cls.prerequisites.map(p => ({
          id: mkUniqueId(p.name),
          label: p.name,
          reason: p.reason,
          type: p.type,
        }));
        for (const ch of children) {
          const edgeId = `${ch.id}->${nodeId}`;
          emit({ type: 'edge', edge: { id: edgeId, from: ch.id, to: nodeId, reason: ch.reason } });
        }

        // Recurse in parallel, passing parent description and time budget down
        const childPath = [...parentPath, cls.label || nodeLabel];
        const parentDesc = cls.description || undefined;
        const childBudget = {
          parentTimeMinutes: cls.learning_time_minutes,
          siblingCount: children.length,
        };
        await Promise.all(children.map(ch =>
          decompose(ch.id, ch.label, childPath, parentDesc, depth + 1, false, ch.type, childBudget)
        ));
      }

      try {
        await decompose(targetId, label, [], undefined, 0, true, 'target');
        emit({ type: 'status', message: `Fertig in ${((Date.now() - t0) / 1000).toFixed(1)}s` });
        emit({ type: 'done' });
      } catch (e: any) {
        emit({ type: 'error', message: String(e?.message ?? e) });
      } finally {
        controller.close();
      }
    },
    cancel() { /* client disconnected */ },
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
