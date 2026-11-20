'use client';

import { useAuth } from '@clerk/nextjs';
import { useState } from 'react';

interface PlanDay {
  date: string;
  chapters: string[];
  minutes: number;
  focus: string;
}
interface ExamPlan {
  exam_date: string;
  days: PlanDay[];
}

const baseUrl = () => process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';

/** Exam scheduler panel (task 3.5): exam date -> saved day-by-day plan. */
export function ExamPlanPanel({ documentId }: { documentId: string }) {
  const { getToken } = useAuth();
  const [examDate, setExamDate] = useState('');
  const [plan, setPlan] = useState<ExamPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => {
    if (!examDate) return;
    setBusy(true);
    setErr(null);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl()}/api/documents/${documentId}/study-plan`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({ exam_date: examDate, minutes_per_day: 60 }),
      });
      if (!res.ok) {
        setErr('Could not build a plan yet — make sure the document has chapters.');
        return;
      }
      setPlan((await res.json()) as ExamPlan);
    } catch {
      setErr('Could not reach the study planner. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="document-exam-panel mt-6">
      <h2 className="text-lg font-semibold">Exam planner</h2>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="block text-xs text-neutral-500">Exam date</span>
          <input
            type="date"
            value={examDate}
            min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
            onChange={(e) => setExamDate(e.target.value)}
            className="mt-1 rounded border px-3 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={generate}
          disabled={busy || !examDate}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Planning…' : 'Build plan'}
        </button>
      </div>
      {err && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {err}
        </p>
      )}
      {plan && (
        <ol className="mt-3 space-y-1">
          {plan.days.map((d) => (
            <li key={d.date} className="rounded border px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{d.date}</span>
                <span className="text-neutral-500">{d.minutes} min</span>
              </div>
              <p className="mt-1 text-neutral-700">{d.chapters.join(', ') || 'Rest / catch up'}</p>
              <p className="mt-0.5 text-xs text-neutral-500">{d.focus}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
