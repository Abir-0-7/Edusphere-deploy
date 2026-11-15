import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestSummary, SummaryPanel } from '../src/components/summary-panel';

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: vi.fn(async () => 'test-token') }),
}));

describe('SummaryPanel', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('renders the accessible three-level slider at Standard by default', () => {
    vi.stubGlobal('React', React);
    const markup = renderToStaticMarkup(
      React.createElement(SummaryPanel, {
        chapter: { id: 'chapter-1', title: 'Photosynthesis', ordinal: 1, start_page: 1, end_page: 2 },
      }),
    );

    expect(markup).toContain('aria-label="Summary complexity"');
    expect(markup).toContain('min="0" max="2" step="1"');
    expect(markup).toContain('value="1"');
    expect(markup).toContain('Standard');
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

    const result = await requestSummary('chapter-1', 'eli5', 'test-token', new AbortController().signal, vi.fn());

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
              controller.enqueue(encoder.encode('}\n\ndata: {"token":"explanation"}\n\ndata: {"done":true}\n\n'));
              controller.close();
            },
          }),
          { status: 200 },
        );
    });
    vi.stubGlobal('fetch', fetchMock);
    const tokens: string[] = [];

    const result = await requestSummary(
      'chapter-1',
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
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const request = requestSummary('chapter-1', 'deep_dive', 'test-token', controller.signal, vi.fn());
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
