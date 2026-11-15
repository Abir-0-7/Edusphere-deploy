'use client';

import type { ChatReply, Chapter, Flashcard, JobStatus } from './ai-types';
import type { ParsePdfResponse } from '@studyvault/types';

/**
 * Browser-side ai-service client. The caller passes a `getToken` (from Clerk's
 * useAuth hook) so every call carries a real session token for verification.
 */
type GetToken = () => Promise<string | null>;

async function authFetch(getToken: GetToken, path: string, init: RequestInit = {}) {
  const token = await getToken();
  const base = process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';
  return fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token ?? ''}` },
  });
}

export type { ChatReply, Chapter, Flashcard, JobStatus };

export async function uploadPdf(getToken: GetToken, file: File): Promise<{ jobId: string; documentId: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await authFetch(getToken, '/api/parse-pdf', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const data = (await res.json()) as ParsePdfResponse;
  return { jobId: data.job_id, documentId: data.document_id };
}

export async function getJob(getToken: GetToken, jobId: string): Promise<JobStatus> {
  const res = await authFetch(getToken, `/api/jobs/${jobId}`);
  if (!res.ok) throw new Error(`job status failed: ${res.status}`);
  return res.json();
}

export async function getChapters(getToken: GetToken, documentId: string): Promise<Chapter[]> {
  const res = await authFetch(getToken, `/api/documents/${documentId}/chapters`);
  if (!res.ok) throw new Error(`chapters failed: ${res.status}`);
  return res.json();
}

export async function askQuestion(
  getToken: GetToken,
  documentId: string,
  question: string,
): Promise<ChatReply> {
  const res = await authFetch(getToken, `/api/documents/${documentId}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error(`chat failed: ${res.status}`);
  return res.json();
}

export async function generateFlashcards(getToken: GetToken, documentId: string): Promise<string> {
  const res = await authFetch(getToken, `/api/documents/${documentId}/flashcards`, { method: 'POST' });
  if (!res.ok) throw new Error(`flashcard generation failed: ${res.status}`);
  return ((await res.json()) as { job_id: string }).job_id;
}

export async function listFlashcards(getToken: GetToken, documentId: string): Promise<Flashcard[]> {
  const res = await authFetch(getToken, `/api/documents/${documentId}/flashcards`);
  if (!res.ok) throw new Error(`flashcards failed: ${res.status}`);
  return res.json();
}

export async function getReviewQueue(getToken: GetToken): Promise<Flashcard[]> {
  const res = await authFetch(getToken, '/api/flashcards/review-queue');
  if (!res.ok) throw new Error(`review queue failed: ${res.status}`);
  return res.json();
}

export async function submitReview(getToken: GetToken, cardId: string, grade: number): Promise<Flashcard> {
  const res = await authFetch(getToken, `/api/flashcards/${cardId}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grade }),
  });
  if (!res.ok) throw new Error(`review failed: ${res.status}`);
  return res.json();
}

/** Poll a job until it reaches a terminal state or times out (task 2.3). */
export function pollJob(
  getToken: GetToken,
  jobId: string,
  onUpdate: (job: JobStatus) => void,
  intervalMs = 1500,
  timeoutMs = 180_000,
  onError?: (error: Error) => void,
): () => void {
  let stopped = false;
  const started = Date.now();
  const tick = async () => {
    let lastError: Error | null = null;
    while (!stopped && Date.now() - started < timeoutMs) {
      try {
        const job = await getJob(getToken, jobId);
        onUpdate(job);
        if (job.status === 'done' || job.status === 'failed') return;
        lastError = null;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('job status request failed');
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    if (!stopped) {
      onError?.(lastError ?? new Error('job polling timed out'));
    }
  };
  void tick();
  return () => {
    stopped = true;
  };
}
