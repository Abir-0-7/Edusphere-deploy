'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sendFocusExtensionMessage } from '@/lib/extension-bridge';

/**
 * Focus timer (task 3.1). The remaining time is always derived from the
 * server's `expected_end_at`, never from a tick counter — so a tab sleep, a
 * refresh or navigation cannot drift the clock. The running session is also
 * persisted server-side and restored on mount.
 */

type GetToken = () => Promise<string | null>;

interface FocusSession {
  id: string;
  kind: string;
  planned_seconds: number;
  status: string;
  started_at: string;
  expected_end_at: string;
}

const KINDS = [
  { key: 'pomodoro', label: 'Pomodoro', minutes: 25 },
  { key: 'desk', label: 'Desk', minutes: 50 },
  { key: 'ultradian', label: 'Ultradian', minutes: 90 },
] as const;

const baseUrl = () => process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';

async function authFetch(getToken: GetToken, path: string, init: RequestInit = {}) {
  const token = await getToken();
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token ?? ''}` },
  });
}

function remainingSeconds(session: FocusSession, now: number): number {
  return Math.max(0, Math.round((new Date(session.expected_end_at).getTime() - now) / 1000));
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function FocusTimer() {
  const { getToken } = useAuth();
  const [session, setSession] = useState<FocusSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const finishing = useRef(false);
  const completionFailed = useRef(false);

  const complete = useCallback(
    async (s: FocusSession) => {
      if (finishing.current) return;
      finishing.current = true;
      try {
        const res = await authFetch(getToken, `/api/focus-sessions/${s.id}/complete`, { method: 'POST' });
        if (!res.ok) throw new Error(`Focus session completion failed (${res.status})`);
        const data = (await res.json()) as { status: string; tokens_awarded: number; token_balance: number };
        sendFocusExtensionMessage({
          version: 1,
          type: 'studyvault.focus-session.v1',
          active: false,
          sessionId: s.id,
          expectedEndAt: null,
          sentAt: Date.now(),
        });
        setBalance(data.token_balance);
        setMessage(
          data.status === 'completed'
            ? `Session complete — +${data.tokens_awarded} tokens.`
            : `Ended early — +${data.tokens_awarded} tokens for the time you studied.`,
        );
        setSession(null);
        completionFailed.current = false;
      } catch {
        completionFailed.current = true;
        setMessage('Could not save the session; it will be retried on reload.');
      } finally {
        finishing.current = false;
      }
    },
    [getToken],
  );

  // Restore a running session after refresh/navigation.
  useEffect(() => {
    void (async () => {
      const requestSentAt = Date.now();
      try {
        const res = await authFetch(getToken, '/api/focus-sessions/current');
        if (res.ok) {
          const current = (await res.json()) as FocusSession | null;
          if (current) {
            setSession(current);
            sendFocusExtensionMessage({
              version: 1,
              type: 'studyvault.focus-session.v1',
              active: true,
              sessionId: current.id,
              expectedEndAt: current.expected_end_at,
              sentAt: requestSentAt,
            });
          } else {
            sendFocusExtensionMessage({
              version: 1,
              type: 'studyvault.focus-session.v1',
              active: false,
              sessionId: null,
              expectedEndAt: null,
              sentAt: requestSentAt,
            });
          }
        }
      } catch (error) {
        setMessage(error instanceof Error ? 'Could not restore the focus session.' : 'Could not restore the focus session.');
      } finally {
        setRestoring(false);
      }
    })();
  }, [getToken]);

  // Render from the server's end timestamp, not a local countdown.
  useEffect(() => {
    if (!session) return;
    const tick = () => {
      const left = remainingSeconds(session, Date.now());
      setRemaining(left);
      if (left === 0 && !completionFailed.current) void complete(session);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [session, complete]);

  const start = async (kind: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await authFetch(getToken, '/api/focus-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      if (!res.ok) {
        setMessage('Could not start a session (one may already be running).');
        return;
      }
      const s = (await res.json()) as FocusSession;
      setSession(s);
      sendFocusExtensionMessage({
        version: 1,
        type: 'studyvault.focus-session.v1',
        active: true,
        sessionId: s.id,
        expectedEndAt: s.expected_end_at,
        sentAt: Date.now(),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded border p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Focus</h2>
        {balance !== null && <span className="text-sm text-neutral-600">{balance} tokens</span>}
      </div>

      {session ? (
        <div className="mt-4 text-center">
          <p className="font-mono text-5xl tabular-nums" aria-live="polite" aria-label="time remaining">
            {mmss(remaining)}
          </p>
          <p className="mt-1 text-sm capitalize text-neutral-500">{session.kind}</p>
          <button
            onClick={() => {
              completionFailed.current = false;
              void complete(session);
            }}
            className="mt-4 rounded border px-4 py-2 text-sm hover:bg-neutral-50"
          >
            End session
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {KINDS.map((k) => (
            <button
              key={k.key}
              onClick={() => void start(k.key)}
              disabled={busy || restoring}
              className="rounded border px-3 py-4 text-center hover:bg-neutral-50 disabled:opacity-50"
            >
              <span className="block text-sm font-medium">{k.label}</span>
              <span className="block text-xs text-neutral-500">{k.minutes} min</span>
            </button>
          ))}
        </div>
      )}
      {message && <p className="mt-3 text-sm text-neutral-700">{message}</p>}
    </div>
  );
}
