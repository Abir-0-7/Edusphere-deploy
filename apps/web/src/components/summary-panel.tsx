'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Chapter } from '@/lib/ai-types';

/** Summary levels, in the order the "Explain It" slider walks them (task 2.6). */
export const LEVELS = ['eli5', 'standard', 'deep_dive'] as const;
export type SummaryLevel = (typeof LEVELS)[number];

const LABEL: Record<SummaryLevel, string> = {
  eli5: 'Explain like I’m 5',
  standard: 'Standard',
  deep_dive: 'Deep dive',
};

function baseUrl() {
  return process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';
}

export async function requestSummary(
  chapterId: string,
  level: SummaryLevel,
  token: string | null,
  signal: AbortSignal,
  onToken: (token: string) => void,
): Promise<string> {
  const headers = { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' };
  const saved = await fetch(`${baseUrl()}/api/chapters/${chapterId}/summary?level=${level}`, {
    headers,
    signal,
  }).catch((error: unknown) => {
    if (signal.aborted) throw error;
    return null;
  });

  if (signal.aborted) throw new DOMException('Summary request aborted', 'AbortError');
  if (saved?.ok) {
    const data = (await saved.json()) as { content?: unknown };
    if (typeof data.content === 'string') return data.content;
  }

  const response = await fetch(`${baseUrl()}/api/chapters/${chapterId}/summary`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ level }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error('Summary generation failed');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      const line = event.split('\n').find((entry) => entry.startsWith('data: '));
      if (!line) continue;
      const payload = JSON.parse(line.slice(6)) as { token?: string; error?: string };
      if (payload.error) throw new Error('Summary generation failed');
      if (payload.token) {
        content += payload.token;
        onToken(payload.token);
      }
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const line = buffer.split('\n').find((entry) => entry.startsWith('data: '));
    if (line) {
      const payload = JSON.parse(line.slice(6)) as { token?: string; error?: string };
      if (payload.error) throw new Error('Summary generation failed');
      if (payload.token) {
        content += payload.token;
        onToken(payload.token);
      }
    }
  }
  return content;
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
      setStreaming(true);
      try {
        const token = await getToken();
        if (!isCurrent()) return;
        const result = await requestSummary(chapter.id, next, token, controller.signal, (part) => {
          if (isCurrent()) setText((previous) => previous + part);
        });
        if (isCurrent()) setText(result);
      } catch {
        if (isCurrent()) setText('Could not generate a summary. Try again.');
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
      <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-800">
        {text || (streaming ? 'Generating…' : 'No summary yet.')}
      </p>
    </div>
  );
}
