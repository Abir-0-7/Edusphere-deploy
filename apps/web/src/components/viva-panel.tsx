'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useRef, useState } from 'react';

/** Viva Mode (task 4.4): Web Speech API questions + grading. The browser does
 * speech-to-text; the server only ever sees the transcript. If the browser
 * lacks Web Speech support a clear message replaces the mic button. */

interface VivaQuestion {
  question: string;
  expected_points: string[];
}
interface VivaGrade {
  score: number;
  feedback: string;
  covered: string[];
  missed: string[];
}

const baseUrl = () => process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';

export function VivaPanel({ documentId }: { documentId: string }) {
  const { getToken } = useAuth();
  const [questions, setQuestions] = useState<VivaQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<VivaGrade | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const recognition = useRef<{ stop: () => void } | null>(null);

  const startQuestions = useCallback(async () => {
    setErr(null);
    setBusy(true);
    setResult(null);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl()}/api/documents/${documentId}/viva-questions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token ?? ''}` },
      });
      if (!res.ok) throw new Error('viva questions failed');
      const qs = (await res.json()) as VivaQuestion[];
      setQuestions(qs);
      setIndex(0);
    } catch {
      setErr('Could not start a viva — try a document with chapters.');
    } finally {
      setBusy(false);
    }
  }, [documentId, getToken]);

  const supported =
    typeof window !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vendor-prefixed API detection
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const record = useCallback(() => {
    if (!supported) {
      setErr('This browser has no speech recognition — type your answer below.');
      return;
    }
    if (recording) {
      recognition.current?.stop();
      return;
    }
    setTranscript('');
    setResult(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vendor-prefixed Web Speech API
    const RecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new RecognitionCtor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';
    rec.onresult = (event: { results: { 0: { 0: { transcript: string } } } }) => {
      setTranscript(event.results[0][0].transcript);
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => {
      setErr('Could not hear you — type the answer instead.');
      setRecording(false);
    };
    recognition.current = rec;
    rec.start();
    setRecording(true);
  }, [recording, supported]);

  const grade = useCallback(async () => {
    const q = questions[index];
    if (!q || !transcript.trim()) return;
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl()}/api/viva-grade`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          question: q.question,
          expected_points: q.expected_points,
          answer: transcript,
        }),
      });
      setResult((await res.json()) as VivaGrade);
    } catch {
      setErr('Grading failed.');
    } finally {
      setBusy(false);
    }
  }, [getToken, index, questions, transcript]);

  const current = questions[index];

  return (
    <div className="mt-3 rounded border p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Viva Mode</h3>
        <button
          onClick={() => void startQuestions()}
          disabled={busy}
          className="text-xs text-blue-600 hover:underline disabled:opacity-50"
        >
          {busy ? 'Loading…' : questions.length ? 'New questions' : 'Start viva'}
        </button>
      </div>
      {!supported && (
        <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Voice input needs Chrome/Edge with Web Speech. You can still type answers.
        </p>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}

      {current && (
        <div className="mt-3">
          <p className="text-sm font-medium">
            Q{index + 1}. {current.question}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={record}
              aria-pressed={recording}
              className={`rounded px-3 py-1.5 text-sm text-white ${recording ? 'bg-red-600' : 'bg-neutral-800'} hover:opacity-90`}
            >
              {recording ? 'Stop' : 'Answer'}
            </button>
            <label htmlFor="viva-answer" className="sr-only">Type your answer</label>
            <input
              id="viva-answer"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Type your answer"
              className="flex-1 rounded border px-3 py-1.5 text-sm"
            />
            <button
              onClick={() => void grade()}
              disabled={busy || !transcript.trim()}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Grade
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded bg-neutral-50 p-3 text-sm">
          <p className="font-medium">Score {result.score}/5</p>
          <p className="mt-1 text-neutral-700">{result.feedback}</p>
          {index + 1 < questions.length && (
            <button
              onClick={() => {
                setIndex((i) => i + 1);
                setTranscript('');
                setResult(null);
              }}
              className="mt-2 text-xs text-blue-600 hover:underline"
            >
              Next question →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
