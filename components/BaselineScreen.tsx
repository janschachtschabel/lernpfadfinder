'use client';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { EDUCATION_LEVELS, LEARNING_PURPOSES } from '@/lib/types';
import type { Baseline, EducationLevel, LearningPurpose, PriorKnowledge } from '@/lib/types';

const LEVEL_GROUP_ORDER = ['Elementar', 'Schule', 'Hochschule', 'Beruf', 'Sonstiges'];

const PRIORS: Array<{ value: PriorKnowledge; title: string; hint: string }> = [
  { value: 'nichts',     title: 'Nichts',      hint: 'Ich fange bei null an' },
  { value: 'grundlagen', title: 'Grundlagen',  hint: 'Begriffe kenne ich' },
  { value: 'mittel',     title: 'Mittel',      hint: 'Einiges kann ich bereits' },
  { value: 'viel',       title: 'Viel',        hint: 'Möchte Details vertiefen' },
];

export function BaselineScreen() {
  const target = useStore(s => s.target);
  const setBaseline = useStore(s => s.setBaseline);
  const setPhase = useStore(s => s.setPhase);

  const [level, setLevel] = useState<EducationLevel>('sekundarstufe_2');
  const [prior, setPrior] = useState<PriorKnowledge>('grundlagen');
  const [purpose, setPurpose] = useState<LearningPurpose>('pruefung');
  const [purposeNote, setPurposeNote] = useState('');
  const [hoursPerWeek, setHoursPerWeek] = useState<number | ''>('');
  const [deadline, setDeadline] = useState('');

  const start = () => {
    const b: Baseline = {
      level, prior, purpose,
      purposeNote: purposeNote.trim() || undefined,
      hoursPerWeek: typeof hoursPerWeek === 'number' && hoursPerWeek > 0 ? hoursPerWeek : undefined,
      deadline: deadline || undefined,
    };
    setBaseline(b);
    setPhase('generating');
  };

  if (!target) { setPhase('welcome'); return null; }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-3xl w-full animate-fade-in">
        <button onClick={() => setPhase('welcome')} className="text-sm text-brand-600 hover:text-brand-800 mb-6">← Neues Thema</button>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">Kurz zu dir</h1>
        <p className="text-slate-600 mb-8">
          Damit der Lernpfad zu <b className="text-brand-700">{target.label}</b> sinnvoll tief zerlegt wird, brauche ich zwei Infos.
        </p>

        <Section title="Auf welcher Bildungsstufe willst du es lernen?">
          <div className="text-xs text-slate-500 mb-3">
            Bestimmt Zielniveau, Lerntiefe und was das System als &bdquo;bereits bekannt&ldquo; annimmt.
          </div>
          <div className="space-y-3">
            {LEVEL_GROUP_ORDER.map(group => {
              const items = EDUCATION_LEVELS.filter(l => l.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">{group}</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {items.map(l => (
                      <button
                        key={l.value}
                        onClick={() => setLevel(l.value)}
                        className={
                          'text-left p-3 rounded-xl border transition ' +
                          (level === l.value
                            ? 'bg-brand-600 border-brand-700 text-white shadow-md'
                            : 'bg-white border-slate-200 hover:border-brand-300')
                        }
                      >
                        <div className="font-medium text-sm">{l.title}</div>
                        <div className={'text-xs mt-0.5 ' + (level === l.value ? 'text-brand-100' : 'text-slate-500')}>{l.hint}</div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title={`Wie viel weißt du schon über ${target.field || 'dieses Thema'}?`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {PRIORS.map(p => (
              <button
                key={p.value}
                onClick={() => setPrior(p.value)}
                className={
                  'text-left p-3 rounded-xl border transition ' +
                  (prior === p.value
                    ? 'bg-brand-600 border-brand-700 text-white shadow-md'
                    : 'bg-white border-slate-200 hover:border-brand-300')
                }
              >
                <div className="font-medium text-sm">{p.title}</div>
                <div className={'text-xs mt-0.5 ' + (prior === p.value ? 'text-brand-100' : 'text-slate-500')}>{p.hint}</div>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Wozu brauchst du das?">
          <div className="text-xs text-slate-500 mb-2">
            Hilft dem System, die richtige Tiefe und den Ton zu wählen — vom 2-Stunden-Hausaufgabenblock bis zum lebenslangen Vertiefen.
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {LEARNING_PURPOSES.map(p => (
              <button
                key={p.value}
                onClick={() => setPurpose(p.value)}
                className={
                  'text-left p-2.5 rounded-xl border transition ' +
                  (purpose === p.value
                    ? 'bg-brand-600 border-brand-700 text-white shadow-md'
                    : 'bg-white border-slate-200 hover:border-brand-300')
                }
              >
                <div className="font-medium text-sm">{p.title}</div>
                <div className={'text-xs mt-0.5 ' + (purpose === p.value ? 'text-brand-100' : 'text-slate-500')}>{p.hint}</div>
              </button>
            ))}
          </div>

          <div className="mt-3">
            <label className="text-xs font-medium text-slate-700">
              Konkreter Anlass <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={purposeNote}
              onChange={e => setPurposeNote(e.target.value)}
              placeholder={'z.B. „Klausur am 15.6." / „Kind Klasse 7 braucht Hilfe" / „Hobby-Projekt"'}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 text-sm"
              maxLength={200}
            />
          </div>
        </Section>

        <Section title="Zeitrahmen (optional)">
          <div className="text-xs text-slate-500 mb-2">
            Wenn du Zeitrahmen angibst, kann das System später warnen, wenn der Pfad nicht reinpasst.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Stunden pro Woche</span>
              <input
                type="number"
                min={0}
                max={80}
                step={0.5}
                value={hoursPerWeek}
                onChange={e => setHoursPerWeek(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="z.B. 5"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Deadline</span>
              <input
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 text-sm"
              />
            </label>
          </div>
        </Section>

        <div className="mt-8 flex justify-end">
          <button
            onClick={start}
            className="px-8 py-3 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700 shadow-lg"
          >
            Lernpfad erzeugen →
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="text-sm font-semibold text-slate-700 mb-2">{title}</div>
      {children}
    </div>
  );
}
