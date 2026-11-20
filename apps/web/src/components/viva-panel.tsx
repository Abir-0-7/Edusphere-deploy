'use client';

import { useAuth } from '@clerk/nextjs';
import { useEffect, useRef, useState } from 'react';
import type { VivaGradeResponse, VivaQuestion } from '@studyvault/types';
import { type GetToken } from '@/lib/ai-client';
import { getVivaQuestions, gradeVivaAnswer } from '@/lib/viva-client';

type Recognition = { stop: () => void; abort?: () => void };

export function VivaPanel({ documentId }: { documentId: string }) {
  const { getToken, userId } = useAuth();
  return (
    <VivaPractice
      key={`${userId ?? 'signed-out'}:${documentId}`}
      documentId={documentId}
      getToken={getToken}
    />
  );
}

function VivaPractice({ documentId, getToken }: { documentId: string; getToken: GetToken }) {
  const [questions, setQuestions] = useState<VivaQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<VivaGradeResponse | null>(null);
  const [busy, setBusy] = useState<'questions' | 'grade' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const operation = useRef(0);
  const request = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      operation.current += 1;
      request.current?.abort();
      recognition.current?.abort?.();
      recognition.current?.stop();
    },
    [],
  );

  function begin(kind: 'questions' | 'grade') {
    request.current?.abort();
    recognition.current?.stop();
    setRecording(false);
    const controller = new AbortController();
    request.current = controller;
    setErr(null);
    setResult(null);
    setBusy(kind);
    return { controller, id: ++operation.current };
  }

  async function startQuestions() {
    const { controller, id } = begin('questions');
    setQuestions([]);
    setTranscript('');
    try {
      const next = await getVivaQuestions(getToken, documentId, controller.signal);
      if (operation.current !== id) return;
      setQuestions(next);
      setIndex(0);
    } catch (error) {
      if (operation.current === id && !controller.signal.aborted)
        setErr(error instanceof Error ? error.message : 'Viva questions could not be loaded. Try again.');
    } finally {
      if (operation.current === id) setBusy(null);
    }
  }

  const supported =
    typeof window !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vendor-prefixed Web Speech API
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  function record() {
    if (!supported) {
      setErr('This browser has no speech recognition. Type your answer below.');
      return;
    }
    if (recording) {
      recognition.current?.stop();
      return;
    }
    setTranscript('');
    setResult(null);
    setErr(null);
    const id = operation.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vendor-prefixed Web Speech API
    const RecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new RecognitionCtor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';
    rec.onresult = (event: { results: { 0: { 0: { transcript: string } } } }) => {
      if (operation.current === id) setTranscript(event.results[0][0].transcript.slice(0, 4000));
    };
    rec.onend = () => {
      if (operation.current === id) setRecording(false);
    };
    rec.onerror = () => {
      if (operation.current === id) {
        setErr('Could not hear you. Type the answer instead.');
        setRecording(false);
      }
    };
    recognition.current = rec;
    try {
      rec.start();
      setRecording(true);
    } catch {
      setErr('Microphone access is unavailable. Type the answer instead.');
    }
  }

  async function grade() {
    const question = questions[index];
    if (!question || !transcript.trim()) return;
    const { controller, id } = begin('grade');
    try {
      const evaluated = await gradeVivaAnswer(
        getToken,
        {
          question: question.question,
          expected_points: question.expected_points,
          answer: transcript,
        },
        controller.signal,
      );
      if (operation.current === id) setResult(evaluated);
    } catch (error) {
      if (operation.current === id && !controller.signal.aborted)
        setErr(error instanceof Error ? error.message : 'Viva grading failed. Try again.');
    } finally {
      if (operation.current === id) setBusy(null);
    }
  }

  const current = questions[index];
  return (
    <div className="mt-3 rounded border p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Viva Mode</h3>
        <button
          onClick={() => void startQuestions()}
          disabled={busy !== null}
          className="text-xs text-blue-600 hover:underline disabled:opacity-50"
        >
          {busy === 'questions' ? 'Loading questions…' : questions.length ? 'New questions' : 'Start viva'}
        </button>
      </div>
      {!supported && (
        <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Voice input needs Chrome/Edge with Web Speech. You can still type answers.
        </p>
      )}
      {err && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {err}
        </p>
      )}
      {current && (
        <div className="mt-3">
          <p className="text-sm font-medium">
            Q{index + 1}. {current.question}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={record}
              disabled={busy !== null}
              aria-pressed={recording}
              className={`rounded px-3 py-1.5 text-sm text-white ${recording ? 'bg-red-600' : 'bg-neutral-800'} hover:opacity-90 disabled:opacity-50`}
            >
              {recording ? 'Stop' : 'Answer'}
            </button>
            <label htmlFor="viva-answer" className="sr-only">
              Type your answer
            </label>
            <input
              id="viva-answer"
              value={transcript}
              maxLength={4000}
              disabled={busy !== null}
              onChange={(event) => {
                setTranscript(event.target.value);
                setResult(null);
              }}
              placeholder="Type your answer"
              className="min-w-0 flex-1 rounded border px-3 py-1.5 text-sm"
            />
            <button
              onClick={() => void grade()}
              disabled={busy !== null || !transcript.trim()}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === 'grade' ? 'Grading…' : 'Grade'}
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
                operation.current += 1;
                recognition.current?.stop();
                setRecording(false);
                setIndex((value) => value + 1);
                setTranscript('');
                setResult(null);
                setErr(null);
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
