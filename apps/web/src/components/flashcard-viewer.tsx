'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlashcardResponse } from '@studyvault/types';
import { explainFlashcard, type GetToken } from '@/lib/ai-client';

type Props = {
  cards: FlashcardResponse[];
  documentId: string;
  deckId: string | null;
  userId: string | null;
  getToken: GetToken;
};

type SavedSession = {
  version: 1;
  orderIds: string[];
  index: number;
  missedIds: string[];
  practiceMissed: boolean;
  revealed: boolean;
};

export const flashcardViewerSessionKey = (userId: string | null, documentId: string, deckId: string | null) => (
  `studyvault:flashcard-viewer:${userId ?? 'signed-out'}:${documentId}:${deckId ?? 'all'}`
);

export function readFlashcardViewerSession(
  raw: string | null,
  availableIds: readonly string[],
): SavedSession | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (
      record.version !== 1
      || !Array.isArray(record.orderIds)
      || !Array.isArray(record.missedIds)
      || !record.orderIds.every((id) => typeof id === 'string')
      || !record.missedIds.every((id) => typeof id === 'string')
      || typeof record.index !== 'number'
      || !Number.isInteger(record.index)
      || record.index < 0
      || typeof record.practiceMissed !== 'boolean'
      || typeof record.revealed !== 'boolean'
    ) return null;
    const valid = new Set(availableIds);
    const orderIds = [...new Set((record.orderIds as string[]).filter((id) => valid.has(id)))];
    const missedIds = [...new Set((record.missedIds as string[]).filter((id) => valid.has(id)))];
    if (orderIds.length > 1000 || missedIds.length > 1000) return null;
    return {
      version: 1,
      orderIds,
      index: Math.min(record.index, Math.max(0, orderIds.length - 1)),
      missedIds,
      practiceMissed: record.practiceMissed && missedIds.length > 0,
      revealed: record.revealed,
    };
  } catch {
    return null;
  }
}

