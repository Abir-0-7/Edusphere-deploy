'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useState } from 'react';
import { getReviewQueue, submitReview, type Flashcard } from '@/lib/ai-client';
import { pendingCount, queueReview, syncReviews } from '@/lib/offline-reviews';

/**
 * Daily review queue (task 2.12). Cards due today are shown one at a time;
 * grading posts to the server, which computes the SM-2 schedule — the client
 * never decides intervals.
 */
export default function ReviewPage() {
  const { getToken } = useAuth();
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);

  /** Push anything queued while offline; server de-duplicates by uuid. */
  const flush = useCallback(async () => {
    const token = await getToken();
    const result = await syncReviews(async (row) => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000'}/api/flashcards/${row.cardId}/review`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
          body: JSON.stringify({ grade: row.grade, review_id: row.uuid }),
        },
      ).catch(() => null);
      return Boolean(res?.ok);
    });
    setPending(await pendingCount());
    return result;
  }, [getToken]);

  useEffect(() => {
    void flush();
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flush]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCards(await getReviewQueue(getToken));
      setIndex(0);
      setRevealed(false);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load queue');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const grade = async (value: number) => {
    const card = cards[index];
    if (!card) return;
    setRevealed(false);
    setIndex((i) => i + 1);
    try {
      await submitReview(getToken, card.id, value);
    } catch {
      // Offline or server unreachable: queue it. The review is not lost and a
      // reconnect syncs it exactly once (task 3.4).
      await queueReview(card.id, value);
      setPending(await pendingCount());
    }
  };

  const card = cards[index];

  return (
    <main className="mx-auto max-w-2xl p-6" aria-busy={loading}>
      <h1 className="text-2xl font-bold">Review</h1>
      <p className="mt-1 text-sm text-neutral-600" role="status" aria-live="polite">
        {loading ? 'Loading…' : `${Math.max(0, cards.length - index)} card(s) left today`}
        {pending > 0 && <span className="ml-2 text-amber-700">· {pending} queued offline</span>}
      </p>
      {err && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {err}
        </p>
      )}

      {loading && (
        <div
          className="mt-6 animate-pulse rounded border p-6"
          aria-label="Loading review queue"
          aria-busy="true"
        >
          <div className="h-3 w-16 rounded bg-neutral-200" />
          <div className="mt-3 h-6 w-3/4 rounded bg-neutral-200" />
          <div className="mt-6 h-10 w-32 rounded bg-neutral-200" />
        </div>
      )}

      {!loading && err && (
        <button onClick={() => void load()} className="mt-3 text-sm text-blue-600 hover:underline">
          Try loading again
        </button>
      )}

      {!loading && !err && !card && (
        <div className="mt-6 rounded border p-6 text-center">
          <p className="text-neutral-700">Nothing due right now. 🎉</p>
          <button onClick={load} className="mt-3 text-sm text-blue-600 hover:underline">
            Refresh
          </button>
        </div>
      )}

      {!loading && card && (
        <div className="mt-6 rounded border p-6">
          <p className="text-xs uppercase tracking-wide text-neutral-600">Front</p>
          <p className="mt-1 text-lg">{card.front}</p>
          {revealed ? (
            <>
              <p className="mt-4 text-xs uppercase tracking-wide text-neutral-600">Back</p>
              <p className="mt-1 text-neutral-800">{card.back}</p>
              <div className="mt-6 grid grid-cols-4 gap-2">
                {[
                  { label: 'Again', value: 1, cls: 'bg-red-600' },
                  { label: 'Hard', value: 3, cls: 'bg-orange-500' },
                  { label: 'Good', value: 4, cls: 'bg-blue-600' },
                  { label: 'Easy', value: 5, cls: 'bg-green-600' },
                ].map((b) => (
                  <button
                    key={b.value}
                    onClick={() => void grade(b.value)}
                    className={`rounded px-3 py-2 text-sm text-white ${b.cls} hover:opacity-90`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button
              onClick={() => setRevealed(true)}
              className="mt-6 rounded bg-neutral-800 px-4 py-2 text-sm text-white hover:bg-neutral-900"
            >
              Show answer
            </button>
          )}
        </div>
      )}
    </main>
  );
}
