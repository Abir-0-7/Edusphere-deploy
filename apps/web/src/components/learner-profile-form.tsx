'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  LearnerProfileInputSchema,
  type LearnerDiagnosticDefinition,
  type LearnerProfile,
  type LearnerProfileInput,
} from '@studyvault/types';
import type { GetToken } from '@/lib/ai-client';
import {
  getLearnerDiagnostic,
  getLearnerProfile,
  saveLearnerProfile,
  submitLearnerDiagnostic,
} from '@/lib/learner-profile-client';
import { LearningRecommendations } from '@/components/learning-recommendations';
import { TrackPlanPanel } from '@/components/track-plan-panel';

const initialProfile: LearnerProfileInput = {
  goal_kind: 'career',
  goal: '',
  familiarity: 'unsure',
  weekly_minutes: 120,
  deadline: null,
  language: 'en',
  accessibility: { reduced_motion: false, larger_text: false, text_alternative: false },
  role_variant: 'auto',
  explanation_depth: 'standard',
  pace: 'standard',
};

const skillLabels = {
  'python-expressions': 'Python expressions',
  'python-loops': 'Python loops',
  'python-functions': 'Python functions',
};
const stateLabels = {
  unknown: 'Unknown — not assessed',
  needs_practice: 'Needs practice',
  developing: 'Starting signal',
};
const fieldClass = 'mt-1 block w-full min-w-0 rounded border border-neutral-400 bg-white p-2';
const buttonClass = 'rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50';

