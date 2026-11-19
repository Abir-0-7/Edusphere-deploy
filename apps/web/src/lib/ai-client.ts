'use client';

import type { ChatReply, Chapter, Flashcard, JobStatus } from './ai-types';
import {
  ChapterListResponseSchema,
  ChatReplySchema,
  ChatRequestSchema,
  ErrorEnvelopeSchema,
  FlashcardGenerationResponseSchema,
  FlashcardExplanationResponseSchema,
  FlashcardResponseSchema,
  FlashcardEditRequestSchema,
  FlashcardDeleteResponseSchema,
  FlashcardReportRequestSchema,
  FlashcardReportResponseSchema,
  FlashcardListResponseSchema,
  ConceptGraphRecordSchema,
  ConceptGraphNodeActionsSchema,
  ConceptGraphRegenerateRequestSchema,
  ConceptGraphSaveRequestSchema,
  MindMapResponseSchema,
  ReviewRequestSchema,
  ReviewResultSchema,
  type ParsePdfResponse,
  type ReviewResult,
} from '@studyvault/types';
import { z } from 'zod';

/**
 * Browser-side ai-service client. The caller passes a `getToken` (from Clerk's
 * useAuth hook) so every call carries a real session token for verification.
 */
export type GetToken = () => Promise<string | null>;

/** HTTP errors retain status so the deck viewer can safely decide on offline fallback. */
export class AiHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'AiHttpError';
  }
}

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
    throw new TypeError(
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
  if (!response.ok) {
    const failure = ErrorEnvelopeSchema.safeParse(payload);
    throw new AiHttpError(
      response.status,
      failure.success ? failure.data.error.message : `${label} failed: ${response.status}`,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error(`${label} failed: invalid service response`);
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
  return readResponse(res, ChapterListResponseSchema, 'chapters');
}

export async function getSavedConceptGraph(getToken: GetToken, documentId: string) {
  const res = await authFetch(getToken, `/api/documents/${encodeURIComponent(documentId)}/concept-graph`);
  return readResponse(res, ConceptGraphRecordSchema, 'saved concept graph');
}

export async function getGeneratedMindMap(getToken: GetToken, documentId: string) {
  const res = await authFetch(getToken, `/api/documents/${encodeURIComponent(documentId)}/mindmap`);
  return readResponse(res, MindMapResponseSchema, 'mind map');
}

export async function saveConceptGraph(
  getToken: GetToken,
  documentId: string,
  graph: unknown,
  expectedRevision?: number,
) {
  const body = ConceptGraphSaveRequestSchema.parse({
    graph,
    ...(expectedRevision === undefined ? {} : { expected_revision: expectedRevision }),
  });
  const res = await authFetch(getToken, `/api/documents/${encodeURIComponent(documentId)}/concept-graph`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse(res, ConceptGraphRecordSchema, 'save concept graph');
}

export async function getConceptGraphNodeActions(
  getToken: GetToken,
  documentId: string,
  nodeId: string,
  revision: number,
) {
  const res = await authFetch(
    getToken,
    `/api/documents/${encodeURIComponent(documentId)}/concept-graph/nodes/${encodeURIComponent(nodeId)}/actions?revision=${revision}`,
  );
  const actions = await readResponse(res, ConceptGraphNodeActionsSchema, 'concept graph learning actions');
  if (
    actions.node_id !== nodeId || actions.graph_revision !== revision
    || (actions.source && actions.source.document_id !== documentId)
    || (actions.deck && actions.deck.document_id !== documentId)
    || (actions.board && (actions.board.document_id !== documentId || actions.board.node_id !== nodeId))
  ) throw new Error('Concept graph action does not match this source and revision.');
  return actions;
}

export async function regenerateConceptGraph(
  getToken: GetToken,
  documentId: string,
  expectedRevision: number,
) {
  const body = ConceptGraphRegenerateRequestSchema.parse({ expected_revision: expectedRevision });
  const res = await authFetch(getToken, `/api/documents/${encodeURIComponent(documentId)}/concept-graph/regenerate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse(res, ConceptGraphRecordSchema, 'regenerate concept graph');
}

export async function askQuestion(
  getToken: GetToken,
  documentId: string,
  question: string,
): Promise<ChatReply> {
  const res = await authFetch(getToken, `/api/documents/${documentId}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ChatRequestSchema.parse({ question })),
  });
  return readResponse(res, ChatReplySchema, 'chat');
}

export async function generateFlashcards(getToken: GetToken, documentId: string): Promise<string> {
  const res = await authFetch(getToken, `/api/documents/${documentId}/flashcards`, { method: 'POST' });
  return (await readResponse(res, FlashcardGenerationResponseSchema, 'flashcard generation')).job_id;
}

export async function listFlashcards(getToken: GetToken, documentId: string, deckId?: string): Promise<Flashcard[]> {
  const params = deckId ? `?deck_id=${encodeURIComponent(deckId)}` : '';
  const res = await authFetch(getToken, `/api/documents/${encodeURIComponent(documentId)}/flashcards${params}`);
  return readResponse(res, FlashcardListResponseSchema, 'flashcards');
}

export async function explainFlashcard(getToken: GetToken, cardId: string) {
  const res = await authFetch(getToken, `/api/flashcards/${encodeURIComponent(cardId)}/explain`);
  return readResponse(res, FlashcardExplanationResponseSchema, 'card explanation');
}

export async function editFlashcard(
  getToken: GetToken,
  cardId: string,
  input: { front?: string; back?: string; tags?: string[] },
): Promise<Flashcard> {
  const body = FlashcardEditRequestSchema.parse(input);
  const res = await authFetch(getToken, `/api/flashcards/${encodeURIComponent(cardId)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return readResponse(res, FlashcardResponseSchema, 'edit flashcard');
}

export async function retireFlashcard(getToken: GetToken, cardId: string): Promise<Flashcard> {
  const res = await authFetch(getToken, `/api/flashcards/${encodeURIComponent(cardId)}/retire`, { method: 'POST' });
  return readResponse(res, FlashcardResponseSchema, 'retire flashcard');
}

export async function deleteFlashcard(getToken: GetToken, cardId: string): Promise<void> {
  const res = await authFetch(getToken, `/api/flashcards/${encodeURIComponent(cardId)}`, { method: 'DELETE' });
  await readResponse(res, FlashcardDeleteResponseSchema, 'delete flashcard');
}

export async function reportFlashcard(getToken: GetToken, cardId: string, reason: string): Promise<void> {
  const body = FlashcardReportRequestSchema.parse({ reason });
  const res = await authFetch(getToken, `/api/flashcards/${encodeURIComponent(cardId)}/report`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  await readResponse(res, FlashcardReportResponseSchema, 'report flashcard');
}

export async function getReviewQueue(getToken: GetToken): Promise<Flashcard[]> {
  const res = await authFetch(getToken, '/api/flashcards/review-queue');
  return readResponse(res, FlashcardListResponseSchema, 'review queue');
}

export async function submitReview(
  getToken: GetToken,
  cardId: string,
  grade: number,
  reviewId?: string,
): Promise<ReviewResult> {
  const body = ReviewRequestSchema.parse({ grade, ...(reviewId === undefined ? {} : { review_id: reviewId }) });
  const res = await authFetch(getToken, `/api/flashcards/${cardId}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse(res, ReviewResultSchema, 'review');
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
