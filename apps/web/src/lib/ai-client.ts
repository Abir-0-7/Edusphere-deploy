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
  JobResponseSchema,
  JobCancelResponseSchema,
  ParsePdfResponseSchema,
  ReviewRequestSchema,
  ReviewResultSchema,
  type ReviewResult,
} from '@studyvault/types';
import { z } from 'zod';
import { isAllowedLearningRoute } from './learning-service-proxy';

/**
 * Browser-side ai-service client. The caller passes a `getToken` (from Clerk's
 * useAuth hook) so every call carries a real session token for verification.
 */
export type GetToken = () => Promise<string | null>;

/** HTTP errors retain status so the deck viewer can safely decide on offline fallback. */
export class AiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AiHttpError';
  }
}

const aiServiceOrigin = () =>
  (process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export async function authFetch(getToken: GetToken, path: string, init: RequestInit = {}) {
  const method = (init.method ?? 'GET').toUpperCase();
  const useBridge = isAllowedLearningRoute(method, path.split('?', 1)[0] ?? '');
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${(await getToken()) ?? ''}`);
  if (method !== 'GET' && !headers.has('Idempotency-Key'))
    headers.set('Idempotency-Key', crypto.randomUUID());
  try {
    return await fetch(`${useBridge ? '/api/learning-service' : aiServiceOrigin()}${path}`, {
      ...init,
      cache: 'no-store',
      // Use the caller's scoped token even if the browser is switching accounts.
      credentials: useBridge ? 'same-origin' : 'omit',
      headers,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new TypeError('The study service could not be reached. Try again in a moment.', { cause: error });
  }
}

export async function wakeUploadService(signal: AbortSignal) {
  // Opening the library can begin the free host's startup while the user picks a file.
  await fetch(`${aiServiceOrigin()}/health`, {
    mode: 'no-cors',
    cache: 'no-store',
    signal,
  });
}

/** Same-origin bridge for guided courses and learner-profile APIs. */
export async function learningFetch(getToken: GetToken, path: string, init: RequestInit = {}) {
  return authFetch(getToken, path, init);
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
  signal?: AbortSignal,
): Promise<{ jobId: string; documentId: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await authFetch(getToken, '/api/parse-pdf', { method: 'POST', body: fd, signal });
  if (res.status === 413) throw new AiHttpError(413, 'This PDF exceeds the upload size limit.');
  if ([502, 503, 504].includes(res.status)) {
    throw new AiHttpError(res.status, 'The upload service is temporarily unavailable. Try again shortly.');
  }
  const data = await readResponse(res, ParsePdfResponseSchema, 'upload');
  return { jobId: data.job_id, documentId: data.document_id };
}

export async function getJob(getToken: GetToken, jobId: string, signal?: AbortSignal): Promise<JobStatus> {
  const res = await authFetch(getToken, `/api/jobs/${encodeURIComponent(jobId)}`, { signal });
  return readResponse(res, JobResponseSchema, 'job status');
}

export async function cancelJob(getToken: GetToken, jobId: string): Promise<void> {
  const res = await authFetch(getToken, `/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
  await readResponse(res, JobCancelResponseSchema, 'cancel job');
}

export async function getChapters(getToken: GetToken, documentId: string): Promise<Chapter[]> {
  const res = await authFetch(getToken, `/api/documents/${documentId}/chapters`);
  return readResponse(res, ChapterListResponseSchema, 'chapters');
}

export async function getSavedConceptGraph(getToken: GetToken, documentId: string, signal?: AbortSignal) {
  const res = await authFetch(getToken, `/api/documents/${encodeURIComponent(documentId)}/concept-graph`, {
    signal,
  });
  return readResponse(res, ConceptGraphRecordSchema, 'saved concept graph');
}

export async function getGeneratedMindMap(getToken: GetToken, documentId: string, signal?: AbortSignal) {
  const res = await authFetch(getToken, `/api/documents/${encodeURIComponent(documentId)}/mindmap`, {
    signal,
  });
  return readResponse(res, MindMapResponseSchema, 'mind map');
}

export async function saveConceptGraph(
  getToken: GetToken,
  documentId: string,
  graph: unknown,
  expectedRevision?: number,
  signal?: AbortSignal,
) {
  const body = ConceptGraphSaveRequestSchema.parse({
    graph,
    ...(expectedRevision === undefined ? {} : { expected_revision: expectedRevision }),
  });
  const res = await authFetch(getToken, `/api/documents/${encodeURIComponent(documentId)}/concept-graph`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return readResponse(res, ConceptGraphRecordSchema, 'save concept graph');
}

export async function getConceptGraphNodeActions(
  getToken: GetToken,
  documentId: string,
  nodeId: string,
  revision: number,
  signal?: AbortSignal,
) {
  const res = await authFetch(
    getToken,
    `/api/documents/${encodeURIComponent(documentId)}/concept-graph/nodes/${encodeURIComponent(nodeId)}/actions?revision=${revision}`,
    { signal },
  );
  const actions = await readResponse(res, ConceptGraphNodeActionsSchema, 'concept graph learning actions');
  if (
    actions.node_id !== nodeId ||
    actions.graph_revision !== revision ||
    (actions.source && actions.source.document_id !== documentId) ||
    (actions.deck && actions.deck.document_id !== documentId) ||
    (actions.board && (actions.board.document_id !== documentId || actions.board.node_id !== nodeId))
  )
    throw new Error('Concept graph action does not match this source and revision.');
  return actions;
}

export async function regenerateConceptGraph(
  getToken: GetToken,
  documentId: string,
  expectedRevision: number,
  signal?: AbortSignal,
) {
  const body = ConceptGraphRegenerateRequestSchema.parse({ expected_revision: expectedRevision });
  const res = await authFetch(
    getToken,
    `/api/documents/${encodeURIComponent(documentId)}/concept-graph/regenerate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
  );
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

export async function listFlashcards(
  getToken: GetToken,
  documentId: string,
  deckId?: string,
): Promise<Flashcard[]> {
  const params = deckId ? `?deck_id=${encodeURIComponent(deckId)}` : '';
  const res = await authFetch(
    getToken,
    `/api/documents/${encodeURIComponent(documentId)}/flashcards${params}`,
  );
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
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse(res, FlashcardResponseSchema, 'edit flashcard');
}

export async function retireFlashcard(getToken: GetToken, cardId: string): Promise<Flashcard> {
  const res = await authFetch(getToken, `/api/flashcards/${encodeURIComponent(cardId)}/retire`, {
    method: 'POST',
  });
  return readResponse(res, FlashcardResponseSchema, 'retire flashcard');
}

export async function deleteFlashcard(getToken: GetToken, cardId: string): Promise<void> {
  const res = await authFetch(getToken, `/api/flashcards/${encodeURIComponent(cardId)}`, {
    method: 'DELETE',
  });
  await readResponse(res, FlashcardDeleteResponseSchema, 'delete flashcard');
}

export async function reportFlashcard(getToken: GetToken, cardId: string, reason: string): Promise<void> {
  const body = FlashcardReportRequestSchema.parse({ reason });
  const res = await authFetch(getToken, `/api/flashcards/${encodeURIComponent(cardId)}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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
  const body = ReviewRequestSchema.parse({
    grade,
    ...(reviewId === undefined ? {} : { review_id: reviewId }),
  });
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
  let lastError: Error | null = null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    controller.abort();
    clearTimeout(timer);
  };
  const deadline = setTimeout(() => {
    if (stopped) return;
    stop();
    onError?.(lastError ?? new Error('job polling timed out'));
  }, timeoutMs);
  const tick = async () => {
    while (!stopped) {
      try {
        const job = await getJob(getToken, jobId, controller.signal);
        if (stopped) return;
        onUpdate(job);
        if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
          stop();
          clearTimeout(deadline);
          return;
        }
        lastError = null;
      } catch (error) {
        if (stopped) return;
        lastError = error instanceof Error ? error : new Error('job status request failed');
        if (error instanceof AiHttpError && [400, 401, 403, 404].includes(error.status)) {
          stop();
          clearTimeout(deadline);
          onError?.(lastError);
          return;
        }
      }
      if (!stopped)
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, intervalMs);
        });
    }
  };
  void tick();
  return () => {
    stop();
    clearTimeout(deadline);
  };
}
