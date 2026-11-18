'use client';

import { useAuth } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import { getTokenBalance, type GetToken } from '@/lib/ai-client';

/** The same persisted StudyVault balance used by focus and the progress page. */
export function GameTokenBalance({ reward }: { reward?: string }) {
  const { isLoaded, userId, getToken } = useAuth();
  if (!isLoaded) return <p role="status">Study tokens: Loading…</p>;
  if (!userId) return <p>Sign in to see your study tokens.</p>;
  return <AccountTokenBalance key={userId} getToken={getToken} reward={reward} />;
}

function AccountTokenBalance({ getToken, reward }: { getToken: GetToken; reward?: string }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    let latest = 0;
    const load = async () => {
      const request = ++latest;
      try {
        const result = await getTokenBalance(getToken);
        if (!live || request !== latest) return;
        setBalance(result.balance);
        setFailed(false);
      } catch {
        if (!live || request !== latest) return;
        setBalance(null);
        setFailed(true);
      }
    };
    const refresh = () => {
      void load();
    };
    const becameVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', becameVisible);
    return () => {
      live = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', becameVisible);
    };
  }, [getToken, reward, retry]);

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
      <p role="status" aria-live="polite">
        Study tokens: {failed ? 'Unavailable' : balance === null ? 'Loading…' : balance}
      </p>
      {failed && (
        <button
          type="button"
          className="rounded px-2 py-1 font-semibold text-blue-800 underline focus-visible:outline-2"
          onClick={() => {
            setFailed(false);
            setRetry((value) => value + 1);
          }}
        >
          Retry token balance
        </button>
      )}
    </div>
  );
}
