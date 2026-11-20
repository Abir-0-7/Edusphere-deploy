import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamCourseTutor, TutorOperationUncertainError } from '../src/lib/course-client';

const request = {
  id: 'a0378313-f11c-4a53-9bc6-71f2164873e7',
  revision: 4,
  question: 'Why does multiplication happen first?',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('course tutor streaming client', () => {
  it('accepts a short refusal when token and saved text match', async () => {
    const answer = "I don't know based on this lesson.";
    const saved = { ...request, answer, evidence_ids: [], revision: 5, replayed: false };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            `event: token\ndata: ${JSON.stringify({ text: answer })}\n\nevent: done\ndata: ${JSON.stringify(saved)}\n\n`,
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    );
    const chunks: string[] = [];
    await expect(
      streamCourseTutor(
        async () => 'test-token',
        'b0378313-f11c-4a53-9bc6-71f2164873e7',
        request,
        new AbortController().signal,
        (chunk) => chunks.push(chunk),
      ),
    ).resolves.toEqual(saved);
    expect(chunks.join('')).toBe(answer);
  });

  it.each(['http', 'sse'])('preserves an uncertain operation reason from %s errors', async (kind) => {
    const payload = {
      error: {
        code: 'internal',
        message: 'Previous provider outcome is uncertain.',
        details: { reason: 'operation_uncertain' },
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        kind === 'http'
          ? new Response(JSON.stringify(payload), {
              status: 429,
              headers: { 'content-type': 'application/json' },
            })
          : new Response(`event: error\ndata: ${JSON.stringify(payload)}\n\n`, {
              headers: { 'content-type': 'text/event-stream' },
            }),
      ),
    );
    await expect(
      streamCourseTutor(
        async () => 'test-token',
        'b0378313-f11c-4a53-9bc6-71f2164873e7',
        request,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toBeInstanceOf(TutorOperationUncertainError);
  });

  it('keeps quota errors distinct from uncertain operations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'rate_limited', message: 'Quota exhausted', details: { reason: 'daily_quota' } },
            }),
            { status: 429, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const failure = streamCourseTutor(
      async () => 'test-token',
      'b0378313-f11c-4a53-9bc6-71f2164873e7',
      request,
      new AbortController().signal,
      () => {},
    );
    await expect(failure).rejects.not.toBeInstanceOf(TutorOperationUncertainError);
    await expect(failure).rejects.toThrow('Quota exhausted');
  });

  it('discards an incomplete answer when the learner cancels', async () => {
    const abort = new AbortController();
    const chunks: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event: token\ndata: {"text":"partial answer"}\n\n'));
          init?.signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = streamCourseTutor(
      async () => 'test-token',
      'b0378313-f11c-4a53-9bc6-71f2164873e7',
      request,
      abort.signal,
      (chunk) => {
        chunks.push(chunk);
        abort.abort();
      },
    );

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(chunks.join('')).toBe('partial answer');
  });
});
