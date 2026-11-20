'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FocusSessionResponse } from '@studyvault/types';
import { sendFocusExtensionMessage } from '@/lib/extension-bridge';
import { completeFocusSession, getCurrentFocusSession, startFocusSession } from '@/lib/study-client';

function secondsLeft(session: FocusSessionResponse): number {
  return Math.max(0, Math.ceil((Date.parse(session.expected_end_at) - Date.now()) / 1000));
}

export function formatFocusTime(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

interface FocusState {
  session: FocusSessionResponse | null;
  remaining: number;
  restoring: boolean;
  restoreFailed: boolean;
  busy: boolean;
  message: string | null;
  balance: number | null;
  start: (kind: string) => Promise<void>;
  finish: () => Promise<void>;
  retryRestore: () => void;
}

const FocusContext = createContext<FocusState | null>(null);

/** Keep one clock and one completion owner across every signed-in route. */
export function FocusSessionProvider({ children }: { children: ReactNode }) {
  const { userId, isLoaded } = useAuth();
  return (
    <FocusSessionState key={userId ?? 'signed-out'} enabled={isLoaded && !!userId}>
      {children}
    </FocusSessionState>
  );
}

function FocusSessionState({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const { getToken } = useAuth();
  const [session, setSession] = useState<FocusSessionResponse | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [restoring, setRestoring] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const completionFailed = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const complete = useCallback(
    async (current: FocusSessionResponse) => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      setMessage(null);
      try {
        const data = await completeFocusSession(getToken, current.id);
        if (!mounted.current) return;
        sendFocusExtensionMessage({
          version: 1,
          type: 'studyvault.focus-session.v1',
          active: false,
          sessionId: current.id,
          expectedEndAt: null,
          sentAt: Date.now(),
        });
        setBalance(data.token_balance);
        setMessage(
          data.status === 'completed'
            ? `Session complete - +${data.tokens_awarded} tokens.`
            : `Ended early - +${data.tokens_awarded} tokens for the time you studied.`,
        );
        setSession(null);
        completionFailed.current = false;
      } catch {
        if (!mounted.current) return;
        completionFailed.current = true;
        setMessage('Could not save the session. Choose End session to retry.');
      } finally {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [getToken],
  );

  // Reloads and ordinary anchor navigation restore the server-owned session.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const requestSentAt = Date.now();
    setRestoring(true);
    setRestoreFailed(false);
    setMessage(null);
    void (async () => {
      try {
        const current = await getCurrentFocusSession(getToken);
        if (cancelled) return;
        setSession(current);
        setRemaining(current ? secondsLeft(current) : 0);
        sendFocusExtensionMessage(
          current
            ? {
                version: 1,
                type: 'studyvault.focus-session.v1',
                active: true,
                sessionId: current.id,
                expectedEndAt: current.expected_end_at,
                sentAt: requestSentAt,
              }
            : {
                version: 1,
                type: 'studyvault.focus-session.v1',
                active: false,
                sessionId: null,
                expectedEndAt: null,
                sentAt: requestSentAt,
              },
        );
      } catch (error) {
        if (cancelled) return;
        setRestoreFailed(true);
        setMessage(error instanceof Error ? error.message : 'Could not restore the focus session.');
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, getToken, restoreAttempt]);

  useEffect(() => {
    if (!session || !enabled) return;
    const tick = () => {
      const left = secondsLeft(session);
      setRemaining(left);
      if (left === 0 && !completionFailed.current) void complete(session);
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [session, enabled, complete]);

  const start = async (kind: string) => {
    if (pending.current || session || restoring || restoreFailed || !enabled) return;
    pending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const current = await startFocusSession(getToken, kind);
      if (!mounted.current) return;
      completionFailed.current = false;
      setRemaining(secondsLeft(current));
      setSession(current);
      sendFocusExtensionMessage({
        version: 1,
        type: 'studyvault.focus-session.v1',
        active: true,
        sessionId: current.id,
        expectedEndAt: current.expected_end_at,
        sentAt: Date.now(),
      });
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : 'Could not start a focus session.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const finish = async () => {
    if (session && enabled) await complete(session);
  };

  const retryRestore = () => {
    if (!restoring && !pending.current) setRestoreAttempt((attempt) => attempt + 1);
  };

  return (
    <FocusContext
      value={{
        session,
        remaining,
        restoring: restoring || !enabled,
        restoreFailed,
        busy,
        message,
        balance,
        start,
        finish,
        retryRestore,
      }}
    >
      {children}
    </FocusContext>
  );
}

export function useFocusSession(): FocusState {
  const state = useContext(FocusContext);
  if (!state) throw new Error('Focus timer must be inside FocusSessionProvider.');
  return state;
}
