/** A node in the learning graph. Grown by recursive LLM decomposition. */
export interface Topic {
  /** slug-style unique id (snake_case, derived from label) */
  id: string;
  label: string;
  description?: string;
  /** 1 = Grundschule, 2 = Mittelstufe, 3 = Oberstufe, 4 = Studium, 5 = Experte */
  difficulty: number;
  /**
   * Bildungsstufe, in der diese Kompetenz typischerweise formal erworben wird.
   * Ermöglicht Massen-Abhaken nach Stufen in Phase 2.
   */
  educationLevel?: EducationLevel;
  /**
   * Estimated learning time in minutes, kalibriert an realen Lehr-Lernzeiten
   * in formalen Settings (Schule, Hochschule, Ausbildung).
   */
  estimatedMinutes: number;
  /** Depth in the tree — 0 = target, increases outward */
  depth: number;
  /** Atomic leaf? No further decomposition beneath this node. */
  isLeaf: boolean;
  /** The LLM considers this topic already known under the user baseline. */
  belowBaseline?: boolean;
  /** If leaf: a concrete testable task that demonstrates mastery. */
  testTask?: string;
  /** User marked as already known (overrides pathing even if not leaf). */
  known?: boolean;
  /** True only for the root learning goal. */
  isTarget?: boolean;
  /**
   * Relation of this node to its parent in the decomposition tree:
   *  - 'subtopic'     = genuine part of the parent topic
   *  - 'prerequisite' = knowledge from another domain needed before the parent
   *  - 'target'       = only set on root
   */
  relation?: 'subtopic' | 'prerequisite' | 'target';
}

/** A directed "requires" edge: from must be learned before to. */
export interface TopicEdge {
  id: string;
  from: string;
  to: string;
  reason?: string;
}

export interface LearningGraph {
  targetId: string;
  nodes: Topic[];
  edges: TopicEdge[];
}

/** User profile guiding recursive decomposition depth. */
export interface Baseline {
  level: EducationLevel;
  prior: PriorKnowledge;
  /** Lernanlass / Zweck — beeinflusst Tonalität, Tiefe und was das LLM auslässt. */
  purpose?: LearningPurpose;
  /** Freitextbeschreibung des Anlasses (optional) */
  purposeNote?: string;
  /** Optional: Zeitbudget pro Woche (Stunden) */
  hoursPerWeek?: number;
  /** Optional: Deadline (ISO-Datum YYYY-MM-DD) */
  deadline?: string;
}

/**
 * Bildungsbereichsübergreifende Anlässe — von Kurzszenario bis lebenslang.
 * Wird dem LLM als Hinweis mitgegeben, was "fertig gelernt" bedeutet.
 */
export type LearningPurpose =
  | 'pruefung'           // Klausur / Test / Abitur / Abschlussprüfung
  | 'abschluss'          // Schulabschluss, Studienabschluss
  | 'weiterbildung'      // berufliche Fortbildung, Zertifikat
  | 'anwendung_beruf'    // konkreter Anwendungsfall im Job
  | 'hausaufgabenhilfe'  // Eltern helfen Kind, Nachhilfe
  | 'hobby'              // eigenes Interesse, spielerisch
  | 'auffrischung'       // früher gelernt, jetzt wieder hervorholen
  | 'lebenslang'         // dauerhaftes tieferes Verstehen, keine Deadline
  | 'kurz'               // wenige Stunden / ein Wochenende
  | 'sonstiges';

export const LEARNING_PURPOSES: Array<{ value: LearningPurpose; title: string; hint: string }> = [
  { value: 'pruefung',          title: 'Prüfung / Klausur',   hint: 'konkrete Testsituation, Deadline' },
  { value: 'abschluss',         title: 'Abschluss',           hint: 'Abitur, Bachelor, Zertifikat' },
  { value: 'weiterbildung',     title: 'Berufl. Weiterbildung', hint: 'Fortbildung, Qualifikation' },
  { value: 'anwendung_beruf',   title: 'Anwendung im Beruf',  hint: 'konkrete Aufgabe im Job lösen' },
  { value: 'hausaufgabenhilfe', title: 'Hausaufgaben / Nachhilfe', hint: 'Kind/Angehörige unterstützen' },
  { value: 'hobby',             title: 'Hobby / Interesse',   hint: 'spielerisch, ohne Druck' },
  { value: 'auffrischung',      title: 'Auffrischung',        hint: 'Wissen wieder aktivieren' },
  { value: 'lebenslang',        title: 'Lebenslanges Lernen', hint: 'tiefes Verstehen, offen' },
  { value: 'kurz',              title: 'Kurzes Szenario',     hint: 'nur wenige Stunden Zeit' },
  { value: 'sonstiges',         title: 'Sonstiges',           hint: 'eigener Anlass' },
];
/**
 * Bildungsstufen nach WirLernenOnline-Taxonomie.
 * Werden sowohl für die Baseline des Users (welches Niveau lernst du gerade?)
 * als auch als Markierung pro Node genutzt (auf welcher Stufe wird diese
 * Kompetenz typischerweise erworben?).
 */
export type EducationLevel =
  | 'elementarbereich'
  | 'primarstufe'
  | 'sekundarstufe_1'
  | 'sekundarstufe_2'
  | 'hochschule'
  | 'berufliche_bildung'
  | 'fortbildung'
  | 'erwachsenenbildung'
  | 'foerderschule'
  | 'fernunterricht'
  | 'informelles_lernen';

export const EDUCATION_LEVELS: Array<{ value: EducationLevel; title: string; hint: string; group: string }> = [
  { value: 'elementarbereich',   title: 'Elementarbereich',    hint: 'Kita, Kindergarten',       group: 'Elementar' },
  { value: 'primarstufe',        title: 'Primarstufe',         hint: 'Grundschule, Klasse 1–4',  group: 'Schule' },
  { value: 'sekundarstufe_1',    title: 'Sekundarstufe I',     hint: 'Klassen 5–10',             group: 'Schule' },
  { value: 'sekundarstufe_2',    title: 'Sekundarstufe II',    hint: 'Oberstufe, Abitur',        group: 'Schule' },
  { value: 'hochschule',         title: 'Hochschule',          hint: 'Uni, FH, Bachelor/Master', group: 'Hochschule' },
  { value: 'berufliche_bildung', title: 'Berufliche Bildung',  hint: 'Ausbildung, Berufsschule', group: 'Beruf' },
  { value: 'fortbildung',        title: 'Fortbildung',         hint: 'Weiterbildung',            group: 'Beruf' },
  { value: 'erwachsenenbildung', title: 'Erwachsenenbildung',  hint: 'VHS, Abendschule',         group: 'Beruf' },
  { value: 'foerderschule',      title: 'Förderschule',        hint: 'Sonderpädagogik',          group: 'Schule' },
  { value: 'fernunterricht',     title: 'Fernunterricht',      hint: 'Distance Learning',        group: 'Sonstiges' },
  { value: 'informelles_lernen', title: 'Informelles Lernen',  hint: 'Selbststudium, Interesse', group: 'Sonstiges' },
];

export type PriorKnowledge = 'nichts' | 'grundlagen' | 'mittel' | 'viel';

/** Resolution candidate returned by /api/disambiguate. */
export interface DisambiguationOption {
  label: string;
  description: string;
  field: string;
}

/** Server-sent events emitted by /api/generate while building the tree. */
export type GenerateEvent =
  | { type: 'status'; message: string }
  | { type: 'node'; node: Topic }
  | { type: 'edge'; edge: TopicEdge }
  | { type: 'done' }
  | { type: 'error'; message: string };
