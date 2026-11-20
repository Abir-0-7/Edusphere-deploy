'use client';

import { useAuth } from '@clerk/nextjs';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SummaryPanel } from '@/components/summary-panel';
import { ExamPlanPanel } from '@/components/exam-plan-panel';
import { FlashcardStudio } from '@/components/flashcard-studio';
import { FlashcardEditor } from '@/components/flashcard-editor';
import { FlashcardViewer } from '@/components/flashcard-viewer';
import { MindMapPanel } from '@/components/mindmap-panel';
import { TtsPlayer } from '@/components/tts-player';
import { VivaPanel } from '@/components/viva-panel';
import {
  askQuestion,
  generateFlashcards,
  getChapters,
  getConceptGraphNodeActions,
  pollJob,
  uploadPdf,
} from '@/lib/ai-client';
import { loadFlashcardDeck } from '@/lib/offline-deck-client';
import { cacheFlashcardDeck } from '@/lib/offline-reviews';
import type { Chapter, ChatReply, Flashcard, JobStatus } from '@/lib/ai-types';
import type { ConceptGraphNodeActions } from '@studyvault/types';
import { readGraphHandoff } from '@/lib/concept-graph-actions';
import { pollUploadJobs } from '../../library/library-polling';

/**
 * Document page (tasks 2.3, 2.5, 2.6, 2.10): upload a PDF, poll its job,
 * list chapters, ask questions with citations.
 */
