import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestSummary, SummaryPanel } from '../src/components/summary-panel';
import { consumeSpeechStream, speechChunks } from '../src/components/tts-player';

const chapterId = '11111111-1111-4111-8111-111111111111';

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: vi.fn(async () => 'test-token') }),
}));

describe('SummaryPanel', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('renders the accessible three-level slider at Standard by default', () => {
    vi.stubGlobal('React', React);
    const markup = renderToStaticMarkup(
      React.createElement(SummaryPanel, {
        chapter: { id: chapterId, title: 'Photosynthesis', ordinal: 1, start_page: 1, end_page: 2 },
      }),
    );

    expect(markup).toContain('aria-label="Summary complexity"');
    expect(markup).toContain('min="0" max="2" step="1"');
    expect(markup).toContain('value="1"');
    expect(markup).toContain('Standard');
    expect(markup).toMatch(/<button[^>]+disabled[^>]*>Listen to summary<\/button>/);
  });
});

describe('requestSummary', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('loads an existing summary without starting another generation', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ content: 'Saved summary' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestSummary(
      chapterId,
      'eli5',
      'test-token',
      new AbortController().signal,
      vi.fn(),
    );

    expect(result).toBe('Saved summary');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0]?.input).toContain('level=eli5');
  });

  it('streams a newly selected level progressively after a cache miss', async () => {
    const encoder = new TextEncoder();
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (calls.length === 1) return new Response('not found', { status: 404 });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"token":"A simpler "'));
            controller.enqueue(
              encoder.encode('}\n\ndata: {"token":"explanation"}\n\ndata: {"done":true}\n\n'),
            );
            controller.close();
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const tokens: string[] = [];

    const result = await requestSummary(
      chapterId,
      'eli5',
      'test-token',
      new AbortController().signal,
      (token) => tokens.push(token),
    );

    expect(result).toBe('A simpler explanation');
    expect(tokens).toEqual(['A simpler ', 'explanation']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls[1]?.init).toMatchObject({ method: 'POST', body: JSON.stringify({ level: 'eli5' }) });
  });

  it('does not start generation after the saved-summary request is aborted', async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const request = requestSummary(chapterId, 'deep_dive', 'test-token', controller.signal, vi.fn());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not generate after an unavailable saved-summary request', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      requestSummary(chapterId, 'standard', null, new AbortController().signal, vi.fn()),
    ).rejects.toThrow('Could not load the saved summary');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not accept an interrupted summary for narration', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response('data: {"token":"an incomplete summary"}\n\n')),
    );
    await expect(
      requestSummary(chapterId, 'standard', null, new AbortController().signal, vi.fn()),
    ).rejects.toThrow('ended before completion');
  });
});

describe('speech playback', () => {
  it('keeps the entire summary in short, ordered device utterances', () => {
    const spoken = 'The chapter content continues. '.repeat(210) + 'সম্পূর্ণ পাঠ।';
    const chunks = speechChunks(spoken);
    expect(chunks.join(' ')).toBe(spoken);
    expect(chunks.every((chunk) => chunk.length <= 220)).toBe(true);
  });

  it('rejects a stream which ends before any playable audio arrives', async () => {
    await expect(
      consumeSpeechStream(new Response('event: done\ndata: {}\n\n'), vi.fn(), vi.fn()),
    ).rejects.toThrow('Speech synthesis failed');
  });
});
