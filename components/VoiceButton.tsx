'use client';
import { useRef, useState } from 'react';

interface Props {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

/** Hold-to-record mic button: records while mouse/touch is held, sends to /api/stt on release. */
export function VoiceButton({ onTranscript, disabled, className }: Props) {
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);

  const start = async () => {
    if (disabled || recording || loading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size < 800) return; // ignore accidental clicks
        setLoading(true);
        try {
          const form = new FormData();
          form.append('audio', new File([blob], 'audio.webm', { type: 'audio/webm' }));
          const res = await fetch('/api/stt', { method: 'POST', body: form });
          const json = await res.json();
          if (json.text) onTranscript(json.text);
        } finally {
          setLoading(false);
        }
      };
      mediaRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      console.warn('Mic access failed', e);
    }
  };
  const stop = () => {
    if (mediaRef.current && recording) {
      mediaRef.current.stop();
      setRecording(false);
    }
  };

  return (
    <button
      type="button"
      disabled={disabled || loading}
      onMouseDown={start}
      onMouseUp={stop}
      onMouseLeave={stop}
      onTouchStart={(e) => { e.preventDefault(); start(); }}
      onTouchEnd={(e) => { e.preventDefault(); stop(); }}
      className={
        'inline-flex items-center justify-center rounded-full transition-all shadow-sm select-none ' +
        (recording ? 'bg-red-500 text-white scale-110 animate-pulse' :
         loading ? 'bg-slate-300 text-slate-600 cursor-wait' :
         'bg-white text-brand-700 hover:bg-brand-50 border border-brand-200') +
        ' ' + (className ?? 'w-12 h-12')
      }
      title={recording ? 'Aufnahme läuft – loslassen zum Senden' : 'Gedrückt halten zum Sprechen'}
    >
      {loading ? (
        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20"/>
        </svg>
      ) : (
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11Z"/>
        </svg>
      )}
    </button>
  );
}

/** Speak text aloud via /api/tts */
export async function speak(text: string) {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().catch(() => {});
    audio.onended = () => URL.revokeObjectURL(url);
  } catch { /* ignore */ }
}
