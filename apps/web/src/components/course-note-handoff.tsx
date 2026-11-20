'use client';

import { useEffect, useRef, useState } from 'react';
import type { SessionResponse, StudyNotesRequest } from '@studyvault/types';
import type { GetToken } from '@/lib/ai-client';
import { getCourseSession, getCourseSessions, saveCourseStudyNotes } from '@/lib/course-client';

type Props = { getToken: GetToken; text: string; ownerId?: string };
type PreparedNote = {
  key: string;
  enrollmentId: string;
  noteId: string;
  text: string;
  body: StudyNotesRequest;
};

/** Parents without an explicit owner must remount this component when accounts change. */
export function CourseNoteHandoff(props: Props) {
  return <OwnedCourseNoteHandoff key={props.ownerId ?? 'parent-account'} {...props} />;
}

function OwnedCourseNoteHandoff({ getToken, text }: Props) {
  const [courses, setCourses] = useState<SessionResponse[] | null>(null);
  const [courseId, setCourseId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ session: SessionResponse; sourceText: string } | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const prepared = useRef<PreparedNote | null>(null);
  const choice = courses?.find((course) => course.id === courseId);
  const currentSaved = saved?.sourceText === text ? saved.session : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function pinnedToken() {
    const token = await getToken();
    if (!mounted.current) throw new Error('The selected account is no longer active.');
    return async () => {
      if (!mounted.current) throw new Error('The selected account is no longer active.');
      return token;
    };
  }

  async function load() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const token = await pinnedToken();
      const result = await getCourseSessions(token);
      if (mounted.current) setCourses(result.sessions);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not load your courses.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function save() {
    if (!choice || !lessonId || !text.trim() || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const submittedText = text;
    const key = JSON.stringify([choice.id, lessonId, submittedText]);
    try {
      const token = await pinnedToken();
      const course = await getCourseSession(token, choice.id);
      if (!mounted.current) return;
      const previous = prepared.current;
      // Reconcile a dropped response before retrying the exact same note.
      if (
        previous?.key === key &&
        course.notes.some((note) => note.id === previous.noteId && note.text === previous.text)
      ) {
        setSaved({ session: course, sourceText: submittedText });
        return;
      }
      if (!course.lessons.some((lesson) => lesson.id === lessonId))
        throw new Error('This lesson is no longer in the selected course release.');
      if (previous?.key !== key) {
        const existing = course.notes.find((note) => note.lesson_id === lessonId);
        const value = existing?.text ? `${existing.text}\n\n${submittedText.trim()}` : submittedText.trim();
        if (Array.from(value).length > 5000)
          throw new Error(
            'The combined lesson note exceeds 5,000 characters. Choose a different lesson or shorten the text.',
          );
        const note = { id: existing?.id ?? crypto.randomUUID(), lesson_id: lessonId, text: value };
        const notes = existing
          ? course.notes.map((entry) => (entry.id === existing.id ? note : entry))
          : [...course.notes, note];
        prepared.current = {
          key,
          enrollmentId: course.id,
          noteId: note.id,
          text: value,
          body: { revision: course.revision, notes, bookmarks: course.bookmarks },
        };
      }
      const attempt = prepared.current!;
      if (attempt.body.revision !== course.revision) {
        prepared.current = null;
        throw new Error(
          'Course notes changed while saving. Review the course notes, then retry to add your text.',
        );
      }
      const result = await saveCourseStudyNotes(token, attempt.enrollmentId, attempt.body);
      if (mounted.current) setSaved({ session: result, sourceText: submittedText });
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'Could not save the lesson note.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const field = 'mt-1 block w-full rounded border border-slate-500 p-2 text-sm';
  const button =
    'rounded border border-blue-700 px-3 py-2 text-sm font-semibold text-blue-800 disabled:opacity-50';
  return (
    <div className="space-y-2">
      {courses === null ? (
        <button type="button" className={button} disabled={busy} onClick={() => void load()}>
          Choose a course note
        </button>
      ) : null}
      {courses?.length === 0 ? <p className="text-sm">Enroll in a course to save a lesson note.</p> : null}
      {courses && courses.length > 0 && !currentSaved ? (
        <>
          <label className="block text-sm">
            Course enrollment
            <select
              className={field}
              value={courseId}
              disabled={busy}
              onChange={(event) => {
                const id = event.target.value;
                setCourseId(id);
                setLessonId(courses.find((course) => course.id === id)?.lesson.id ?? '');
              }}
            >
              <option value="">Choose a course</option>
              {courses.map((course) => (
                <option value={course.id} key={course.id}>
                  {course.course_title} · {course.lesson.title} · {course.release_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          {choice ? (
            <label className="block text-sm">
              Lesson
              <select
                className={field}
                value={lessonId}
                disabled={busy}
                onChange={(event) => setLessonId(event.target.value)}
              >
                {choice.lessons.map((lesson) => (
                  <option value={lesson.id} key={lesson.id}>
                    {lesson.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className={button}
            disabled={busy || !lessonId || !text.trim()}
            onClick={() => void save()}
          >
            Add to lesson notes
          </button>
        </>
      ) : null}
      {currentSaved ? (
        <p role="status" className="text-sm">
          Note saved.{' '}
          <a
            className="underline"
            href={`/courses/${encodeURIComponent(currentSaved.course_slug)}?enrollment=${encodeURIComponent(currentSaved.id)}`}
          >
            Open course
          </a>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  );
}
