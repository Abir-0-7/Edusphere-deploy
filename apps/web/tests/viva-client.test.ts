import { afterEach, expect, it, vi } from 'vitest';
import { getVivaQuestions, gradeVivaAnswer } from '../src/lib/viva-client';
import { isAllowedLearningRoute } from '../src/lib/learning-service-proxy';

const documentId = '11111111-1111-4111-8111-111111111111';
const questions = [{ question: 'What is albedo?', expected_points: ['Reflectivity'] }];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('routes both viva actions through the authenticated deployment proxy', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(questions))
    .mockResolvedValueOnce(Response.json({ score: 4, feedback: 'Clear.', covered: [], missed: [] }));
  vi.stubGlobal('fetch', fetchMock);
  expect(isAllowedLearningRoute('POST', `/api/documents/${documentId}/viva-questions`)).toBe(true);
  expect(isAllowedLearningRoute('POST', '/api/viva-grade')).toBe(true);
  expect(await getVivaQuestions(async () => 'scoped-token', documentId)).toEqual(questions);
  await gradeVivaAnswer(async () => 'scoped-token', {
    question: 'What is albedo?',
    expected_points: ['Reflectivity'],
    answer: 'Surface reflectivity',
  });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    `/api/learning-service/api/documents/${documentId}/viva-questions`,
    '/api/learning-service/api/viva-grade',
  ]);
  expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer scoped-token');
});

it('preserves service error messages and rejects malformed grades', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: 'internal', message: 'Viva provider is unavailable.' } },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ error: 'not a grade' })),
  );
  await expect(getVivaQuestions(async () => 'token', documentId)).rejects.toThrow(
    'Viva provider is unavailable.',
  );
  await expect(
    gradeVivaAnswer(async () => 'token', { question: 'Why?', answer: 'Because', expected_points: [] }),
  ).rejects.toThrow('invalid service response');
});

it('never sends a request with an absent session token', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(getVivaQuestions(async () => null, documentId)).rejects.toThrow('Sign in again');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('bounds a stalled service request and permits a retry', async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    )
    .mockResolvedValueOnce(Response.json(questions));
  vi.stubGlobal('fetch', fetchMock);
  const pending = getVivaQuestions(async () => 'token', documentId);
  const rejected = expect(pending).rejects.toThrow('took too long');
  await vi.advanceTimersByTimeAsync(90_001);
  await rejected;
  expect(await getVivaQuestions(async () => 'token', documentId)).toEqual(questions);
});

it.each(['token', 'body'])('bounds a stalled %s without accepting a late result', async (stage) => {
  vi.useFakeTimers();
  const getToken = stage === 'token' ? () => new Promise<string>(() => {}) : async () => 'token';
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    } as Response),
  );
  const rejected = expect(getVivaQuestions(getToken, documentId)).rejects.toThrow('took too long');
  await vi.advanceTimersByTimeAsync(90_001);
  await rejected;
});
