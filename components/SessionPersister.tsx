'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { loadSession, saveSession, clearSession } from '@/lib/persistence';

/**
 * Drop-in component that wires the store to localStorage.
 *  - On mount, rehydrates last session (only if user is on welcome phase).
 *  - Subscribes to key slices and writes snapshots (throttled to microtask).
 *  - Clearing happens when user explicitly returns to welcome via "Neues Thema".
 */
export function SessionPersister() {
  const hydrated = useRef(false);
  const saveScheduled = useRef(false);

  // --- Rehydrate once -------------------------------------------------------
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const snap = loadSession();
    if (!snap) return;
    // Only rehydrate if current store is still pristine (welcome + no graph),
    // so we don't overwrite a user-initiated fresh session.
    const st = useStore.getState();
    if (st.phase !== 'welcome' || st.graph) return;
    if (snap.phase === 'welcome') return;
    useStore.setState({
      phase: snap.phase,
      target: snap.target,
      baseline: snap.baseline,
      graph: snap.graph,
      path: snap.path,
      summary: snap.summary,
    });
  }, []);

  // --- Autosave on relevant changes ----------------------------------------
  useEffect(() => {
    const unsub = useStore.subscribe((state) => {
      // Don't persist while generating (partial tree is confusing on reload),
      // but DO persist as soon as we land in explore / path.
      if (state.phase === 'welcome' || state.phase === 'baseline') {
        clearSession();
        return;
      }
      if (saveScheduled.current) return;
      saveScheduled.current = true;
      queueMicrotask(() => {
        saveScheduled.current = false;
        const s = useStore.getState();
        saveSession({
          phase: s.phase,
          target: s.target,
          baseline: s.baseline,
          graph: s.graph,
          path: s.path,
          summary: s.summary,
        });
      });
    });
    return () => unsub();
  }, []);

  return null;
}
