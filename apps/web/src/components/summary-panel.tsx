'use client';

import { useAuth } from '@clerk/nextjs';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { TtsPlayer } from '@/components/tts-player';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/ai-client';
import type { Chapter } from '@/lib/ai-types';
import { readEventStream } from '@/lib/event-stream';

/** Summary levels, in the order the "Explain It" slider walks them (task 2.6). */
export const LEVELS = ['eli5', 'standard', 'deep_dive'] as const;
export type SummaryLevel = (typeof LEVELS)[number];

const LABEL: Record<SummaryLevel, string> = {
  eli5: 'Explain like I’m 5',
  standard: 'Standard',
  deep_dive: 'Deep dive',
};

export async function requestSummary(
  chapterId: string,
  level: SummaryLevel,
  token: string | null,
  signal: AbortSignal,
  onToken: (token: string) => void,
): Promise<string> {
  const getToken = async () => token;
  const path = '/api/chapters/' + chapterId + '/summary';
  const saved = await authFetch(getToken, path + '?level=' + level, {
    signal,
  });

  if (signal.aborted) throw new DOMException('Summary request aborted', 'AbortError');
  if (saved.ok) {
    const data = (await saved.json()) as { content?: unknown };
    if (typeof data.content === 'string') return data.content;
    throw new Error('Invalid saved summary');
  }
  if (saved.status !== 404) throw new Error('Could not load the saved summary');

  const response = await authFetch(getToken, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error('Summary generation failed');

  let content = '';
  for await (const frame of readEventStream(response)) {
    signal.throwIfAborted();
    const payload = JSON.parse(frame.data) as { token?: unknown; error?: unknown; done?: unknown };
    if (typeof payload.token === 'string') {
      content += payload.token;
      onToken(payload.token);
    } else if (payload.done === true) {
      return content;
    } else {
      throw new Error('Summary generation failed');
    }
  }
  throw new Error('Summary stream ended before completion');
}

/**
 * Chapter summary with the "Explain It" complexity slider (tasks 2.5, 2.6).
 * Switching level streams a new summary without a page reload; saved summaries
 * load instantly with no LLM call.
 */
export function SummaryPanel({ chapter }: { chapter: Chapter }) {
  const { getToken } = useAuth();
  const [level, setLevel] = useState<SummaryLevel>('standard');
  const [text, setText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(false);
  const narration = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const activeController = useRef<AbortController | null>(null);

  const load = useCallback(
    async (next: SummaryLevel) => {
      activeController.current?.abort();
      const controller = new AbortController();
      activeController.current = controller;
      const currentRequest = ++requestId.current;
      const isCurrent = () => requestId.current === currentRequest && !controller.signal.aborted;
      setLevel(next);
      setText('');
      setError(false);
      setStreaming(true);
      try {
        const token = await getToken();
        if (!isCurrent()) return;
        const result = await requestSummary(chapter.id, next, token, controller.signal, (part) => {
          if (isCurrent()) setText((previous) => previous + part);
        });
        if (isCurrent()) setText(result);
      } catch {
        if (isCurrent()) {
          setText('');
          setError(true);
        }
      } finally {
        if (isCurrent()) {
          setStreaming(false);
          activeController.current = null;
        }
      }
    },
    [chapter.id, getToken],
  );

  useEffect(() => {
    void load('standard');
    return () => activeController.current?.abort();
  }, [load]);

  const index = LEVELS.indexOf(level);

  return (
    <div className="mt-2 rounded border p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-neutral-500">Explain It</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-600">{LABEL[level]}</span>
          <input
            type="range"
            min={0}
            max={LEVELS.length - 1}
            step={1}
            value={index}
            aria-label="Summary complexity"
            onChange={(e) => void load(LEVELS[Number(e.target.value)] ?? 'standard')}
            disabled={streaming}
            className="w-32"
          />
        </div>
      </div>
      <div ref={narration}>
        {text && <MarkdownRenderer markdown={text} className="mt-3 text-sm text-neutral-800" />}
      </div>
      {!text && !error && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-800">
          {streaming ? 'Generating…' : 'No summary yet.'}
        </p>
      )}
      {error && (
        <div className="mt-3 text-sm">
          <p role="alert">Could not load the chapter summary.</p>
          <button type="button" className="mt-1 underline" onClick={() => void load(level)}>
            Try again
          </button>
        </div>
      )}
      <TtsPlayer
        sourceKey={chapter.id + ':' + level}
        getText={() => narration.current?.innerText ?? ''}
        disabled={streaming || !text.trim()}
        label="Listen to summary"
      />
    </div>
  );
}
