'use client';

import { useAuth } from '@clerk/nextjs';
import type { CourseSummary, SessionResponse } from '@studyvault/types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { getCourseSessions, listCourses } from '@/lib/course-client';

export function CourseCatalog() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [sessions, setSessions] = useState<SessionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [catalog, saved] = await Promise.all([listCourses(getToken), getCourseSessions(getToken)]);
    setCourses(catalog.courses);
    setSessions(saved.sessions);
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let active = true;
    void refresh()
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load the course catalog.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn, refresh]);

  async function start(slug: string) {
    setWorking(slug);
    setError(null);
    window.location.assign(`/courses/${encodeURIComponent(slug)}`);
  }

  if (!isLoaded || loading) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-12" aria-busy="true">
        Loading your courses…
      </main>
    );
  }
  if (!isSignedIn) {
    return <main className="mx-auto max-w-6xl px-5 py-12">Sign in to open your guided courses.</main>;
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-8 max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-800">Guided learning</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">Learn one idea at a time</h1>
        <p className="mt-3 text-lg leading-7 text-slate-700">
          Read a short lesson, try a practice prompt, then prove what you can recall without hints. Your
          lesson and progress resume across devices.
        </p>
      </div>
      {error ? (
        <div role="alert" className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 text-red-900">
          {error}
        </div>
      ) : null}
      {loading ? <p>Loading saved courses…</p> : null}
      {courses.length === 0 ? (
        <p className="rounded-xl border bg-white p-6">There are no published courses yet.</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {courses.map((course) => {
            const session = sessions
              .filter((item) => item.course_slug === course.slug)
              .sort((left, right) => right.revision - left.revision)[0];
            const complete = session?.status === 'completed';
            return (
              <article
                key={course.release_id}
                className="flex min-h-64 flex-col rounded-2xl border bg-white p-6 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase text-emerald-900">
                    {course.size} course
                  </span>
                  <span className="text-sm text-slate-600">{course.estimated_minutes} min</span>
                </div>
                <h2 className="mt-4 text-2xl font-semibold text-slate-950">{course.title}</h2>
                <p className="mt-2 leading-6 text-slate-700">{course.description}</p>
                <p className="mt-4 text-sm text-slate-600">
                  {course.lesson_count} lessons · release {course.version}
                </p>
                {course.prerequisites.length ? (
                  <p className="mt-2 text-sm text-amber-900">
                    Prerequisite: {course.prerequisites.map((value) => value.replaceAll('-', ' ')).join(', ')}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-emerald-800">No prerequisite. Ready for beginners.</p>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
                  {session ? (
                    <Link
                      href={`/courses/${encodeURIComponent(course.slug)}?enrollment=${encodeURIComponent(session.id)}`}
                      className="rounded-lg bg-emerald-800 px-4 py-2.5 font-semibold text-white hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                    >
                      {complete ? 'Review course' : 'Resume course'}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled={working !== null}
                      onClick={() => void start(course.slug)}
                      className="rounded-lg bg-emerald-800 px-4 py-2.5 font-semibold text-white hover:bg-emerald-900 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                    >
                      {working === course.slug ? 'Opening…' : 'View course'}
                    </button>
                  )}
                  {session ? (
                    <span className="text-sm text-slate-600">
                      {session.completed_lesson_ids.length} of {session.lessons.length} lessons complete
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
