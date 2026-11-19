'use client';

import { useState } from 'react';
import type { QuizGradeResult, QuizSession, StudioDeck } from '@studyvault/types';
import { exportStudioDeckCsv, gradeFlashcardQuiz, startFlashcardQuiz } from '@/lib/flashcard-studio-client';
import type { GetToken } from '@/lib/ai-client';

type Props = {
  documentId: string;
  deck: StudioDeck;
  getToken: GetToken;
};

const button = 'rounded border border-blue-700 px-3 py-1.5 text-sm font-medium text-blue-800 disabled:opacity-50';
const primary = 'rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50';

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function FlashcardQuiz({ documentId, deck, getToken }: Props) {
  const [session, setSession] = useState<QuizSession | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizGradeResult | null>(null);
  const [count, setCount] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  async function exportCsv() {
    setBusy(true);
    setError('');
    setStatus('Preparing CSV export.');
    try {
      const blob = await exportStudioDeckCsv(getToken, documentId, deck.id);
      download(blob, `flashcards-${deck.name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 50) || 'deck'}.csv`);
      setStatus('CSV download started. Formula-like cell values are escaped for spreadsheet safety.');
    } catch (cause) {
      setStatus('');
      setError(cause instanceof Error ? cause.message : 'CSV export failed.');
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError('');
    setStatus('Building a quiz from source-supported saved cards.');
    try {
      const created = await startFlashcardQuiz(getToken, documentId, { deck_id: deck.id, count: Number(count) });
      setSession(created);
      setAnswers({});
      setResult(null);
      setStatus(`${created.questions.length} source-grounded questions ready.`);
    } catch (cause) {
      setStatus('');
      setError(cause instanceof Error ? cause.message : 'Quiz could not start.');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!session || result) return;
    setBusy(true);
    setError('');
    setStatus('Grading your answers.');
    try {
      const graded = await gradeFlashcardQuiz(getToken, session.id, {
        answers: Object.entries(answers).map(([question_id, choice_id]) => ({ question_id, choice_id })),
      });
      setResult(graded);
      setStatus('Quiz graded. Review the source evidence for each question below.');
    } catch (cause) {
      setStatus('');
      setError(cause instanceof Error ? cause.message : 'Quiz could not be graded.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSession(null);
    setAnswers({});
    setResult(null);
    setError('');
    setStatus('');
  }

  return (
    <section className="mt-3 rounded border border-neutral-300 p-3" aria-label="Source quiz and CSV export">
      <h3 className="font-semibold">Practice and export</h3>
      {!session && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Questions
            <input
              className="ms-2 w-20 rounded border px-2 py-1.5"
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(event) => setCount(event.target.value)}
              aria-label="Number of quiz questions"
            />
          </label>
          <button type="button" className={primary} disabled={busy || deck.card_count < 2} onClick={() => void start()}>
            Start source quiz
          </button>
          {deck.card_count < 2 && <span className="text-xs text-neutral-700">Save at least two cards for quiz practice.</span>}
        </div>
      )}
      <button
        type="button"
        className={`${button} mt-2`}
        disabled={busy || deck.card_count === 0}
        onClick={() => void exportCsv()}
      >
        Download deck CSV
      </button>
      {session && (
        <div className="mt-3 space-y-3">
          <h4 className="font-medium">Source quiz</h4>
          {session.questions.map((question, index) => (
            <fieldset key={question.id} disabled={busy || result !== null} className="rounded border p-3">
              <legend className="px-1 text-sm font-semibold">Question {index + 1}</legend>
              <p className="text-sm">{question.prompt}</p>
              <div className="mt-2 space-y-1">
                {question.choices.map((choice) => (
                  <label key={choice.id} className="flex gap-2 text-sm">
                    <input
                      type="radio"
                      name={question.id}
                      value={choice.id}
                      checked={answers[question.id] === choice.id}
                      onChange={() => setAnswers((previous) => ({ ...previous, [question.id]: choice.id }))}
                    />
                    <span>{choice.text}</span>
                  </label>
                ))}
              </div>
              {result && (() => {
                const feedback = result.feedback.find((item) => item.question_id === question.id);
                if (!feedback) return null;
                return (
                  <div className="mt-2 border-s-2 border-blue-500 ps-2 text-xs" aria-label={`Question ${index + 1} feedback`}>
                    <p>{!feedback.answered ? 'Not answered.' : feedback.correct ? 'Correct.' : 'Review this answer.'}</p>
                    <p className="mt-1 whitespace-pre-wrap">Source{feedback.page === null ? '' : ` (page ${feedback.page})`}: {feedback.source_quote}</p>
                  </div>
                );
              })()}
            </fieldset>
          ))}
          {result ? (
            <div role="status" className="rounded bg-blue-50 p-3 text-sm">
              Score: {result.correct} of {result.total} ({result.percent}%).
              <button type="button" className={`${button} ms-3`} onClick={reset}>Close quiz</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primary} disabled={busy} onClick={() => void submit()}>Submit quiz</button>
              <button type="button" className={button} disabled={busy} onClick={reset}>Cancel quiz</button>
            </div>
          )}
        </div>
      )}
      {status && <p role="status" className="mt-2 text-sm">{status}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
