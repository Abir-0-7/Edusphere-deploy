'use client';

import { useSession } from '@clerk/nextjs';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getReviewQueue, submitReview, type Flashcard, type GetToken } from '@/lib/ai-client';
import { pendingCount, queueReview, syncReviews } from '@/lib/offline-reviews';

/** Grading remains server-side; the client only shows the review queue and submits a grade. */
export default function ReviewPage() {
  const { isLoaded, session } = useSession();
  const getToken = useCallback(() => session?.getToken() ?? Promise.resolve(null), [session]);
  if (!isLoaded || !session) return <p role="status" className="p-6">Loading your review account.</p>;
  return <AccountReviewPage key={`${session.user.id}:${session.id}`} ownerId={session.user.id} getToken={getToken} />;
}

function AccountReviewPage({ ownerId, getToken }: { ownerId: string; getToken: GetToken }) {
  const active = useRef(true);
  const grading = useRef(false);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const accountToken = useCallback(async () => {
    if (!active.current) throw new Error('Review account changed');
    const token = await getToken();
    if (!active.current || !token) throw new Error('Review account changed');
    return token;
  }, [getToken]);

  const flush = useCallback(async () => {
    const result = await syncReviews(ownerId, async (row) => {
      await submitReview(accountToken, row.cardId, row.grade, row.uuid);
      return true;
    }, () => active.current);
    const count = await pendingCount(ownerId);
    if (!active.current) return result;
    setPending(count);
    setSyncError(null);
    return result;
  }, [accountToken, ownerId]);

  useEffect(() => {
    const sync = () => {
      void flush().catch(() => { if (active.current) setSyncError('Offline reviews could not be synced. We will try again when you reconnect.'); });
    };
    sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [flush]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const queue = await getReviewQueue(accountToken);
      if (!active.current) return;
      setCards(queue);
      setIndex(0);
      setRevealed(false);
    } catch (error) {
      if (active.current) setErr(error instanceof Error ? error.message : 'Your review queue could not be loaded.');
    } finally {
      if (active.current) setLoading(false);
    }
  }, [accountToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const grade = async (value: number) => {
    const card = cards[index];
    if (!card || grading.current || !active.current) return;
    grading.current = true;
    try {
      // Persist the same event UUID before the first attempt, including retries
      // after a lost response, so one scheduled review has one server effect.
      await queueReview(ownerId, card.id, value);
      if (!active.current) return;
      setRevealed(false);
      setIndex((current) => current + 1);
      await flush();
    } catch {
      if (active.current) setSyncError('This review could not be saved offline. Refresh your queue after reconnecting.');
    } finally {
      grading.current = false;
    }
  };

  const card = cards[index];
  const remaining = Math.max(0, cards.length - index);
  const progress = cards.length ? Math.round((index / cards.length) * 100) : 0;

  return (
    <main className="workspace-page space-y-6" aria-busy={loading}>
      <header className="page-heading-row">
        <div>
          <p className="page-kicker">REMEMBER WHAT YOU LEARN</p>
          <h1 className="page-heading">Flashcard review</h1>
          <p className="page-subtitle">A little active recall today makes your next lesson easier.</p>
        </div>
        <Link href="/library" className="action-secondary">Open my library <span aria-hidden="true">→</span></Link>
      </header>

      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3" role="status" aria-live="polite">
          <p className="text-sm text-[var(--muted)]">
            {loading ? 'Loading your review queue…' : err ? 'Review queue unavailable' : `${remaining} ${remaining === 1 ? 'card' : 'cards'} left today`}
          </p>
          {pending > 0 && <span className="rounded border border-[#e8d8b6] bg-[#fff9ed] px-3 py-1 text-xs text-[#75551f]">{pending} queued offline</span>}
          {!loading && !err && cards.length > 0 && <span className="text-xs font-medium text-[var(--forest)]">{Math.min(index, cards.length)} of {cards.length} reviewed</span>}
        </div>
        {syncError && <p className="mb-4 rounded border border-[#e8d8b6] bg-[#fff9ed] p-3 text-sm text-[#75551f]" role="status">{syncError}</p>}

        {loading && (
          <div className="surface animate-pulse p-7 sm:p-10" aria-label="Loading review queue">
            <div className="h-3 w-20 rounded bg-[#e6eee8]" />
            <div className="mt-6 h-6 w-3/4 rounded bg-[#e6eee8]" />
            <div className="mt-3 h-5 w-1/2 rounded bg-[#e6eee8]" />
            <div className="mt-12 h-10 w-36 rounded bg-[#e6eee8]" />
          </div>
        )}

        {!loading && err && (
          <section className="surface border-[#eed9ca] p-6 sm:p-8" role="alert">
            <p className="page-kicker text-[#a8522a]">LET'S RECONNECT</p>
            <h2 className="section-heading">Your flashcards could not be loaded</h2>
            <p className="mt-3 break-words text-sm leading-6 text-[var(--muted)]">{err}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={() => void load()} className="action-primary">Try loading again</button>
              <Link href="/library" className="action-secondary">Return to library</Link>
            </div>
          </section>
        )}

        {!loading && !err && !card && (
          <section className="surface p-7 text-center sm:p-10">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--mint)] font-serif text-2xl text-[var(--forest)]" aria-hidden="true">✓</span>
            <p className="page-kicker mt-5">A LITTLE ROOM TO BREATHE</p>
            <h2 className="font-serif text-2xl">{cards.length ? 'Your review session is complete' : 'Nothing is due right now'}</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">
              {cards.length ? 'Good work making time for recall. Keep learning, or take a short break before your next session.' : 'Add a PDF and generate flashcards from its document tools. Your due cards will appear here when they are ready for review.'}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/library" className="action-primary">Back to my library <span aria-hidden="true">→</span></Link>
              <button type="button" onClick={() => void load()} className="action-secondary">Refresh queue</button>
            </div>
          </section>
        )}

        {!loading && !err && card && (
          <section className="surface overflow-hidden">
            <div className="h-1 bg-[#e2ebe4]" role="progressbar" aria-label="Cards reviewed this session" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="h-full bg-[var(--forest)] transition-[width]" style={{ width: `${progress}%` }} />
            </div>
            <div className="p-6 sm:p-9">
              <div className="flex items-center justify-between">
                <p className="page-kicker mb-0">RECALL BEFORE YOU REVEAL</p>
                <span className="rounded bg-[#f2f6f2] px-2 py-1 text-xs text-[var(--muted)]">Card {index + 1}</span>
              </div>
              <h2 className="mt-7 whitespace-pre-wrap font-serif text-2xl leading-relaxed">{card.front}</h2>
              {revealed ? (
                <>
                  <div className="mt-7 border-t border-[var(--line)] pt-6">
                    <p className="page-kicker">ANSWER</p>
                    <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-[#43564a]">{card.back}</p>
                  </div>
                  <div className="mt-8 border-t border-[var(--line)] pt-5">
                    <p className="mb-3 text-sm text-[var(--muted)]">How well did you remember?</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        { label: 'Again', value: 1, cls: 'border-[#e5c8be] bg-[#fff5ef] text-[#8b3722]' },
                        { label: 'Hard', value: 3, cls: 'border-[#e8d7b2] bg-[#fff9e9] text-[#775018]' },
                        { label: 'Good', value: 4, cls: 'border-[#b7d7c4] bg-[#eef8f1] text-[#255e3b]' },
                        { label: 'Easy', value: 5, cls: 'border-[#14543f] bg-[#176b50] text-white' },
                      ].map((button) => (
                        <button key={button.value} type="button" onClick={() => void grade(button.value)} className={`min-h-11 rounded border px-3 py-2 text-sm font-semibold ${button.cls} hover:opacity-80`}>
                          {button.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="mt-10 border-t border-[var(--line)] pt-5">
                  <p className="mb-4 text-sm text-[var(--muted)]">Take a moment to form your answer, then check what you remembered.</p>
                  <button type="button" onClick={() => setRevealed(true)} className="action-primary">Show answer</button>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
