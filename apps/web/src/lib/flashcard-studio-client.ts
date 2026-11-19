'use client';

import {
  StudioDeckListSchema,
  StudioDraftMergeRequestSchema,
  StudioDraftMergeResponseSchema,
  StudioDraftResponseSchema,
  StudioDraftStartSchema,
  StudioGenerationSettingsSchema,
  QuizGradeRequestSchema,
  QuizGradeResultSchema,
  QuizSessionSchema,
  QuizStartRequestSchema,
  ErrorEnvelopeSchema,
  type StudioDraftMergeRequest,
  type StudioGenerationSettings,
  type QuizGradeRequest,
  type QuizStartRequest,
} from '@studyvault/types';
import { authFetch, readResponse, type GetToken } from './ai-client';

const studioPath = (id: string) => `/api/documents/${encodeURIComponent(id)}/flashcard-studio`;
const draftPath = (documentId: string, draftId: string) => (
  `${studioPath(documentId)}/drafts/${encodeURIComponent(draftId)}`
);

function post(body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  };
}

export async function startStudioDraft(
  getToken: GetToken, documentId: string, settings: StudioGenerationSettings, signal?: AbortSignal,
) {
  const init = post(StudioGenerationSettingsSchema.parse(settings), signal);
  const response = await authFetch(getToken, `${studioPath(documentId)}/drafts`, init);
  return readResponse(response, StudioDraftStartSchema, 'start flashcard draft');
}

export async function getStudioDraft(
  getToken: GetToken, documentId: string, draftId: string, signal?: AbortSignal,
) {
  const response = await authFetch(getToken, draftPath(documentId, draftId), { signal });
  return readResponse(response, StudioDraftResponseSchema, 'load flashcard draft');
}

export async function mergeStudioDraft(
  getToken: GetToken, documentId: string, draftId: string, selection: StudioDraftMergeRequest,
  signal?: AbortSignal,
) {
  const init = post(StudioDraftMergeRequestSchema.parse(selection), signal);
  const response = await authFetch(getToken, `${draftPath(documentId, draftId)}/merge`, init);
  return readResponse(response, StudioDraftMergeResponseSchema, 'save flashcards');
}

export async function listStudioDecks(getToken: GetToken, documentId: string, signal?: AbortSignal) {
  const response = await authFetch(getToken, `${studioPath(documentId)}/decks`, { signal });
  return readResponse(response, StudioDeckListSchema, 'load flashcard decks');
}

export async function startFlashcardQuiz(
  getToken: GetToken, documentId: string, request: QuizStartRequest, signal?: AbortSignal,
) {
  const body = QuizStartRequestSchema.parse(request);
  const response = await authFetch(getToken, `/api/documents/${encodeURIComponent(documentId)}/flashcard-quizzes`, post(body, signal));
  return readResponse(response, QuizSessionSchema, 'start source quiz');
}

export async function getFlashcardQuiz(getToken: GetToken, sessionId: string, signal?: AbortSignal) {
  const response = await authFetch(getToken, `/api/flashcard-quizzes/${encodeURIComponent(sessionId)}`, { signal });
  return readResponse(response, QuizSessionSchema, 'load source quiz');
}

export async function gradeFlashcardQuiz(
  getToken: GetToken, sessionId: string, request: QuizGradeRequest, signal?: AbortSignal,
) {
  const body = QuizGradeRequestSchema.parse(request);
  const response = await authFetch(
    getToken,
    `/api/flashcard-quizzes/${encodeURIComponent(sessionId)}/grade`,
    post(body, signal),
  );
  return readResponse(response, QuizGradeResultSchema, 'grade source quiz');
}

export async function exportStudioDeckCsv(getToken: GetToken, documentId: string, deckId: string, signal?: AbortSignal) {
  const response = await authFetch(
    getToken,
    `/api/documents/${encodeURIComponent(documentId)}/flashcard-decks/${encodeURIComponent(deckId)}/export.csv`,
    { signal },
  );
  if (!response.ok) {
    let message = `export flashcards failed: ${response.status}`;
    try {
      const parsed = await response.json();
      const error = ErrorEnvelopeSchema.safeParse(parsed);
      if (error.success) message = error.data.error.message;
    } catch {
      // A malformed failure body falls back to the status-based message.
    }
    throw new Error(message);
  }
  return response.blob();
}
