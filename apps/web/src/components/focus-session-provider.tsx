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
  gameVaultAccess: 'open' | 'locked' | 'checking' | 'unavailable';
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
    <FocusSessionState key={userId ?? 'signed-out'} accountId={isLoaded ? userId : null}>
      {children}
    </FocusSessionState>
  );
}

function FocusSessionState({
  children,
  accountId,
}: {
  children: ReactNode;
  accountId: string | null | undefined;
}) {
  const enabled = !!accountId;
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
  const updates = useRef<BroadcastChannel | null>(null);
  // Ignore restores captured before a write; queue tab changes received during it.
  const mutationVersion = useRef(0);
  const refreshNeeded = useRef(false);

  const refreshFromServer = useCallback(() => {
    if (pending.current) {
      refreshNeeded.current = true;
      return;
    }
    setRestoring(true);
    setRestoreAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Recheck the server when another tab starts or ends focus for this account.
  useEffect(() => {
    if (!accountId || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(`studyvault:focus:${accountId}`);
    updates.current = channel;
    channel.onmessage = refreshFromServer;
    return () => {
      updates.current = null;
      channel.close();
    };
  }, [accountId, refreshFromServer]);

  const complete = useCallback(
    async (current: FocusSessionResponse) => {
      if (pending.current) return;
      pending.current = true;
      mutationVersion.current += 1;
      setRestoring(false);
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
        updates.current?.postMessage('changed');
      } catch {
        if (!mounted.current) return;
        completionFailed.current = true;
        setMessage('Could not save the session. Choose End session to retry.');
      } finally {
        pending.current = false;
        if (mounted.current) {
          setBusy(false);
          if (refreshNeeded.current) {
            refreshNeeded.current = false;
            refreshFromServer();
          }
        }
      }
    },
    [getToken, refreshFromServer],
  );

  // Reloads and ordinary anchor navigation restore the server-owned session.
  useEffect(() => {
    if (!enabled) return;
    if (pending.current) {
      refreshNeeded.current = true;
      return;
    }
    let cancelled = false;
    const requestVersion = mutationVersion.current;
    const requestSentAt = Date.now();
    setRestoring(true);
    setRestoreFailed(false);
    setMessage(null);
    void (async () => {
      try {
        const current = await getCurrentFocusSession(getToken);
        if (cancelled || requestVersion !== mutationVersion.current) return;
        setSession(current);
        completionFailed.current = false;
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
        if (cancelled || requestVersion !== mutationVersion.current) return;
        setRestoreFailed(true);
        setMessage(error instanceof Error ? error.message : 'Could not restore the focus session.');
      } finally {
        if (!cancelled && requestVersion === mutationVersion.current) setRestoring(false);
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
    mutationVersion.current += 1;
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
      updates.current?.postMessage('changed');
    } catch (error) {
      refreshNeeded.current = true;
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : 'Could not start a focus session.');
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        if (refreshNeeded.current) {
          refreshNeeded.current = false;
          refreshFromServer();
        }
      }
    }
  };

  const finish = async () => {
    if (session && enabled) await complete(session);
  };

  const retryRestore = () => {
    if (!restoring && !pending.current) setRestoreAttempt((attempt) => attempt + 1);
  };

  let gameVaultAccess: FocusState['gameVaultAccess'] = 'open';
  if (session) gameVaultAccess = 'locked';
  else if (restoring || !enabled || busy) gameVaultAccess = 'checking';
  else if (restoreFailed) gameVaultAccess = 'unavailable';

  return (
    <FocusContext
      value={{
        session,
        gameVaultAccess,
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