export function FlashcardViewer({ cards, documentId, deckId, userId, getToken }: Props) {
  const shell = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [order, setOrder] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [missed, setMissed] = useState<Set<string>>(new Set());
  const [practiceMissed, setPracticeMissed] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{ quote: string; page: number | null } | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const storageKey = flashcardViewerSessionKey(userId, documentId, deckId);

  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const availableIds = useMemo(() => cards.map((card) => card.id), [cards]);
  const activeIds = useMemo(() => {
    const source = practiceMissed
      ? (order.length ? order.filter((id) => missed.has(id)) : [...missed])
      : (order.length ? order : availableIds);
    return source.filter((id) => cardById.has(id));
  }, [availableIds, cardById, missed, order, practiceMissed]);
  const card = activeIds[index] ? cardById.get(activeIds[index]) : undefined;

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, activeIds.length - 1)));
  }, [activeIds.length]);

  useEffect(() => {
    if (!userId) return;
    const saved = (() => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        return readFlashcardViewerSession(raw, availableIds);
      } catch {
        return null;
      }
    })();
    const storedMissed = (saved?.missedIds ?? []).filter((id) => cardById.has(id));
    const savedOrder = saved?.orderIds?.length
      ? [
          ...saved.orderIds.filter((id) => cardById.has(id)),
          ...availableIds.filter((id) => !saved.orderIds.includes(id)),
        ]
      : [];
    const sessionLength = saved?.practiceMissed
      ? savedOrder.filter((id) => storedMissed.includes(id)).length
      : availableIds.length;
    setIndex(Math.min(Math.max(saved?.index ?? 0, 0), Math.max(0, sessionLength - 1)));
    setMissed(new Set(storedMissed));
    setOrder(savedOrder);
    setPracticeMissed(saved?.practiceMissed ?? false);
    setRevealed(saved?.revealed ?? false);
    setExplanation(null);
    setEvidence(null);
    setExplainError(null);
    setHydratedKey(storageKey);
  }, [availableIds, cardById, storageKey, userId]);

  useEffect(() => {
    if (!card || !userId || hydratedKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
        version: 1,
        orderIds: order.length ? order : availableIds,
        index,
        missedIds: [...missed],
        practiceMissed,
        revealed,
      } satisfies SavedSession));
    } catch {
      // Resume is an enhancement; private study state remains server-owned.
    }
  }, [availableIds, card, deckId, documentId, hydratedKey, index, missed, order, practiceMissed, revealed, storageKey, userId]);

  const move = useCallback((delta: number) => {
    setIndex((current) => Math.min(Math.max(current + delta, 0), Math.max(0, activeIds.length - 1)));
    setRevealed(false);
    setExplanation(null);
    setEvidence(null);
    setExplainError(null);
  }, [activeIds.length]);

  function shuffle() {
    const next = [...availableIds];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j]!, next[i]!];
    }
    setOrder(next);
    setPracticeMissed(false);
    setIndex(0);
    setRevealed(false);
  }

  function markMissed() {
    if (!card) return;
    setMissed((current) => new Set(current).add(card.id));
    setRevealed(true);
  }

  function practiceMissedCards() {
    if (!missed.size) return;
    setPracticeMissed(true);
    setIndex(0);
    setRevealed(false);
    setExplanation(null);
  }

  function markRemembered() {
    if (!card) return;
    const next = new Set(missed);
    next.delete(card.id);
    setMissed(next);
    if (practiceMissed) setIndex((current) => Math.min(current, Math.max(0, next.size - 1)));
  }

  async function explain() {
    if (!card || explaining) return;
    setExplaining(true);
    setExplainError(null);
    try {
      const result = await explainFlashcard(getToken, card.id);
      if (!result.available) throw new Error('The original supporting evidence is no longer available.');
      setExplanation(result.explanation);
      setEvidence({ quote: result.source_excerpt ?? result.source_quote, page: result.page });
    } catch (error) {
      setExplainError(error instanceof Error ? error.message : 'Explanation unavailable.');
    } finally {
      setExplaining(false);
    }
  }

  if (!userId) return <p className="mt-3 text-sm text-neutral-600">Sign in to open your saved-card viewer.</p>;
  if (!card) {
    if (cards.length > 0 && practiceMissed && missed.size === 0) {
      return (
        <section className="mt-4 rounded border border-blue-200 bg-blue-50/40 p-4" aria-label="Flashcard viewer">
          <p role="status" className="text-sm">You cleared every missed card.</p>
          <button type="button" className="mt-2 rounded border px-3 py-1.5 text-sm" onClick={() => { setPracticeMissed(false); setIndex(0); }}>
            Return to all cards
          </button>
        </section>
      );
    }
    return <p className="mt-3 text-sm text-neutral-600">Save cards to open the study viewer.</p>;
  }

  return (
    <section ref={shell} className="mt-4 rounded border border-blue-200 bg-blue-50/40 p-4" aria-label="Flashcard viewer">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Study viewer</h3>
        <span className="text-xs text-neutral-700">
          {practiceMissed ? 'Missed-card practice · ' : ''}{index + 1} / {activeIds.length}
        </span>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded bg-blue-100"
        role="progressbar"
        aria-label="Study progress"
        aria-valuenow={index + 1}
        aria-valuemin={1}
        aria-valuemax={activeIds.length}
      >
        <div className="h-full bg-blue-700 transition-all" style={{ width: `${((index + 1) / activeIds.length) * 100}%` }} />
      </div>
      <button
        type="button"
        className="mt-4 min-h-40 w-full rounded border border-blue-300 bg-white p-5 text-left shadow-sm"
        aria-label={revealed ? 'Hide answer' : 'Reveal answer'}
        onClick={() => setRevealed((value) => !value)}
      >
        <span className="block text-xs font-semibold uppercase tracking-wide text-blue-700">Question</span>
        <span className="mt-2 block text-lg font-medium">{card.front}</span>
        {revealed && (
          <span className="mt-6 block border-t pt-4">
            <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-600">Answer</span>
            <span className="mt-2 block whitespace-pre-wrap">{card.back}</span>
          </span>
        )}
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => move(-1)} disabled={index === 0}>Previous</button>
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setRevealed((value) => !value)}>{revealed ? 'Hide' : 'Reveal'}</button>
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => move(1)} disabled={index >= activeIds.length - 1}>Next</button>
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={shuffle}>Shuffle</button>
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm"
          onClick={() => {
            const fullscreen = shell.current?.requestFullscreen?.();
            void fullscreen?.catch(() => setExplainError('Full screen is unavailable in this browser.'));
          }}
        >
          Full screen
        </button>
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={markMissed}>Mark missed</button>
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={markRemembered} disabled={!missed.has(card.id)}>Got it</button>
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={practiceMissedCards} disabled={!missed.size}>
          Practice missed ({missed.size})
        </button>
        {practiceMissed && <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => { setPracticeMissed(false); setIndex(0); }}>All cards</button>}
      </div>
      <div className="mt-3 border-t pt-3">
        <button type="button" className="text-sm font-medium text-blue-800 hover:underline" onClick={() => void explain()} disabled={explaining}>
          {explaining ? 'Explaining…' : 'Explain with source'}
        </button>
        {explanation && <p className="mt-2 text-sm">{explanation}</p>}
        {evidence && (
          <blockquote className="mt-2 border-s-2 border-blue-400 ps-3 text-sm text-neutral-700">
            {evidence.page === null ? '' : `Page ${evidence.page}: `}{evidence.quote}
          </blockquote>
        )}
        {explainError && <p role="alert" className="mt-2 text-sm text-red-700">{explainError}</p>}
      </div>
    </section>
  );
}