/** getToken is supplied by the signed-in page, keeping the form independently renderable. */
export function LearnerProfileForm({ getToken }: { getToken: GetToken }) {
  const [draft, setDraft] = useState<LearnerProfileInput>(initialProfile);
  const [saved, setSaved] = useState<LearnerProfile | null>(null);
  const [trackRevision, setTrackRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<LearnerDiagnosticDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  // A synchronous lock also covers rapid keyboard/click submissions before React renders.
  const busy = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoaded(false);
    setError(null);
    getLearnerProfile(getToken)
      .then(({ profile }) => {
        if (!active) return;
        setSaved(profile);
        setDraft(
          profile
            ? LearnerProfileInputSchema.parse({
                goal_kind: profile.goal_kind,
                goal: profile.goal,
                familiarity: profile.familiarity,
                weekly_minutes: profile.weekly_minutes,
                deadline: profile.deadline,
                language: profile.language,
                accessibility: profile.accessibility,
                role_variant: profile.role_variant,
                explanation_depth: profile.explanation_depth,
                pace: profile.pace,
              })
            : initialProfile,
        );
        setDirty(false);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Could not load your learning profile.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [getToken, retry]);

  function update(change: Partial<LearnerProfileInput>) {
    setDraft((current) => ({ ...current, ...change }));
    setDirty(true);
    setMessage(null);
  }

  async function run(operation: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save. Your entries are still here.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = LearnerProfileInputSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check your preferences.');
      return;
    }
    void run(async () => {
      const { profile } = await saveLearnerProfile(getToken, parsed.data);
      if (!profile) throw new Error('The service did not return your saved profile.');
      setSaved(profile);
      setDraft(parsed.data);
      setDirty(false);
      setMessage('Learning profile saved. You can edit it at any time.');
    });
  }

  function openDiagnostic() {
    void run(async () => {
      setDiagnostic(await getLearnerDiagnostic(getToken));
      setAnswers({});
    });
  }

  function finishDiagnostic(action: 'complete' | 'skip') {
    if (!saved || dirty) return;
    void run(async () => {
      const { profile } = await submitLearnerDiagnostic(getToken, {
        version: diagnostic?.version ?? saved.diagnostic.version,
        action,
        answers:
          action === 'skip'
            ? []
            : (diagnostic?.questions ?? []).map((question) => ({
                question_id: question.id,
                choice_id: answers[question.id] ?? null,
              })),
      });
      if (!profile) throw new Error('The service did not return your saved diagnostic.');
      setSaved(profile);
      setDiagnostic(null);
      setAnswers({});
      setMessage(
        action === 'skip'
          ? 'Diagnostic skipped. Unassessed skills stay unknown; you can try it later.'
          : 'Starting points saved. This check does not establish mastery.',
      );
    });
  }

  return (
    <main
      className={`mx-auto max-w-3xl space-y-6 p-4 sm:p-6 ${draft.accessibility.larger_text ? 'text-lg' : 'text-base'}`}
    >
      <div>
        <h1 className="text-2xl font-bold">Your learning profile</h1>
        <p className="mt-2 text-neutral-700">
          Choose a career or academic goal and the time you can give it. Your experience is self-reported;
          unassessed skills stay unknown.
        </p>
      </div>
      {loading && <p role="status">Loading your learning profile…</p>}
      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded border border-green-300 bg-green-50 p-3 text-green-900">
          {message}
        </p>
      )}
      {!loading && !loaded && (
        <button type="button" className={buttonClass} onClick={() => setRetry((value) => value + 1)}>
          Retry loading profile
        </button>
      )}
      {loaded && (
        <>
          <form onSubmit={save} aria-label="Learning preferences" className="rounded border p-4 sm:p-5">
            <fieldset disabled={pending} className="space-y-4">
              <legend className="mb-3 text-lg font-semibold">Goals and preferences</legend>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <label>
                  Goal type
                  <select
                    className={fieldClass}
                    value={draft.goal_kind}
                    onChange={(event) =>
                      update({ goal_kind: event.target.value as LearnerProfileInput['goal_kind'] })
                    }
                  >
                    <option value="career">Career or role</option>
                    <option value="academic">Academic or exam</option>
                  </select>
                </label>
                <label>
                  Current familiarity
                  <select
                    className={fieldClass}
                    value={draft.familiarity}
                    onChange={(event) =>
                      update({ familiarity: event.target.value as LearnerProfileInput['familiarity'] })
                    }
                  >
                    <option value="unsure">I’m not sure yet</option>
                    <option value="new">I’m new to this</option>
                    <option value="some">I have some experience</option>
                    <option value="experienced">I’m experienced</option>
                  </select>
                </label>
              </div>
              <label className="block">
                Your goal
                <input
                  className={fieldClass}
                  required
                  maxLength={200}
                  value={draft.goal}
                  placeholder="For example, become a data analyst or prepare for an exam"
                  onChange={(event) => update({ goal: event.target.value })}
                />
              </label>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <label>
                  Weekly study time (minutes)
                  <input
                    className={fieldClass}
                    type="number"
                    required
                    min={15}
                    max={10080}
                    step={1}
                    value={Number.isNaN(draft.weekly_minutes) ? '' : draft.weekly_minutes}
                    onChange={(event) => update({ weekly_minutes: event.target.valueAsNumber })}
                  />
                </label>
                <label>
                  Deadline (optional)
                  <input
                    className={fieldClass}
                    type="date"
                    value={draft.deadline ?? ''}
                    onChange={(event) => update({ deadline: event.target.value || null })}
                  />
                </label>
              </div>
              <label className="block">
                Preferred language
                <select
                  className={fieldClass}
                  value={draft.language}
                  aria-describedby="language-note"
                  onChange={(event) =>
                    update({ language: event.target.value as LearnerProfileInput['language'] })
                  }
                >
                  <option value="en">English</option>
                  <option value="bn">Bangla</option>
                </select>
              </label>
              <p id="language-note" className="text-neutral-600">
                We save your language preference. Translated teaching content is not available here yet.
              </p>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <label>
                  Example context
                  <select
                    className={fieldClass}
                    value={draft.role_variant}
                    onChange={(event) =>
                      update({ role_variant: event.target.value as LearnerProfileInput['role_variant'] })
                    }
                  >
                    <option value="auto">Choose from my goal</option>
                    <option value="analyst">Data analyst examples</option>
                    <option value="developer">Software developer examples</option>
                  </select>
                </label>
                <label>
                  Explanation depth
                  <select
                    className={fieldClass}
                    value={draft.explanation_depth}
                    onChange={(event) =>
                      update({
                        explanation_depth: event.target.value as LearnerProfileInput['explanation_depth'],
                      })
                    }
                  >
                    <option value="guided">More guided</option>
                    <option value="standard">Standard</option>
                    <option value="concise">Concise</option>
                  </select>
                </label>
              </div>
              <label className="block">
                Learning pace
                <select
                  className={fieldClass}
                  value={draft.pace}
                  onChange={(event) => update({ pace: event.target.value as LearnerProfileInput['pace'] })}
                >
                  <option value="short_sessions">Short sessions</option>
                  <option value="standard">Standard sessions</option>
                </select>
              </label>
              <p className="text-sm text-neutral-600">
                Examples change around the same course objective and sources. Pace and explanation depth never
                change its facts or checkpoint.
              </p>
              <fieldset className="space-y-2">
                <legend className="mb-2 font-medium">Accessibility preferences</legend>
                {(
                  [
                    ['larger_text', 'Use larger text'],
                    ['reduced_motion', 'Prefer reduced motion'],
                    ['text_alternative', 'Prefer text alternatives to audio'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-3 py-1">
                    <input
                      type="checkbox"
                      checked={draft.accessibility[key]}
                      onChange={(event) =>
                        update({ accessibility: { ...draft.accessibility, [key]: event.target.checked } })
                      }
                    />
                    {label}
                  </label>
                ))}
                <p className="text-neutral-600">This page uses text, with no animation or required audio.</p>
              </fieldset>
              <button type="submit" className={buttonClass}>
                {pending ? 'Working…' : 'Save learning profile'}
              </button>
            </fieldset>
          </form>
          <section aria-labelledby="diagnostic-title" className="space-y-4 rounded border p-4 sm:p-5">
            <h2 id="diagnostic-title" className="text-lg font-semibold">
              Optional Python foundations check
            </h2>
            <p>
              A short, non-executing check can suggest starting points in Python. It does not measure your
              other subjects or establish mastery. You can skip it and keep studying.
            </p>
            {!saved && <p>Save your learning profile first. Taking this check is optional.</p>}
            {saved && (
              <>
                <p>Diagnostic: {saved.diagnostic.status.replace('_', ' ')}.</p>
                <ul className="space-y-1">
                  {saved.diagnostic.skills.map((skill) => (
                    <li key={skill.skill_id}>
                      {skillLabels[skill.skill_id]}: {stateLabels[skill.state]}
                    </li>
                  ))}
                </ul>
                {dirty && <p>Save your preference changes before updating the diagnostic.</p>}
                {!diagnostic && (
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={pending || dirty}
                      onClick={openDiagnostic}
                    >
                      {saved.diagnostic.status === 'completed'
                        ? 'Try diagnostic again'
                        : 'Try optional diagnostic'}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-neutral-500 px-4 py-2 disabled:opacity-50"
                      disabled={pending || dirty}
                      onClick={() => finishDiagnostic('skip')}
                    >
                      Skip diagnostic
                    </button>
                  </div>
                )}
                {diagnostic && (
                  <fieldset disabled={pending || dirty} className="space-y-5">
                    <legend className="mb-2 font-semibold">{diagnostic.title}</legend>
                    <p>{diagnostic.description}</p>
                    {diagnostic.questions.map((question) => (
                      <fieldset key={question.id} className="min-w-0 space-y-2 rounded border p-3">
                        <legend className="max-w-full whitespace-pre-wrap break-words font-medium">
                          {question.prompt}
                        </legend>
                        {question.choices.map((choice) => (
                          <label key={choice.id} className="flex items-start gap-3 py-1">
                            <input
                              className="mt-1"
                              type="radio"
                              name={question.id}
                              value={choice.id}
                              checked={answers[question.id] === choice.id}
                              onChange={() =>
                                setAnswers((current) => ({ ...current, [question.id]: choice.id }))
                              }
                            />
                            <span className="whitespace-pre-wrap break-words">{choice.label}</span>
                          </label>
                        ))}
                        <label className="flex items-start gap-3 py-1">
                          <input
                            className="mt-1"
                            type="radio"
                            name={question.id}
                            checked={!answers[question.id]}
                            onChange={() => setAnswers((current) => ({ ...current, [question.id]: null }))}
                          />
                          <span>I don’t know yet</span>
                        </label>
                      </fieldset>
                    ))}
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={!Object.values(answers).some(Boolean)}
                        onClick={() => finishDiagnostic('complete')}
                      >
                        Save diagnostic answers
                      </button>
                      <button
                        type="button"
                        className="rounded border border-neutral-500 px-4 py-2"
                        onClick={() => finishDiagnostic('skip')}
                      >
                        Skip diagnostic
                      </button>
                    </div>
                  </fieldset>
                )}
              </>
            )}
          </section>
          <section className="space-y-2 rounded border p-4 sm:p-5">
            <h2 className="text-lg font-semibold">Keep studying</h2>
            <p>You can study your documents and review cards while your goals are saved.</p>
            <div className="flex flex-wrap gap-4">
              <a className="text-blue-800 underline" href="/dashboard">
                Open your library
              </a>
              <a className="text-blue-800 underline" href="/review">
                Review due cards
              </a>
            </div>
          </section>
          {saved && (
            <>
              <TrackPlanPanel
                key={saved.updated_at}
                getToken={getToken}
                onTrackChange={() => setTrackRevision((revision) => revision + 1)}
              />
              <LearningRecommendations
                key={saved.updated_at}
                getToken={getToken}
                planRevision={trackRevision}
              />
            </>
          )}
        </>
      )}
    </main>
  );
}
