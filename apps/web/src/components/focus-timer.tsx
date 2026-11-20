'use client';

import { formatFocusTime, useFocusSession } from './focus-session-provider';

const KINDS = [
  { key: 'pomodoro', label: 'Pomodoro', minutes: 25 },
  { key: 'desk', label: 'Desk', minutes: 50 },
  { key: 'ultradian', label: 'Ultradian', minutes: 90 },
] as const;

/** The Study controls and Progress panel share the layout's running session. */
export function FocusTimer({ compact = false }: { compact?: boolean } = {}) {
  const {
    session,
    remaining,
    restoring,
    restoreFailed,
    busy,
    message,
    balance,
    start,
    finish,
    retryRestore,
  } = useFocusSession();
  return (
    <section aria-label="Focus timer" className={`rounded border ${compact ? 'p-3' : 'p-5'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Focus</h2>
        {balance !== null && <span className="text-sm text-neutral-600">{balance} tokens</span>}
      </div>
      {restoreFailed && (
        <button
          type="button"
          onClick={retryRestore}
          disabled={restoring}
          className="mt-2 rounded border px-3 py-2 text-sm disabled:opacity-50"
        >
          Retry focus session
        </button>
      )}
      {session ? (
        <div className={compact ? 'mt-2 flex flex-wrap items-center gap-3' : 'mt-4 text-center'}>
          <p
            role="timer"
            aria-label="time remaining"
            className={`font-mono tabular-nums ${compact ? 'text-2xl' : 'text-5xl'}`}
          >
            {formatFocusTime(remaining)}
          </p>
          <p className="mt-1 text-sm capitalize text-neutral-600">{session.kind}</p>
          <button
            type="button"
            onClick={() => void finish()}
            disabled={busy}
            className={`${compact ? '' : 'mt-4'} rounded border px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50`}
          >
            {busy ? 'Saving…' : 'End session'}
          </button>
        </div>
      ) : (
        <div className={`grid grid-cols-3 gap-2 ${compact ? 'mt-2' : 'mt-4'}`}>
          {KINDS.map((kind) => (
            <button
              key={kind.key}
              type="button"
              onClick={() => void start(kind.key)}
              disabled={busy || restoring || restoreFailed}
              className={`rounded border px-2 text-center hover:bg-neutral-50 disabled:opacity-50 ${compact ? 'py-2' : 'py-4'}`}
            >
              <span className="block text-sm font-medium">{kind.label}</span>
              <span className="block text-xs text-neutral-600">{kind.minutes} min</span>
            </button>
          ))}
        </div>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-neutral-700">
          {message}
        </p>
      )}
    </section>
  );
}

/** In-flow banner stays in view without covering study controls. */
export function ActiveFocusTimer() {
  const { session, remaining, restoring, restoreFailed, busy, message, finish, retryRestore } =
    useFocusSession();
  if (!session && restoreFailed)
    return (
      <section
        aria-label="Active focus session"
        className="sticky top-0 z-40 border-b bg-emerald-50 px-4 py-3 text-emerald-950"
      >
        <p role="status" className="text-sm">
          {message}
        </p>
        <button
          type="button"
          onClick={retryRestore}
          disabled={restoring}
          className="mt-2 rounded border px-3 py-2 text-sm disabled:opacity-50"
        >
          Retry focus session
        </button>
      </section>
    );
  if (!session) return null;
  return (
    <section
      aria-label="Active focus session"
      className="sticky top-0 z-40 border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950 shadow-sm"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-semibold">Focus in progress</span>
          <span className="text-xs capitalize">{session.kind}</span>
          <span
            role="timer"
            aria-label="Focus time remaining"
            className="font-mono text-xl font-semibold tabular-nums"
          >
            {formatFocusTime(remaining)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void finish()}
          disabled={busy}
          className="rounded border border-emerald-700 px-3 py-2 text-sm font-medium hover:bg-emerald-100 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'End session'}
        </button>
      </div>
      {message && (
        <p role="status" className="mx-auto mt-2 max-w-6xl text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
