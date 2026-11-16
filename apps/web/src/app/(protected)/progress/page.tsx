'use client';

import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
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

export default function ProgressPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [advice, setAdvice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const token = await getToken();
      const headers = { authorization: `Bearer ${token ?? ''}` };
      const [dashboardResponse, readinessResponse] = await Promise.all([
        fetch(`${baseUrl()}/api/dashboard`, { headers }),
        fetch(`${baseUrl()}/api/readiness`, { headers }),
      ]);
      if (!dashboardResponse.ok || !readinessResponse.ok) {
        throw new Error(`Study service returned ${!dashboardResponse.ok ? dashboardResponse.status : readinessResponse.status}.`);
      }
      const [dashboardData, readinessData] = await Promise.all([dashboardResponse.json(), readinessResponse.json()]);
      setData(dashboardData as Dashboard);
      setReadiness(readinessData as Readiness);
    } catch (error) {
      setErr(error instanceof Error && error.message.startsWith('Study service')
        ? error.message
        : 'Your study service is unavailable right now. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const fetchAdvice = async () => {
    setLoadingAdvice(true);
    setAdviceError(null);
    try {
      const token = await getToken();
      const response = await fetch(`${baseUrl()}/api/advice/weekly`, {
        headers: { authorization: `Bearer ${token ?? ''}` },
      });
      if (!response.ok) throw new Error('Advice request failed');
      setAdvice(((await response.json()) as { content: string }).content);
    } catch {
      setAdviceError('Could not generate advice right now. Your study records are unchanged.');
    } finally {
      setLoadingAdvice(false);
    }
  };

  return (
    <main className="workspace-page space-y-6">
      <header className="page-heading-row">
        <div>
          <p className="page-kicker">BUILD YOUR MOMENTUM</p>
          <h1 className="page-heading">Focus & progress</h1>
          <p className="page-subtitle">Make time for deep work, see what is sticking, and plan your next study session.</p>
        </div>
        <Link href="/library" className="action-secondary">Open my library <span aria-hidden="true">→</span></Link>
      </header>

      {err && (
        <div className="surface flex flex-wrap items-center justify-between gap-4 border-[#eed9ca] bg-[#fff9f4] p-4" role="alert">
          <div>
            <h2 className="text-sm font-semibold text-[#853c22]">Progress could not be loaded</h2>
            <p className="mt-1 text-sm text-[#795a48]">{err}</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="action-secondary disabled:opacity-50">
            {loading ? 'Trying again…' : 'Try again'}
          </button>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="surface overflow-hidden" aria-labelledby="focus-heading">
          <div className="border-b border-[var(--line)] bg-[#f1f6f1] px-5 py-4">
            <p className="page-kicker">ONE SESSION AT A TIME</p>
            <h2 id="focus-heading" className="section-heading">Settle into focus</h2>
            <p className="section-caption">Choose a duration. Completed sessions earn study tokens.</p>
          </div>
          <div className="p-1"><FocusTimer /></div>
        </section>

        <section className="surface p-5" aria-busy={loading}>
          <div className="flex items-end justify-between">
            <div>
              <p className="page-kicker">HOW YOU ARE DOING</p>
              <h2 className="section-heading">Readiness</h2>
            </div>
            <span className="font-serif text-3xl text-[var(--forest)]">{readiness ? `${readiness.score}/100` : '—'}</span>
          </div>
          {readiness && (
            <>
              <div className="mt-5 h-2 w-full overflow-hidden rounded bg-[#e2ebe4]">
                <div
                  className="h-full bg-[var(--forest)]"
                  style={{ width: `${readiness.score}%` }}
                  role="progressbar"
                  aria-label="Readiness score"
                  aria-valuenow={readiness.score}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
                <ScorePart label="Coverage" value={readiness.coverage} />
                <ScorePart label="Retention" value={readiness.retention} />
                <ScorePart label="Activity" value={readiness.activity} />
              </dl>
            </>
          )}
          {!readiness && <p className="mt-5 text-sm leading-6 text-[var(--muted)]" role="status">{loading ? 'Loading your readiness…' : 'Your readiness is unavailable until the study service reconnects.'}</p>}
        </section>
      </div>

      <section className="surface p-5 sm:p-6" aria-busy={loading}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="page-kicker">A WEEK IN YOUR WORKSPACE</p>
            <h2 className="section-heading">Last 7 days</h2>
          </div>
          <span className="text-xs text-[var(--muted)]">Focus time by day</span>
        </div>
        {data ? (
          <>
            <dl className="mt-5 grid grid-cols-2 gap-3 border-y border-[var(--line)] py-5 text-sm sm:grid-cols-4">
              <Stat label="Focus" value={`${data.focus_minutes_7d} min`} />
              <Stat label="Reviews" value={String(data.reviews_7d)} />
              <Stat label="Cards due" value={String(data.due_flashcards)} />
              <Stat label="Tokens" value={String(data.token_balance)} />
            </dl>
            <FocusBars perDay={data.focus_seconds_per_day} />
            {data.focus_minutes_7d === 0 && data.reviews_7d === 0 && (
              <p className="mt-4 text-sm leading-6 text-[var(--muted)]">A fresh start. Begin a focus session or <Link href="/library" className="font-semibold text-[var(--forest)] underline underline-offset-4">add your first PDF</Link> to build your study history.</p>
            )}
          </>
        ) : (
          <p className="mt-5 text-sm text-[var(--muted)]" role="status">{loading ? 'Loading your study activity…' : 'Activity is unavailable. Use Try again above to reconnect.'}</p>
        )}
      </section>

      <section className="surface bg-[#f1f6f1] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="page-kicker">YOUR NEXT CHAPTER</p>
            <h2 className="section-heading">Next week advice</h2>
          </div>
          <button type="button" onClick={() => void fetchAdvice()} disabled={loadingAdvice} className="action-secondary disabled:opacity-50">
            {loadingAdvice ? 'Thinking…' : advice ? 'Refresh advice' : 'Generate advice'}
          </button>
        </div>
        <p className="mt-4 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-[#52635a]">
          {advice ?? 'Turn your last seven days of activity into a short, personal plan for the week ahead.'}
        </p>
        {adviceError && <p className="mt-3 text-sm text-[#853c22]" role="alert">{adviceError}</p>}
      </section>
    </main>
  );
}

function ScorePart({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-[var(--forest)]">{Math.round(value * 100)}%</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-2 font-serif text-2xl text-[var(--ink)]">{value}</dd>
    </div>
  );
}

function FocusBars({ perDay }: { perDay: Record<string, number> }) {
  const days: { date: string; seconds: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - i);
    const key = date.toISOString().slice(0, 10);
    days.push({ date: key, seconds: perDay[key] ?? 0 });
  }
  const max = Math.max(1, ...days.map((day) => day.seconds));
  return (
    <div className="mt-5 flex h-32 items-end gap-3" role="img" aria-label="Focus minutes per day">
      {days.map((day) => (
        <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
          <div className="w-full rounded-t bg-[#72a38a]" style={{ height: `${Math.max(2, (day.seconds / max) * 96)}px` }} title={`${Math.round(day.seconds / 60)} min`} />
          <span className="text-[10px] text-[var(--muted)]">{day.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}
