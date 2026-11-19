'use client';

import type { ChatReply, Chapter, Flashcard, JobStatus } from './ai-types';
import { ErrorEnvelopeSchema, type ParsePdfResponse } from '@studyvault/types';
import { z } from 'zod';

/**
 * Browser-side ai-service client. The caller passes a `getToken` (from Clerk's
 * useAuth hook) so every call carries a real session token for verification.
 */
export type GetToken = () => Promise<string | null>;

export async function authFetch(getToken: GetToken, path: string, init: RequestInit = {}) {
  const token = await getToken();
  const base = process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token ?? ''}` },
    });
  } catch {
    const origin = typeof window === 'undefined' ? 'this deployment' : window.location.origin;
    throw new Error(
      `Cannot reach the AI service from ${origin}. Check the Render service URL and CORS origin settings.`,
    );
  }
}

/** Same-origin bridge for guided courses and learner-profile APIs. */
export async function learningFetch(getToken: GetToken, path: string, init: RequestInit = {}) {
  const token = await getToken();
  try {
    return await fetch(`/api/learning-service${path}`, {
      ...init,
      cache: 'no-store',
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token ?? ''}` },
    });
  } catch {
    throw new Error('Cannot reach the learning service. Check your connection and try again.');
  }
}

export async function readResponse<T>(
  response: Response,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  label: string,
): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label} failed: ${response.status}`);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error(`${label} returned an invalid response.`);
  return parsed.data;
}

export type { ChatReply, Chapter, Flashcard, JobStatus };

const tokenBalanceSchema = z.object({ balance: z.number().int().nonnegative() });

export async function getTokenBalance(getToken: GetToken) {
  const token = await getToken();
  if (!token) throw new Error('Sign in to see your study tokens.');

  const response = await authFetch(async () => token, '/api/tokens/balance', { cache: 'no-store' });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Token balance failed: ' + (response.ok ? 'invalid service response' : response.status));
  }
  if (!response.ok) {
    const failure = ErrorEnvelopeSchema.safeParse(body);
    throw new Error(
      failure.success ? failure.data.error.message : 'Token balance failed: ' + response.status,
    );
  }
  const result = tokenBalanceSchema.safeParse(body);
  if (!result.success) throw new Error('Token balance failed: invalid service response');
  return result.data;
}

export async function uploadPdf(
  getToken: GetToken,
  file: File,
): Promise<{ jobId: string; documentId: string }> {
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
