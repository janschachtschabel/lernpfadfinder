'use client';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { VoiceButton, speak } from './VoiceButton';
import type { DisambiguationOption } from '@/lib/types';

export function WelcomeScreen() {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const setCandidates = useStore(s => s.setCandidates);
  const setPhase = useStore(s => s.setPhase);
  const setUserQuery = useStore(s => s.setUserQuery);
  const setError = useStore(s => s.setError);
  const candidates = useStore(s => s.candidates);
  const setTarget = useStore(s => s.setTarget);

  useEffect(() => {
    const greet = 'Willkommen bei Deinem Lernpfadfinder. Was möchtest du lernen?';
    const t = setTimeout(() => speak(greet), 400);
    return () => clearTimeout(t);
  }, []);

  const pick = (opt: DisambiguationOption) => {
    setTarget(opt);
    setPhase('baseline');
  };

  const search = async (q: string) => {
    const query = q.trim();
    if (!query) return;
    setUserQuery(query);
    setLoading(true); setError(null); setCandidates([]);
    try {
      const res = await fetch('/api/disambiguate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term: query }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Anfrage fehlgeschlagen');
      const options: DisambiguationOption[] = json.options ?? [];
      if (options.length === 0) {
        // Fallback: treat the raw query as the topic.
        pick({ label: query, description: '', field: '' });
      } else if (options.length === 1) {
        pick(options[0]);
      } else {
        setCandidates(options);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="max-w-2xl w-full animate-fade-in">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-brand-600 text-white text-4xl shadow-lg mb-8 rotate-3">
          📚
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-slate-900 tracking-tight mb-4">
          Dein <span className="text-brand-600">Lernpfadfinder</span>
        </h1>
        <p className="text-lg text-slate-600 mb-10">
          Sag mir dein Lernziel – ich zerlege es in Teilthemen, finde die Voraussetzungen und schlage dir eine persönliche Lernreihenfolge vor.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); search(text); }}
          className="flex gap-2 items-center bg-white rounded-2xl shadow-xl p-2 border border-brand-100"
        >
          <VoiceButton onTranscript={(t) => { setText(t); search(t); }} disabled={loading} />
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="z. B. Optik, Lineare Algebra, Photosynthese …"
            disabled={loading}
            autoFocus
            className="flex-1 px-3 py-3 text-lg bg-transparent outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !text.trim()}
            className="px-6 py-3 rounded-xl bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {loading ? '…' : 'Los'}
          </button>
        </form>

        {candidates.length > 0 && (
          <div className="mt-6 bg-white rounded-2xl shadow-lg border border-brand-100 p-4 text-left animate-fade-in">
            <p className="text-sm text-slate-500 mb-3">Welche Bedeutung meinst du?</p>
            <div className="grid gap-2">
              {candidates.map((c, i) => (
                <button
                  key={i}
                  onClick={() => pick(c)}
                  className="text-left px-4 py-3 rounded-xl hover:bg-brand-50 border border-slate-100 transition"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-medium text-slate-900">{c.label}</div>
                    <div className="text-xs text-brand-700 bg-brand-50 rounded px-2 py-0.5">{c.field}</div>
                  </div>
                  {c.description && <div className="text-sm text-slate-500 mt-1">{c.description}</div>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="mt-12 text-xs text-slate-400">Powered by OpenAI</div>
    </div>
  );
}
