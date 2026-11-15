'use client';

import { useAuth } from '@clerk/nextjs';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SummaryPanel } from '@/components/summary-panel';
import { ExamPlanPanel } from '@/components/exam-plan-panel';
import { MindMapPanel } from '@/components/mindmap-panel';
import { TtsPlayer } from '@/components/tts-player';
import { VivaPanel } from '@/components/viva-panel';
import {
  askQuestion,
  generateFlashcards,
  getChapters,
  listFlashcards,
  pollJob,
  uploadPdf,
} from '@/lib/ai-client';
import type { Chapter, ChatReply, Flashcard, JobStatus } from '@/lib/ai-types';

/**
 * Document page (tasks 2.3, 2.5, 2.6, 2.10): upload a PDF, poll its job,
 * list chapters, ask questions with citations.
 */
export default function DocumentPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const documentId = params?.id ?? '';
  const pendingJobId = searchParams.get('job');
  const [job, setJob] = useState<JobStatus | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<ChatReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stopPoll = useRef<(() => void) | null>(null);

  useEffect(() => {
    setJob(null);
    setChapters([]);
    setCards([]);
    setSelectedChapter(null);
    setChat(null);
  }, [documentId]);

  const loadChapters = useCallback(async () => {
    if (!documentId) return;
    try {
      const list = await getChapters(getToken, documentId);
      setChapters(list);
      setSelectedChapter((prev) => prev ?? list[0] ?? null);
      setCards(await listFlashcards(getToken, documentId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load chapters');
    }
  }, [documentId, getToken]);

  useEffect(() => {
    void loadChapters();
    if (pendingJobId) {
      stopPoll.current = pollJob(getToken, pendingJobId, (j) => {
        setJob(j);
        if (j.status === 'done') void loadChapters();
      }, 1500, 180_000, (error) => setErr(error.message));
    }
    return () => stopPoll.current?.();
  }, [getToken, loadChapters, pendingJobId]);

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
      stopPoll.current = pollJob(getToken, jobId, (j) => {
        setJob(j);
        if (j.status === 'done') void loadChapters();
      }, 1500, 180_000, (error) => setErr(error.message));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'flashcard generation failed');
    } finally {
      setBusy(false);
    }
  };

  const status = job?.status;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">Document</h1>
      <p className="mt-1 break-all font-mono text-xs text-neutral-500">{documentId}</p>

      <section className="mt-6 rounded border p-4">
        <label htmlFor="pdf-upload" className="mb-2 block text-sm font-medium">Upload a PDF</label>
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

      <section className="mt-6">
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
        {selectedChapter && <SummaryPanel chapter={selectedChapter} />}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Listen</h2>
        <TtsPlayer
          documentId={documentId}
          getText={() => chat?.answer ?? selectedChapter?.title ?? 'No chapter selected yet'}
        />
      </section>

      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <MindMapPanel documentId={documentId} />
        <VivaPanel documentId={documentId} />
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Flashcards</h2>
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
        {cards.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No cards yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {cards.map((card) => (
              <li key={card.id} className="rounded border px-3 py-2 text-sm">
                <p className="font-medium">{card.front}</p>
                <p className="mt-1 text-neutral-600">{card.back}</p>
                <p className="mt-1 text-xs text-neutral-600">due {card.due_date}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Ask about this document</h2>
        <div className="mt-2 flex gap-2">
          <label htmlFor="document-question" className="sr-only">Ask a question grounded in this PDF</label>
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
  };
  return (
    <span role="status" aria-live="polite" className={`rounded px-2 py-1 text-xs font-medium ${map[status]}`}>
      {status}
      {status === 'running' && attempts > 1 ? ` (attempt ${attempts})` : ''}
    </span>
  );
}
