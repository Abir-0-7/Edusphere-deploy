import {
  VivaGradeRequestSchema,
  VivaGradeResponseSchema,
  VivaQuestionsResponseSchema,
} from '@studyvault/types';
import { AiHttpError, authFetch, readResponse, type GetToken } from './ai-client';

async function vivaRequest<T>(
  getToken: GetToken,
  path: string,
  init: RequestInit,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  label: string,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  let timedOut = false;
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => reject(new DOMException('Request cancelled', 'AbortError')),
      { once: true },
    );
  });
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 90_000);
  try {
    const run = async () => {
      const token = await getToken();
      if (!token) throw new AiHttpError(401, 'Sign in again to use viva practice.');
      if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
      const response = await authFetch(async () => token, path, { ...init, signal: controller.signal });
      return readResponse(response, schema, label);
    };
    return await Promise.race([run(), aborted]);
  } catch (error) {
    if (timedOut) throw new Error('Viva practice took too long to respond. Try again shortly.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function getVivaQuestions(getToken: GetToken, documentId: string, signal?: AbortSignal) {
  const questions = await vivaRequest(
    getToken,
    `/api/documents/${encodeURIComponent(documentId)}/viva-questions`,
    { method: 'POST' },
    VivaQuestionsResponseSchema,
    'Viva questions',
    signal,
  );
  if (!questions.length) throw new Error('No viva questions were returned. Try again.');
  return questions;
}

export async function gradeVivaAnswer(
  getToken: GetToken,
  input: { question: string; answer: string; expected_points: string[] },
  signal?: AbortSignal,
) {
  const body = VivaGradeRequestSchema.parse(input);
  return vivaRequest(
    getToken,
    '/api/viva-grade',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    VivaGradeResponseSchema,
    'Viva grading',
    signal,
  );
}
