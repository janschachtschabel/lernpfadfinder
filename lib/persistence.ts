'use client';
/**
 * Lightweight localStorage persistence for the learning-path session.
 *
 *  - Written to on every meaningful state change (throttled via microtask queue).
 *  - Read once on app mount; if a session is present, the user lands in the
 *    phase they last left off.
 *  - Schema is versioned so future changes can invalidate old saves cleanly.
 */
import type { Baseline, DisambiguationOption, LearningGraph } from './types';
import type { Phase, PathSummary } from './store';

const STORAGE_KEY = 'lernpfadfinder.session.v1';

export interface SessionSnapshot {
  version: 1;
  savedAt: number;
  phase: Phase;
  target: DisambiguationOption | null;
  baseline: Baseline | null;
  graph: LearningGraph | null;
  path: string[];
  summary: PathSummary | null;
}

export function loadSession(): SessionSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionSnapshot;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(snapshot: Omit<SessionSnapshot, 'version' | 'savedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: SessionSnapshot = {
      version: 1,
      savedAt: Date.now(),
      ...snapshot,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // quota exceeded or disabled storage — silently ignore
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
