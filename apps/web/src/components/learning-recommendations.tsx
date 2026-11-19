'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { RecommendationResponse } from '@studyvault/types';
import type { GetToken } from '@/lib/ai-client';
import { getRecommendations } from '@/lib/learner-recommendation-client';

function stateText(state: RecommendationResponse['mastery'][number]['state']) {
  switch (state) {
    case 'demonstrated':
      return 'Demonstrated by an independent checkpoint';
    case 'needs_practice':
      return 'Recent independent attempts need practice';
    case 'developing':
      return 'Starting signal only';
    case 'unknown':
      return 'Unknown — not assessed';
  }
}

export function LearningRecommendations({
  getToken,
  planRevision = 0,
}: {
  getToken: GetToken;
  planRevision?: number;
}) {
  const [minutes, setMinutes] = useState('20');
  const [request, setRequest] = useState({ availableMinutes: 20, sequence: 0 });
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setRequest((prior) => ({ availableMinutes: Number(minutes), sequence: prior.sequence + 1 }));
  }, [minutes]);

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(null);
    void getRecommendations(getToken, { available_minutes: request.availableMinutes })
      .then((snapshot) => {
        if (active) setResult(snapshot);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load a recommendation.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [getToken, request, planRevision]);

  return (
    <section aria-labelledby="recommendations-title" className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="rounded border p-4 sm:p-5">
        <h2 id="recommendations-title" className="text-xl font-semibold">
          Your learning plan
        </h2>
        <p className="mt-2 text-neutral-700">
          Recommendations follow course prerequisites, independent checkpoints, recent objective-linked
          errors, and scheduled reviews. Reading, time, diagnostic signals, and XP never demonstrate mastery.
        </p>
        <p className="mt-2 text-sm text-neutral-700">
          The existing readiness score is a study-activity proxy only; it does not show skill mastery or
          career readiness.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium" htmlFor="recommendation-minutes">
            Time available now (minutes)
            <input
              id="recommendation-minutes"
              type="number"
              min={1}
              max={480}
              step={1}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className="mt-1 block w-36 rounded border px-3 py-2"
            />
          </label>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={
              busy || !Number.isInteger(Number(minutes)) || Number(minutes) < 1 || Number(minutes) > 480
            }
            className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Updating.' : 'Update plan'}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {busy && !result && (
          <p role="status" className="mt-3">
            Building your plan.
          </p>
        )}
        {result && (
          <div className="mt-5 space-y-5">
            <p className="text-sm text-neutral-600">
              Track: {result.track_id ?? 'Choose a goal'} · Plan revision {result.plan_revision} ·{' '}
              {result.due_reviews} scheduled reviews due
            </p>
            <div>
              <h3 className="font-semibold">Next action</h3>
              {result.next_action ? (
                <article className="mt-2 rounded border border-blue-200 bg-blue-50 p-4">
                  <p className="font-medium">{result.next_action.title}</p>
                  <p className="mt-1 text-sm">{result.next_action.reason}</p>
                  <p className="mt-1 text-sm text-neutral-700">
                    About {result.next_action.minutes} minutes ·{' '}
                    {result.next_action.kind.replaceAll('_', ' ')}
                  </p>
                  <Link
                    className="mt-3 inline-block font-medium text-blue-900 underline"
                    href={result.next_action.href}
                  >
                    Open next action
                  </Link>
                </article>
              ) : (
                <p className="mt-2 text-neutral-700">
                  {result.blocked.length
                    ? 'No action is available in this time.'
                    : 'You’re up to date on this plan.'}
                </p>
              )}
            </div>
            {result.blocked.length > 0 && (
              <div>
                <h3 className="font-semibold">Prerequisites and availability</h3>
                <ul className="mt-2 list-disc space-y-2 pl-5">
                  {result.blocked.map((item) => (
                    <li key={item.course_slug || 'session-time'}>
                      {item.course_slug && <strong>{item.course_slug.replaceAll('-', ' ')}: </strong>}
                      {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <h3 className="font-semibold">Objective evidence</h3>
              <ul className="mt-2 space-y-2">
                {result.mastery.map((item) => (
                  <li key={item.objective_id} className="rounded border p-3">
                    <p className="font-medium">{item.title}</p>
                    <p className="text-sm text-neutral-700">{stateText(item.state)}</p>
                    {item.starting_signal !== 'unknown' && (
                      <p className="text-xs text-neutral-600">
                        Optional diagnostic starting signal: {item.starting_signal.replaceAll('_', ' ')}; it
                        does not count as mastery.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
