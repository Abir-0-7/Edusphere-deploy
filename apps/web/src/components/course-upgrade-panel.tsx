'use client';

import { useEffect, useRef, useState } from 'react';
import type { CourseDetail, CourseUpgradePreview, SessionResponse } from '@studyvault/types';
import { getCourse } from '@/lib/course-client';
import { acceptCourseUpgrade, previewCourseUpgrade } from '@/lib/course-upgrade-client';
import { AiHttpError, type GetToken } from '@/lib/ai-client';

const button =
  'rounded-lg border border-emerald-800 bg-white px-3 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50';
const resetReason = {
  new_lesson: 'New lesson',
  changed_teaching_or_assessment: 'Lesson material or checkpoint changed',
  changed_prerequisite: 'A prerequisite changed',
  not_completed: 'No completed checkpoint on the old release',
  invalid_prior_checkpoint: 'Prior checkpoint could not be matched',
} as const;

export function CourseUpgradePanel({
  getToken,
  course,
  session,
  hasUnsavedWork,
  onRefresh,
}: {
  getToken: GetToken;
  course: CourseDetail;
  session: SessionResponse;
  hasUnsavedWork: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [latest, setLatest] = useState<CourseDetail | null>(null);
  const [preview, setPreview] = useState<CourseUpgradePreview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState('');
  const [previousId, setPreviousId] = useState('');
  const action = useRef<{ hash: string; id: string } | null>(null);
  const current =
    preview?.from_revision === session.revision &&
    preview.from_enrollment_id === session.id &&
    preview.from_release_id === session.release_id &&
    preview.target_release_id === latest?.release_id
      ? preview
      : null;
  const acceptedCurrent = accepted && !hasUnsavedWork;

  useEffect(() => {
    let valid = true;
    void getCourse(getToken, course.slug)
      .then((value) => {
        if (valid) setLatest(value);
      })
      .catch((cause: unknown) => {
        if (valid)
          setError(cause instanceof Error ? cause.message : 'Could not check available course releases.');
      });
    const previous = new URL(window.location.href).searchParams.get('previous_enrollment');
    if (previous && /^[0-9a-f-]{36}$/i.test(previous) && previous !== session.id) setPreviousId(previous);
    return () => {
      valid = false;
    };
  }, [getToken, course.slug, session.id]);

  async function inspect() {
    if (!latest || busy) return;
    setBusy(true);
    setError('');
    setAccepted(false);
    setPreview(null);
    try {
      const target = await getCourse(getToken, course.slug);
      setLatest(target);
      if (target.release_id !== session.release_id)
        setPreview(await previewCourseUpgrade(getToken, session.id, target.release_id));
    } catch (cause) {
      if (cause instanceof AiHttpError && cause.status === 404) setUnavailable(true);
      else setError(cause instanceof Error ? cause.message : 'Could not preview this course upgrade.');
    } finally {
      setBusy(false);
    }
  }

  if (!error && (!latest || latest.release_id === session.release_id) && !previousId) return null;
  return (
    <section
      className="mb-5 min-w-0 rounded-xl border border-amber-300 bg-amber-50 p-4"
      aria-label="Course release upgrade"
    >
      <p className="font-semibold">
        This enrollment stays on release {course.version} until you accept an upgrade.
      </p>
      {previousId ? (
        <a
          className="mt-2 inline-block text-sm font-semibold underline"
          href={`/courses/${encodeURIComponent(course.slug)}?enrollment=${encodeURIComponent(previousId)}`}
        >
          Open previous enrollment and history
        </a>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-900" role="alert">
          {error} Your current enrollment is unchanged.
        </p>
      ) : null}
      {latest && latest.release_id !== session.release_id ? (
        <>
          <p className="mt-2 text-sm">
            Release {latest.version} is available. Saved lesson content, source references and projects below
            are still from your pinned release.
          </p>
          {unavailable ? (
            <p className="mt-2 text-sm">Release upgrades are not available in this environment yet.</p>
          ) : (
            <button type="button" disabled={busy} onClick={() => void inspect()} className={`${button} mt-3`}>
              Preview course upgrade
            </button>
          )}
        </>
      ) : null}
      {error && !latest ? (
        <button
          type="button"
          className={`${button} mt-3`}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void getCourse(getToken, course.slug)
              .then(setLatest)
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : 'Could not check course releases.'),
              )
              .finally(() => setBusy(false));
          }}
        >
          Retry checking releases
        </button>
      ) : null}
      {current ? (
        <div
          className="mt-4 space-y-3 rounded-lg border bg-white p-3"
          role="region"
          aria-label="Course upgrade impact"
        >
          <p className="font-semibold">
            Release {current.from_version} → {current.target_version}
          </p>
          <p className="break-all text-xs">
            Target release: {current.target_release_id}
            <br />
            SHA-256: {current.target_content_hash}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              {current.retained_lesson_ids.length} unchanged completed lesson checkpoints retained;{' '}
              {current.reset_lesson_ids.length} lessons require fresh checks.
            </li>
            <li>
              {current.retained_objective_ids.length} demonstrated objectives retained under the upgrade
              policy.
            </li>
            <li>
              {current.retained_note_count} saved notes and {current.retained_bookmark_count} compatible
              bookmarks copied.
            </li>
            <li>
              Old project submissions stay in the old enrollment; copies in the new enrollment are drafts.
            </li>
            <li>
              Old cards, review schedules and attempt history remain attached to the old course material.
            </li>
          </ul>
          {current.warnings.map((warning) => (
            <p key={warning} className="text-sm text-amber-950">
              {warning}
            </p>
          ))}
          {current.reset_reasons.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">
                Which lessons require a new checkpoint?
              </summary>
              <ul className="mt-2 space-y-1">
                {current.reset_reasons.map((entry) => {
                  const lessonIndex =
                    latest?.modules.flatMap((module) => module.lesson_ids).indexOf(entry.lesson_id) ?? -1;
                  return (
                    <li key={entry.lesson_id}>
                      {latest?.lesson_titles[lessonIndex] ?? entry.lesson_id}: {resetReason[entry.reason]}
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
          <a href="#course-study" className="inline-block text-sm font-semibold underline">
            Keep studying this pinned enrollment
          </a>
          {hasUnsavedWork ? (
            <p className="text-sm font-medium text-amber-950">
              Save your notes, bookmarks and project edits before accepting an upgrade.
            </p>
          ) : null}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={acceptedCurrent}
              disabled={busy || hasUnsavedWork}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            I accept these changes in a new enrollment. Keep my old enrollment and history available.
          </label>
          <button
            type="button"
            disabled={busy || !acceptedCurrent}
            className={button}
            onClick={() => {
              if (!acceptedCurrent || !current) return;
              if (action.current?.hash !== current.preview_hash)
                action.current = { hash: current.preview_hash, id: crypto.randomUUID() };
              setBusy(true);
              setError('');
              void acceptCourseUpgrade(getToken, action.current.id, current)
                .then((result) => {
                  window.location.assign(
                    `/courses/${encodeURIComponent(course.slug)}?enrollment=${encodeURIComponent(result.session.id)}&previous_enrollment=${encodeURIComponent(session.id)}`,
                  );
                })
                .catch(async (cause: unknown) => {
                  setError(
                    cause instanceof AiHttpError && cause.status === 409
                      ? `${cause.message} Refresh the preview before accepting again.`
                      : cause instanceof Error
                        ? cause.message
                        : 'Could not accept this upgrade. Retry to reuse the action ID.',
                  );
                  if (cause instanceof AiHttpError && cause.status === 409) {
                    setPreview(null);
                    setAccepted(false);
                    try {
                      await onRefresh();
                    } catch (refreshError) {
                      setError(
                        refreshError instanceof Error
                          ? refreshError.message
                          : 'Reload to check saved enrollment progress.',
                      );
                    }
                  }
                })
                .finally(() => setBusy(false));
            }}
          >
            Accept upgrade and open new enrollment
          </button>
        </div>
      ) : preview ? (
        <p className="mt-2 text-sm">Your progress changed. Preview again before accepting an upgrade.</p>
      ) : null}
    </section>
  );
}
