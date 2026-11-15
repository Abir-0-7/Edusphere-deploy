'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useState } from 'react';
import { FocusTimer } from '@/components/focus-timer';

interface Dashboard {
  focus_minutes_7d: number;
  focus_seconds_per_day: Record<string, number>;
  reviews_7d: number;
  due_flashcards: number;
  token_balance: number;
}

interface Readiness {
  score: number;
  coverage: number;
  retention: number;
  activity: number;
}

const baseUrl = () => process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';

/**
 * Study dashboard (task 3.7): focus time per day, review counts, due cards,
 * token balance and the readiness score with its components.
 */
export default function ProgressPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [advice, setAdvice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadingAdvice, setLoadingAdvice] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    const headers = { authorization: `Bearer ${token ?? ''}` };
    try {
      const [d, r] = await Promise.all([
        fetch(`${baseUrl()}/api/dashboard`, { headers }),
        fetch(`${baseUrl()}/api/readiness`, { headers }),
      ]);
      if (d.ok) setData((await d.json()) as Dashboard);
      if (r.ok) setReadiness((await r.json()) as Readiness);
    } catch {
      setErr('Could not load your progress.');
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const fetchAdvice = async () => {
    setLoadingAdvice(true);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl()}/api/advice/weekly`, {
        headers: { authorization: `Bearer ${token ?? ''}` },
      });
      if (res.ok) setAdvice(((await res.json()) as { content: string }).content);
    } catch {
      setErr('Could not generate advice right now.');
    } finally {
      setLoadingAdvice(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Progress</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}

      <FocusTimer />

      <section className="rounded border p-5">
        <div className="flex items-end justify-between">
          <h2 className="text-lg font-semibold">Readiness</h2>
          <span className="text-2xl font-bold">{readiness ? `${readiness.score}/100` : '—'}</span>
        </div>
        {readiness && (
          <>
            <div className="mt-3 h-2 w-full overflow-hidden rounded bg-neutral-200">
              <div
                className="h-full bg-blue-600"
                style={{ width: `${readiness.score}%` }}
                role="progressbar"
                aria-valuenow={readiness.score}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <Component label="Coverage" value={readiness.coverage} />
              <Component label="Retention" value={readiness.retention} />
              <Component label="Activity" value={readiness.activity} />
            </dl>
          </>
        )}
      </section>

      <section className="rounded border p-5">
        <h2 className="text-lg font-semibold">Last 7 days</h2>
        {data ? (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Focus" value={`${data.focus_minutes_7d} min`} />
              <Stat label="Reviews" value={String(data.reviews_7d)} />
              <Stat label="Cards due" value={String(data.due_flashcards)} />
              <Stat label="Tokens" value={String(data.token_balance)} />
            </dl>
            <FocusBars perDay={data.focus_seconds_per_day} />
          </>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">Loading…</p>
        )}
      </section>

      <section className="rounded border p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Next week advice</h2>
          <button
            onClick={fetchAdvice}
            disabled={loadingAdvice}
            className="text-sm text-blue-600 hover:underline disabled:opacity-50"
          >
            {loadingAdvice ? 'Thinking…' : advice ? 'Refresh' : 'Generate'}
          </button>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-800">
          {advice ?? 'Generate a short, personalised plan from your last 7 days.'}
        </p>
      </section>
    </main>
  );
}

function Component({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="font-medium">{Math.round(value * 100)}%</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

/** Dependency-free bar chart: no chart library on the free tier. */
function FocusBars({ perDay }: { perDay: Record<string, number> }) {
  const days: { date: string; seconds: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, seconds: perDay[key] ?? 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.seconds));
  return (
    <div className="mt-4 flex h-28 items-end gap-2" role="img" aria-label="Focus minutes per day">
      {days.map((d) => (
        <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-blue-500"
            style={{ height: `${Math.max(2, (d.seconds / max) * 96)}px` }}
            title={`${Math.round(d.seconds / 60)} min`}
          />
          <span className="text-[10px] text-neutral-500">{d.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}
