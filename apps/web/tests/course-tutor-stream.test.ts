import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamCourseTutor } from '../src/lib/course-client';

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