export default function DocumentPage() {
  const { getToken, userId } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const documentId = params?.id ?? '';
  const pendingJobId = searchParams.get('job');
  const graphNodeId = searchParams.get('graph_node');
  const graphRevision = searchParams.get('graph_revision');
  const graphAction = searchParams.get('graph_action');
  const [job, setJob] = useState<JobStatus | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [cardsSource, setCardsSource] = useState<'server' | 'offline' | null>(null);
  const [cardsCachedAt, setCardsCachedAt] = useState<number | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [mapSource, setMapSource] = useState<ConceptGraphNodeActions['source']>(null);
  const [mapPracticeIds, setMapPracticeIds] = useState<string[] | null>(null);
  const [mapHandoffStatus, setMapHandoffStatus] = useState('');
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<ChatReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stopPoll = useRef<(() => void) | null>(null);
  const selectedDeckRef = useRef<string | null>(null);
  const deckLoadRef = useRef(0);
  const chapterLoadRef = useRef(0);
  const identityRef = useRef({ ownerId: userId ?? null, documentId });
  identityRef.current = { ownerId: userId ?? null, documentId };

  useEffect(() => {
    setJob(null);
    setChapters([]);
    setCards([]);
    setCardsSource(null);
    setCardsCachedAt(null);
    setSelectedDeckId(null);
    selectedDeckRef.current = null;
    deckLoadRef.current += 1;
    chapterLoadRef.current += 1;
    setViewerOpen(false);
    setMapSource(null);
    setMapPracticeIds(null);
    setMapHandoffStatus('');
    setSelectedChapter(null);
    setChat(null);
  }, [documentId, userId]);

  const loadChapters = useCallback(async () => {
    if (!userId || !documentId || documentId === 'new') return;
    const request = ++deckLoadRef.current;
    const chapterRequest = ++chapterLoadRef.current;
    const ownerAtRequest = userId;
    const isCurrentIdentity = () =>
      identityRef.current.ownerId === ownerAtRequest && identityRef.current.documentId === documentId;
    const isCurrentRequest = () => request === deckLoadRef.current && isCurrentIdentity();
    setErr(null);
    void getChapters(getToken, documentId)
      .then((list) => {
        if (!isCurrentIdentity() || chapterRequest !== chapterLoadRef.current) return;
        setChapters(list);
        setSelectedChapter((prev) => prev ?? list[0] ?? null);
      })
      .catch((e: unknown) => {
        if (!isCurrentIdentity() || chapterRequest !== chapterLoadRef.current) return;
        setErr(e instanceof Error ? e.message : 'Chapters could not be loaded.');
      });
    if (!isCurrentRequest()) return;
    const deckAtRequest = selectedDeckRef.current;
    try {
      const loaded = await loadFlashcardDeck(
        getToken,
        ownerAtRequest,
        documentId,
        deckAtRequest,
        isCurrentRequest,
      );
      if (!isCurrentRequest() || selectedDeckRef.current !== deckAtRequest) return;
      setCards(loaded.cards);
      setCardsSource(loaded.source);
      setCardsCachedAt(loaded.cachedAt);
      if (loaded.deckId !== deckAtRequest) {
        selectedDeckRef.current = loaded.deckId;
        setSelectedDeckId(loaded.deckId);
      }
    } catch (e) {
      if (!isCurrentRequest()) return;
      setCards([]);
      setCardsSource(null);
      setCardsCachedAt(null);
      setErr(e instanceof Error ? e.message : 'Saved cards could not be loaded.');
    }
  }, [documentId, getToken, userId]);

  const selectDeck = useCallback(
    async (deckId: string | null) => {
      const request = ++deckLoadRef.current;
      const ownerAtRequest = userId ?? '';
      const isCurrentRequest = () =>
        request === deckLoadRef.current &&
        identityRef.current.ownerId === ownerAtRequest &&
        identityRef.current.documentId === documentId;
      selectedDeckRef.current = deckId;
      setSelectedDeckId(deckId);
      setMapPracticeIds(null);
      setCards([]);
      setCardsSource(null);
      setCardsCachedAt(null);
      try {
        const loaded = await loadFlashcardDeck(
          getToken,
          ownerAtRequest,
          documentId,
          deckId,
          isCurrentRequest,
        );
        if (!isCurrentRequest()) return;
        setCards(loaded.cards);
        setCardsSource(loaded.source);
        setCardsCachedAt(loaded.cachedAt);
        if (loaded.deckId !== deckId) {
          selectedDeckRef.current = loaded.deckId;
          setSelectedDeckId(loaded.deckId);
        }
        setErr(null);
        return true;
      } catch (e) {
        if (!isCurrentRequest()) return;
        setCards([]);
        setCardsSource(null);
        setCardsCachedAt(null);
        setErr(e instanceof Error ? e.message : 'failed to load selected deck');
        return false;
      }
    },
    [documentId, getToken, userId],
  );

  const refreshCards = useCallback(
    async (deckId: string) => {
      const request = ++deckLoadRef.current;
      const ownerAtRequest = userId ?? '';
      const isCurrentRequest = () =>
        request === deckLoadRef.current &&
        identityRef.current.ownerId === ownerAtRequest &&
        identityRef.current.documentId === documentId;
      selectedDeckRef.current = deckId;
      setSelectedDeckId(deckId);
      const loaded = await loadFlashcardDeck(getToken, ownerAtRequest, documentId, deckId, isCurrentRequest);
      if (!isCurrentRequest()) return;
      setCards(loaded.cards);
      setCardsSource(loaded.source);
      setCardsCachedAt(loaded.cachedAt);
    },
    [documentId, getToken, userId],
  );

  const updateSavedCard = useCallback(
    (cardId: string, updated: Flashcard | null) => {
      const next =
        updated === null || updated.status === 'retired'
          ? cards.filter((card) => card.id !== cardId)
          : cards.map((card) => (card.id === cardId ? updated : card));
      setCards(next);
      if (userId) {
        void cacheFlashcardDeck(userId, documentId, selectedDeckRef.current, next).catch((error: unknown) => {
          console.warn(
            'Offline deck cache update skipped:',
            error instanceof Error ? error.name : 'UnknownError',
          );
        });
      }
    },
    [cards, documentId, userId],
  );

  useEffect(() => {
    if (userId && pendingJobId) {
      stopPoll.current = pollUploadJobs(
        getToken,
        pendingJobId,
        setJob,
        () => void loadChapters(),
        (error) => setErr(error.message),
      );
    } else {
      void loadChapters();
    }
    return () => stopPoll.current?.();
  }, [getToken, loadChapters, pendingJobId, userId]);

  useEffect(() => {
    let active = true;
    if (!graphNodeId || !userId)
      return () => {
        active = false;
      };
    const handoff = readGraphHandoff(
      new URLSearchParams({
        graph_node: graphNodeId,
        graph_revision: graphRevision ?? '',
        graph_action: graphAction ?? '',
      }),
    );
    if (!handoff) {
      setMapHandoffStatus('This concept graph link is invalid.');
      return () => {
        active = false;
      };
    }
    setMapHandoffStatus('Resolving the saved concept and its source…');
    void getConceptGraphNodeActions(getToken, documentId, handoff.nodeId, handoff.revision)
      .then(async (resolved) => {
        if (!active) return;
        if (resolved.source) setMapSource(resolved.source);
        if (handoff.action === 'source') {
          setMapHandoffStatus(
            resolved.source
              ? 'Opened the selected concept’s current supporting source.'
              : 'This concept has no verified supporting source.',
          );
          return;
        }
        if (!resolved.deck) {
          setMapHandoffStatus('No approved deck currently matches this concept.');
          return;
        }
        const loaded = await selectDeck(resolved.deck.deck_id);
        if (!active) return;
        if (!loaded) {
          setMapHandoffStatus(
            'The approved deck could not be opened. Reconnect and retry this saved graph action.',
          );
          return;
        }
        if (handoff.action === 'practice') {
          setMapPracticeIds(resolved.deck.card_ids);
          setViewerOpen(true);
          setMapHandoffStatus(
            'Opened casual practice for cards grounded in this concept. Scheduled reviews are unchanged.',
          );
        } else {
          setMapHandoffStatus('Opened the approved deck linked to this concept.');
        }
      })
      .catch((caught: unknown) => {
        if (active)
          setMapHandoffStatus(caught instanceof Error ? caught.message : 'This graph action is unavailable.');
      });
    return () => {
      active = false;
    };
  }, [documentId, getToken, graphAction, graphNodeId, graphRevision, selectDeck, userId]);

  useEffect(() => {
    if (!mapSource?.chapter_id) return;
    const match = chapters.find((chapter) => chapter.id === mapSource.chapter_id);
    if (match) setSelectedChapter(match);
  }, [chapters, mapSource]);

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      stopPoll.current?.();
      const upload = await uploadPdf(getToken, file);
      router.replace(`/document/${upload.documentId}?job=${encodeURIComponent(upload.jobId)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload failed');
    } finally {
      setBusy(false);
    }
  };

  const onAsk = async () => {
    const q = question.trim();
    if (!q) return;
    setErr(null);
    setBusy(true);
    try {
      setChat(await askQuestion(getToken, documentId, q));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'chat failed');
    } finally {
      setBusy(false);
    }
  };

  const onGenerateCards = async () => {
    setErr(null);
    setBusy(true);
    try {
      stopPoll.current?.();
      const jobId = await generateFlashcards(getToken, documentId);
      stopPoll.current = pollJob(
        getToken,
        jobId,
        (j) => {
          setJob(j);
          if (j.status === 'done') void loadChapters();
        },
        1500,
        180_000,
        (error) => setErr(error.message),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'flashcard generation failed');
    } finally {
      setBusy(false);
    }
  };

  const status = job?.status;

  return (
    <main className="coast-document-page mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-bold">Document</h1>
      <p className="mt-1 break-all font-mono text-xs text-neutral-500">{documentId}</p>
      <nav className="document-jump-nav" aria-label="Document study tools">
        <a href="#document-chapters">Read</a>
        <a href="#document-chat">Ask AI</a>
        <a href="#document-cards">Flashcards</a>
        <a href="#document-listen">Listen</a>
        <a href="#document-map">Map &amp; viva</a>
      </nav>
      {mapHandoffStatus && (
        <p role="status" className="mt-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm">
          {mapHandoffStatus}
        </p>
      )}
      {mapSource && (
        <section
          className="mt-3 rounded border border-blue-200 p-3 text-sm"
          aria-label="Linked concept source"
        >
          <h2 className="font-semibold">
            Selected concept’s source{mapSource.page === null ? '' : ` · page ${mapSource.page}`}
          </h2>
          <blockquote className="mt-2 border-s-2 border-blue-400 ps-3">{mapSource.quote}</blockquote>
        </section>
      )}

      <section className="document-upload-panel mt-6 rounded border p-4">
        <label htmlFor="pdf-upload" className="mb-2 block text-sm font-medium">
          Upload a PDF
        </label>
        <input
          id="pdf-upload"
          type="file"
          accept="application/pdf"
          disabled={busy}
          onChange={(e) => onUpload(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
        {status && (
          <div className="mt-3 text-sm">
            <StatusBadge status={status} attempts={job?.attempts ?? 0} />
            {status === 'failed' && <p className="mt-1 text-red-600">{job?.error_reason}</p>}
          </div>
        )}
      </section>

      <section id="document-chapters" className="document-chapter-panel mt-6">
        <h2 className="text-lg font-semibold">Chapters</h2>
        {chapters.length === 0 && (
          <p className="mt-2 text-sm text-neutral-500">No chapters yet — upload a PDF.</p>
        )}
        <ul className="mt-2 space-y-1">
          {chapters.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setSelectedChapter(c)}
                aria-pressed={selectedChapter?.id === c.id}
                className={`flex w-full justify-between rounded border px-3 py-2 text-left text-sm hover:bg-neutral-50 ${
                  selectedChapter?.id === c.id ? 'border-blue-500 bg-blue-50' : ''
                }`}
              >
                <span>
                  <span className="mr-2 text-neutral-600">{c.ordinal}.</span>
                  {c.title}
                </span>
                <span className="text-neutral-500">
                  {c.start_page != null
                    ? `p.${c.start_page}${c.end_page && c.end_page !== c.start_page ? `–${c.end_page}` : ''}`
                    : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {selectedChapter && (
          <SummaryPanel key={[userId, documentId, selectedChapter.id].join(':')} chapter={selectedChapter} />
        )}
      </section>

      <section id="document-listen" className="document-listen-panel mt-6">
        <h2 className="text-lg font-semibold">Listen</h2>
        <TtsPlayer
          sourceKey={`${documentId}:${selectedChapter?.id ?? 'none'}:${chat?.answer ?? ''}`}
          label="Read this answer aloud"
          disabled={!chat?.answer}
          getText={() => chat?.answer ?? selectedChapter?.title ?? 'No chapter selected yet'}
        />
      </section>

      <section id="document-map" className="document-tools-panel mt-6 space-y-6">
        <MindMapPanel key={`${userId}:${documentId}`} documentId={documentId} />
        <VivaPanel documentId={documentId} />
      </section>

      <section
        id="document-cards"
        className="document-cards-panel mt-6"
        aria-labelledby="flashcard-studio-heading"
      >
        <div className="flex items-center justify-between">
          <h2 id="flashcard-studio-heading" className="text-lg font-semibold">
            Flashcard Studio
          </h2>
          <div className="flex gap-3 text-sm">
            <button
              onClick={onGenerateCards}
              disabled={busy || chapters.length === 0}
              className="text-blue-600 hover:underline disabled:opacity-40"
            >
              Generate
            </button>
            <a href="/review" className="text-neutral-700 hover:underline">
              Start review →
            </a>
          </div>
        </div>
        <FlashcardStudio
          key={`${userId}:${documentId}`}
          documentId={documentId}
          chapters={chapters}
          preferredChapterId={selectedChapter?.id}
          getToken={getToken}
          selectedDeckId={selectedDeckId}
          existingCards={cards}
          onDeckSelected={selectDeck}
          onSaved={refreshCards}
        />
        {cardsSource === 'offline' && (
          <p className="mt-2 text-xs text-amber-800" role="status">
            Offline copy · cached {cardsCachedAt ? new Date(cardsCachedAt).toLocaleString() : 'previously'}
          </p>
        )}
        {(cards.length > 0 || cardsSource === 'offline') && (
          <div className="mt-4">
            {!viewerOpen ? (
              <button
                type="button"
                onClick={() => setViewerOpen(true)}
                className="rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800"
              >
                Study {cards.length} cards
              </button>
            ) : (
              <FlashcardViewer
                key={`${userId}:${documentId}:${selectedDeckId ?? 'all'}`}
                cards={mapPracticeIds ? cards.filter((card) => mapPracticeIds.includes(card.id)) : cards}
                documentId={documentId}
                deckId={selectedDeckId}
                userId={userId ?? null}
                getToken={getToken}
              />
            )}
          </div>
        )}
        <h3 className="mt-3 text-sm font-semibold">Saved flashcards</h3>
        {cards.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No cards yet.</p>
        ) : (
          <ul className="mt-2 space-y-1" aria-label="Saved flashcards">
            {cards.map((card) => (
              <li key={card.id} className="rounded border px-3 py-2 text-sm">
                <p className="font-medium">{card.front}</p>
                <p className="mt-1 text-neutral-600">{card.back}</p>
                {card.tags && card.tags.length > 0 && (
                  <p className="mt-1 text-xs text-neutral-600">Tags: {card.tags.join(', ')}</p>
                )}
                {card.needs_review && (
                  <p className="mt-1 text-xs font-medium text-amber-700">
                    Review this schedule after changing card content.
                  </p>
                )}
                <p className="mt-1 text-xs text-neutral-600">due {card.due_date}</p>
                <FlashcardEditor
                  card={card}
                  getToken={getToken}
                  onChanged={(updated) => updateSavedCard(card.id, updated)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="document-chat" className="document-chat-panel mt-6">
        <h2 className="text-lg font-semibold">Ask about this document</h2>
        <div className="mt-2 flex gap-2">
          <label htmlFor="document-question" className="sr-only">
            Ask a question grounded in this PDF
          </label>
          <input
            id="document-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAsk()}
            placeholder="Ask a question grounded in the PDF…"
            className="flex-1 rounded border px-3 py-2 text-sm"
            disabled={busy}
          />
          <button
            onClick={onAsk}
            disabled={busy}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Ask
          </button>
        </div>
        {chat && (
          <div data-testid="chat-response" className="mt-4 rounded border bg-neutral-50 p-4 text-sm">
            <p className="whitespace-pre-wrap">{chat.answer}</p>
            {chat.citations.length > 0 && (
              <ul className="mt-3 space-y-1 border-t pt-3 text-xs text-neutral-600">
                {chat.citations.map((c, i) => (
                  <li key={i} data-testid="chat-citation">
                    <span className="font-mono text-neutral-600">[{i + 1}]</span>{' '}
                    {c.page != null ? `p.${c.page} — ` : ''}
                    {c.quote}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </section>

      <ExamPlanPanel documentId={documentId} />
    </main>
  );
}

function StatusBadge({ status, attempts }: { status: JobStatus['status']; attempts: number }) {
  const map: Record<JobStatus['status'], string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    done: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-slate-100 text-slate-800',
  };
  return (
    <span role="status" aria-live="polite" className={`rounded px-2 py-1 text-xs font-medium ${map[status]}`}>
      {status}
      {status === 'running' && attempts > 1 ? ` (attempt ${attempts})` : ''}
    </span>
  );
}
