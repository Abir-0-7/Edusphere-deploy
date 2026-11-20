'use client';

import { useAuth } from '@clerk/nextjs';
import type {
  AdvanceRequest,
  Answer,
  AttemptRequest,
  AssistanceRequest,
  CourseDetail,
  DiagnosticResponse,
  Exercise,
  SessionResponse,
  StudyNotesRequest,
} from '@studyvault/types';
import {
  advanceCourse,
  enrollCourse,
  getCourseDiagnostic,
  getCourse,
  getCourseSession,
  requestCourseAssistance,
  saveCourseStudyNotes,
  streamCourseTutor,
  submitCourseAttempt,
  TutorOperationUncertainError,
} from '@/lib/course-client';
import Link from 'next/link';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { CourseProjectPanel } from '@/components/course-project-panel';
import { CourseUpgradePanel } from '@/components/course-upgrade-panel';
import { getPinnedCourse } from '@/lib/course-upgrade-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type PendingAction = { id: string; exerciseId: string; kind: 'attempt' | 'hint' | 'reveal'; answer?: Answer };

function Block({ type, language, content }: { type: string; language: string | null; content: string }) {
  if (type === 'code' || type === 'example') {
    return (
      <section className="my-4 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-slate-100">
        {language ? (
          <p className="border-b border-slate-700 px-4 py-2 text-xs text-slate-300">{language}</p>
        ) : null}
        <pre className="overflow-x-auto p-4 text-sm leading-6">
          <code>{content}</code>
        </pre>
      </section>
    );
  }
  return <MarkdownRenderer markdown={content} className="my-4 text-[1.05rem] leading-8" />;
}

export function CourseWorkspace({ slug, enrollmentId }: { slug: string; enrollmentId: string | null }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResponse | null>(null);
  const [diagnosticAnswers, setDiagnosticAnswers] = useState<Record<string, string>>({});
  const [chatQuestion, setChatQuestion] = useState('');
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [selectedChoices, setSelectedChoices] = useState<string[]>([]);
  const [notes, setNotes] = useState<StudyNotesRequest['notes']>([]);
  const [bookmarks, setBookmarks] = useState<StudyNotesRequest['bookmarks']>([]);
  const [dirtyProjects, setDirtyProjects] = useState<string[]>([]);
  const [savedMessage, setSavedMessage] = useState('');
  const [speechRate, setSpeechRate] = useState(1);
  const [autoContinueAfterNarration, setAutoContinueAfterNarration] = useState(false);
  const [speechStatus, setSpeechStatus] = useState('');
  const pendingAction = useRef<PendingAction | null>(null);
  const pendingChat = useRef<{ id: string; question: string; revision: number } | null>(null);
  const tutorAbort = useRef<AbortController | null>(null);
  const tutorQuestionInput = useRef<HTMLTextAreaElement | null>(null);
  const narrationRun = useRef(0);
  const autoContinueRef = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    autoContinueRef.current = autoContinueAfterNarration;
  }, [autoContinueAfterNarration]);

  function stopNarration() {
    narrationRun.current += 1;
    window.speechSynthesis?.cancel();
  }
  const getSession = useCallback(() => {
    if (!enrollmentId) return Promise.resolve(null);
    return getCourseSession(getToken, enrollmentId);
  }, [enrollmentId, getToken]);

  const refresh = useCallback(async () => {
    const [detail, current] = await Promise.all([
      enrollmentId ? getPinnedCourse(getToken, enrollmentId) : getCourse(getToken, slug),
      getSession(),
    ]);
    setCourse(detail);
    setSession(current);
    if (!current && detail.prerequisites.length && !detail.prerequisite_met) {
      setDiagnostic(await getCourseDiagnostic(getToken, slug));
    } else {
      setDiagnostic(null);
    }
    if (current) {
      setNotes(current.notes);
      setBookmarks(current.bookmarks);
      const available = current.remediation
        ? [current.remediation.exercise]
        : [...current.lesson.practice, ...(current.lesson.checkpoint ? [current.lesson.checkpoint] : [])];
      setSelectedExercise((old) => available.find((item) => item.id === old?.id) ?? available[0] ?? null);
    }
  }, [getSession, getToken, slug, enrollmentId]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let active = true;
    mounted.current = true;
    setLoading(true);
    void refresh()
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load this course.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      mounted.current = false;
      tutorAbort.current?.abort();
      stopNarration();
    };
  }, [isLoaded, isSignedIn, refresh]);

  useEffect(() => {
    setAnswerText('');
    setSelectedChoices([]);
  }, [selectedExercise?.id, session?.revision]);

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState !== 'visible') stopNarration();
    };
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden);
    };
  }, []);

  const activeAnswer: Answer | null = useMemo(() => {
    if (!selectedExercise) return null;
    if (selectedExercise.kind === 'choice') return selectedChoices[0] ?? null;
    if (selectedExercise.kind === 'number') {
      if (!answerText.trim()) return null;
      const parsed = Number(answerText);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return selectedChoices.length ? selectedChoices : null;
  }, [answerText, selectedChoices, selectedExercise]);

  async function runAction(kind: PendingAction['kind'], answer?: Answer) {
    if (!session || !selectedExercise || busy) return;
    setBusy(true);
    setError(null);
    setSavedMessage('');
    stopNarration();
    const prior = pendingAction.current;
    const action: PendingAction =
      prior?.exerciseId === selectedExercise.id &&
      prior.kind === kind &&
      JSON.stringify(prior.answer) === JSON.stringify(answer)
        ? prior
        : { id: crypto.randomUUID(), exerciseId: selectedExercise.id, kind, answer };
    pendingAction.current = action;
    const base = { id: action.id, revision: session.revision, exercise_id: selectedExercise.id };
    try {
      if (kind === 'attempt') {
        if (action.answer === undefined) throw new Error('Enter an answer first.');
        await submitCourseAttempt(getToken, session.id, { ...base, answer: action.answer } as AttemptRequest);
      } else {
        await requestCourseAssistance(getToken, session.id, { ...base, kind } as AssistanceRequest);
      }
      pendingAction.current = null;
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save that action. Retry to reuse its action ID.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function advance(autoNarrateNextLesson = false) {
    const current = session;
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    stopNarration();
    try {
      const next = await advanceCourse(getToken, current.id, {
        revision: current.revision,
      } satisfies AdvanceRequest);
      setSession(next);
      setNotes(next.notes);
      setBookmarks(next.bookmarks);
      setSelectedExercise(next.lesson.practice[0] ?? next.lesson.checkpoint);
      pendingAction.current = null;
      if (autoNarrateNextLesson && autoContinueRef.current) {
        const run = narrationRun.current;
        window.setTimeout(() => {
          if (run === narrationRun.current && autoContinueRef.current && mounted.current) speakLesson(next);
        }, 0);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not continue to the next lesson.');
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes() {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await saveCourseStudyNotes(getToken, session.id, {
        revision: session.revision,
        notes,
        bookmarks,
      });
      setSession(next);
      setSavedMessage('Notes and bookmarks saved to this course.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save notes.');
    } finally {
      setBusy(false);
    }
  }

  async function enroll(withDiagnostic: boolean) {
    if (!course || busy) return;
    setBusy(true);
    setError(null);
    try {
      const diagnostic_answers = withDiagnostic
        ? Object.fromEntries(
            Object.entries(diagnosticAnswers).map(([id, value]) => {
              const question = diagnostic?.questions.find((item) => item.id === id);
              return [id, question?.kind === 'number' ? Number(value) : value.trim().toLowerCase()];
            }),
          )
        : null;
      const created = await enrollCourse(getToken, course.slug, { diagnostic_answers });
      const url = new URL(window.location.href);
      url.searchParams.set('enrollment', created.id);
      window.location.assign(url.toString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not enroll.');
    } finally {
      setBusy(false);
    }
  }

  async function askTutor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || session.remediation?.step === 'checkpoint' || !chatQuestion.trim() || busy) return;
    const question = chatQuestion.trim();
    const previous = pendingChat.current;
    const action =
      previous?.question === question && previous.revision === session.revision
        ? previous
        : { id: crypto.randomUUID(), question, revision: session.revision };
    pendingChat.current = action;
    setBusy(true);
    setError(null);
    setSavedMessage('');
    stopNarration();
    try {
      const controller = new AbortController();
      tutorAbort.current?.abort();
      tutorAbort.current = controller;
      setStreamingAnswer('');
      await streamCourseTutor(
        getToken,
        session.id,
        { id: action.id, revision: session.revision, question },
        controller.signal,
        (token) => setStreamingAnswer((current) => current + token),
      );
      pendingChat.current = null;
      setChatQuestion('');
      setStreamingAnswer('');
      await refresh();
    } catch (cause) {
      if (mounted.current) setStreamingAnswer('');
      if (cause instanceof TutorOperationUncertainError) {
        try {
          const checked = await getCourseSession(getToken, session.id);
          if (!mounted.current) return;
          const saved = checked.conversation.some(
            (message) => message.role === 'user' && message.id === action.id && message.content === question,
          );
          setSession(checked);
          pendingChat.current = null;
          if (saved) {
            setChatQuestion('');
            setError(null);
            setSavedMessage('Your tutor answer was already saved. The conversation is up to date.');
          } else {
            setError('The interrupted response was not saved. Ask again to start a new response.');
          }
        } catch (checkError) {
          if (mounted.current) {
            setError(
              checkError instanceof Error
                ? `Could not check the saved conversation: ${checkError.message} Retry to check before starting again.`
                : 'Could not check the saved conversation. Retry to check before starting again.',
            );
          }
        }
        return;
      }
      if (mounted.current) {
        if (
          tutorAbort.current?.signal.aborted ||
          (cause instanceof DOMException && cause.name === 'AbortError')
        ) {
          setSavedMessage('Tutor response cancelled. The lesson and saved conversation are unchanged.');
        } else {
          setError(
            cause instanceof Error ? cause.message : 'Could not save the tutor question. Retry to reuse it.',
          );
        }
      }
    } finally {
      tutorAbort.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  function speakLesson(current: SessionResponse | null = session) {
    if (!current || !('speechSynthesis' in window)) {
      setError('Speech is unavailable here; the lesson text remains available.');
      return;
    }
    stopNarration();
    setSpeechStatus('');
    const run = narrationRun.current;
    const utterance = new SpeechSynthesisUtterance(
      current.lesson.blocks.map((block) => block.content).join('. '),
    );
    utterance.rate = speechRate;
    utterance.onend = () => {
      if (run !== narrationRun.current || !mounted.current || !autoContinueRef.current) return;
      if (!current.completed_lesson_ids.includes(current.lesson.id)) {
        setSpeechStatus('Auto-continue paused at the lesson question. Complete the checkpoint to continue.');
        return;
      }
      if (current.status === 'completed') {
        setSpeechStatus('Course complete. Your review cards are ready.');
        return;
      }
      setSpeechStatus('Lesson finished. Opening the next lesson.');
      void advance(true);
    };
    utterance.onerror = (event) => {
      if (run === narrationRun.current && event.error !== 'canceled') {
        setSpeechStatus('Audio stopped. The lesson text is still available.');
      }
    };
    window.speechSynthesis.speak(utterance);
  }

  function setChoice(id: string, multiple: boolean) {
    setSelectedChoices((current) =>
      multiple ? (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]) : [id],
    );
  }

  if (!isLoaded || loading) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-12" aria-busy="true">
        Loading lesson and saved progress…
      </main>
    );
  }
  if (!isSignedIn) {
    return <main className="mx-auto max-w-6xl px-5 py-12">Sign in to open this course.</main>;
  }
  if (!course) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-12">
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900">
          {error ?? 'Course not found.'}
        </p>
        <Link className="mt-5 inline-block underline" href="/courses">
          Back to courses
        </Link>
      </main>
    );
  }

  const completed = new Set(session?.completed_lesson_ids ?? []);
  const noteForLesson = notes.find((note) => note.lesson_id === session?.lesson.id);
  const hasUnsavedWork =
    session !== null &&
    (JSON.stringify(notes) !== JSON.stringify(session.notes) ||
      JSON.stringify(bookmarks) !== JSON.stringify(session.bookmarks) ||
      dirtyProjects.length > 0);
  const hasNextLesson = session
    ? session.lessons.findIndex((item) => item.id === session.lesson.id) < session.lessons.length - 1
    : false;
  const pendingProjects = session
    ? course.required_assignment_ids.filter((id) => session.assignment_status[id] !== 'submitted')
    : [];
  const activeEvidenceIds = new Set(session?.lesson.blocks.flatMap((block) => block.evidence_ids) ?? []);
  const lastTutorMessage = [...(session?.conversation ?? [])]
    .reverse()
    .find((message) => message.role === 'assistant');
  const tutorSuggestions = [
    { label: 'Explain simply', question: 'Explain this lesson in simpler terms.' },
    { label: 'Show a worked example', question: 'Walk me through an example from this lesson.' },
    ...(lastTutorMessage?.evidence_ids.some((id) => activeEvidenceIds.has(id))
      ? [{ label: 'Go deeper', question: 'Why does that matter?' }]
      : []),
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/courses" className="text-sm font-medium text-emerald-800 underline">
            All courses
          </Link>
          <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-emerald-800">
            {course.size} · release {course.version}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{course.title}</h1>
          <p className="mt-2 max-w-3xl leading-6 text-slate-700">{course.description}</p>
        </div>
        <Link
          href="/review"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 hover:bg-slate-50"
        >
          Open review queue
        </Link>
      </div>

      {error ? (
        <p role="alert" className="mb-5 rounded-lg border border-red-300 bg-red-50 p-3 text-red-900">
          {error}
        </p>
      ) : null}
      {savedMessage ? (
        <p role="status" className="mb-5 rounded-lg bg-emerald-50 p-3 text-emerald-900">
          {savedMessage}
        </p>
      ) : null}

      {session ? (
        <CourseUpgradePanel
          key={session.id}
          getToken={getToken}
          course={course}
          session={session}
          hasUnsavedWork={hasUnsavedWork || busy}
          onRefresh={refresh}
        />
      ) : null}
      {!session ? (
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Start this release</h2>
          <p className="mt-2 text-slate-700">
            Your progress will be saved to this account. Exercises are graded with fixed course answer keys.
          </p>
          {course.prerequisites.length && !course.prerequisite_met ? (
            <p className="mt-3 text-amber-900">
              Finish {course.prerequisites.join(', ')} first, or pass the optional prerequisite diagnostic.
            </p>
          ) : null}
          {diagnostic?.questions.length ? (
            <fieldset className="mt-5 space-y-4 rounded-xl border border-slate-200 p-4">
              <legend className="px-1 font-semibold">Optional prerequisite diagnostic</legend>
              <p className="text-sm leading-6 text-slate-700">
                Answer each question independently. Passing unlocks this course without marking the
                prerequisite course complete.
              </p>
              {diagnostic.questions.map((question) => (
                <label key={question.id} className="block text-sm font-medium text-slate-800">
                  {question.prompt}
                  <input
                    type={question.kind === 'number' ? 'number' : 'text'}
                    value={diagnosticAnswers[question.id] ?? ''}
                    onChange={(event) =>
                      setDiagnosticAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                    }
                    className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
                    required
                  />
                </label>
              ))}
              <button
                type="button"
                disabled={
                  busy || diagnostic.questions.some((question) => !diagnosticAnswers[question.id]?.trim())
                }
                onClick={() => void enroll(true)}
                className="rounded-lg bg-emerald-800 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
              >
                {busy ? 'Checking diagnostic…' : 'Submit and enroll'}
              </button>
            </fieldset>
          ) : null}
          {!course.prerequisites.length || course.prerequisite_met ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void enroll(false)}
              className="mt-5 rounded-lg bg-emerald-800 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Starting…' : 'Enroll and begin'}
            </button>
          ) : null}
        </section>
      ) : (
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-6">
            <section id="course-study" className="rounded-2xl border bg-white p-5 shadow-sm sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-600">
                    Lesson {session.lessons.findIndex((item) => item.id === session.lesson.id) + 1} of{' '}
                    {session.lessons.length}
                  </p>
                  <h2 className="mt-1 text-2xl font-bold text-slate-950">{session.lesson.title}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    id="speech-rate"
                    aria-label="Speech speed"
                    value={speechRate}
                    onChange={(event) => setSpeechRate(Number(event.target.value))}
                    className="rounded-lg border px-2 py-2 text-sm"
                  >
                    {[0.75, 1, 1.25, 1.5].map((rate) => (
                      <option key={rate} value={rate}>
                        {rate}×
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={autoContinueAfterNarration}
                      onChange={(event) => {
                        autoContinueRef.current = event.target.checked;
                        setAutoContinueAfterNarration(event.target.checked);
                      }}
                    />
                    Auto-continue after lesson audio
                  </label>
                  <button
                    type="button"
                    onClick={() => speakLesson()}
                    className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-slate-50"
                  >
                    Listen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      stopNarration();
                      setSpeechStatus('Audio stopped.');
                    }}
                    className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-slate-50"
                  >
                    Stop
                  </button>
                </div>
              </div>
              {speechStatus ? (
                <p role="status" className="mt-3 text-sm text-slate-700">
                  {speechStatus}
                </p>
              ) : null}
              <div className="mt-5 divide-y divide-slate-100">
                {session.adaptation?.variants.map((variant) => (
                  <aside
                    key={variant.objective_id}
                    className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4"
                    aria-label="Adapted example"
                  >
                    <p className="font-semibold">{variant.example_title}</p>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">
                      <code>{variant.example}</code>
                    </pre>
                    <p className="mt-2 text-sm text-slate-700">
                      {variant.depth_note} {variant.pace_note}
                    </p>
                  </aside>
                ))}
                {session.remediation?.step === 'bridge' ? (
                  <aside
                    className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4"
                    aria-label="Remediation"
                  >
                    <p className="font-semibold">{session.remediation.title}</p>
                    <p className="mt-2 whitespace-pre-wrap text-slate-800">
                      {session.remediation.explanation}
                    </p>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">
                      <code>{session.remediation.worked_example}</code>
                    </pre>
                    <details className="mt-2 text-sm text-slate-700">
                      <summary className="cursor-pointer font-medium">Lesson sources</summary>
                      <ul className="mt-2 space-y-2">
                        {session.evidence
                          .filter((item) => session.remediation?.evidence_ids.includes(item.id))
                          .map((item) => (
                            <li key={item.id}>
                              <strong>{item.locator}</strong> {item.quote}
                            </li>
                          ))}
                      </ul>
                    </details>
                  </aside>
                ) : null}
                {session.lesson.blocks.map((block) => (
                  <Block key={block.id} type={block.type} language={block.language} content={block.content} />
                ))}
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                {session.lesson.practice.map((exercise) => (
                  <button
                    key={exercise.id}
                    type="button"
                    onClick={() => setSelectedExercise(exercise)}
                    aria-pressed={selectedExercise?.id === exercise.id}
                    className="rounded-full border px-3 py-1.5 text-sm aria-pressed:border-emerald-800 aria-pressed:bg-emerald-50 aria-pressed:text-emerald-950"
                  >
                    Practice
                  </button>
                ))}
                {session.lesson.checkpoint ? (
                  <button
                    type="button"
                    onClick={() => setSelectedExercise(session.lesson.checkpoint)}
                    aria-pressed={selectedExercise?.id === session.lesson.checkpoint.id}
                    className="rounded-full border px-3 py-1.5 text-sm aria-pressed:border-emerald-800 aria-pressed:bg-emerald-50 aria-pressed:text-emerald-950"
                  >
                    Independent checkpoint
                  </button>
                ) : null}
              </div>
            </section>

            <CourseProjectPanel
              course={course}
              session={session}
              getToken={getToken}
              onUpdated={refresh}
              onDirtyChange={(assignmentId, dirty) =>
                setDirtyProjects((current) =>
                  dirty
                    ? current.includes(assignmentId)
                      ? current
                      : [...current, assignmentId]
                    : current.filter((id) => id !== assignmentId),
                )
              }
            />

            {selectedExercise && !completed.has(session.lesson.id) ? (
              <section
                aria-labelledby="exercise-title"
                className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 sm:p-7"
              >
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-900">
                  {session.remediation?.step === 'bridge'
                    ? 'Bridge practice'
                    : session.remediation?.step === 'checkpoint'
                      ? 'Fresh independent checkpoint'
                      : selectedExercise.mode === 'checkpoint'
                        ? 'Check your recall'
                        : 'Practice'}
                </p>
                <h2 id="exercise-title" className="mt-2 text-xl font-semibold leading-7 text-slate-950">
                  {selectedExercise.prompt}
                </h2>
                {selectedExercise.choices.length ? (
                  <fieldset className="mt-4 space-y-2">
                    <legend className="sr-only">Choose your answer</legend>
                    {selectedExercise.choices.map((choice) => {
                      const multiple =
                        selectedExercise.kind === 'multiple' || selectedExercise.kind === 'ordered';
                      const checked = selectedChoices.includes(choice.id);
                      return (
                        <label
                          key={choice.id}
                          className="flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-3 hover:border-emerald-600"
                        >
                          <input
                            type={multiple ? 'checkbox' : 'radio'}
                            name="course-answer"
                            value={choice.id}
                            checked={checked}
                            onChange={() => setChoice(choice.id, multiple)}
                          />
                          <span>{choice.label}</span>
                          {selectedExercise.kind === 'ordered' && checked ? (
                            <span className="ml-auto text-sm text-slate-500">
                              #{selectedChoices.indexOf(choice.id) + 1}
                            </span>
                          ) : null}
                        </label>
                      );
                    })}
                  </fieldset>
                ) : (
                  <label className="mt-4 block max-w-md text-sm font-medium text-slate-800">
                    Your answer
                    <input
                      type={selectedExercise.kind === 'number' ? 'number' : 'text'}
                      value={answerText}
                      onChange={(event) => setAnswerText(event.target.value)}
                      className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
                    />
                  </label>
                )}
                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || activeAnswer === null}
                    onClick={() => void runAction('attempt', activeAnswer ?? undefined)}
                    className="rounded-lg bg-slate-950 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
                  >
                    {busy ? 'Checking…' : 'Check answer'}
                  </button>
                  {session.remediation ? null : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runAction('hint')}
                        className="rounded-lg border border-slate-400 bg-white px-4 py-2.5 font-medium text-slate-900 disabled:opacity-50"
                      >
                        Hint
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runAction('reveal')}
                        className="rounded-lg border border-slate-400 bg-white px-4 py-2.5 font-medium text-slate-900 disabled:opacity-50"
                      >
                        Reveal
                      </button>
                    </>
                  )}
                </div>
                {session.last_action ? (
                  <p
                    className="mt-4 rounded-lg bg-white p-3 leading-6 text-slate-800"
                    role="status"
                    aria-live="polite"
                  >
                    {session.last_action.message}
                  </p>
                ) : null}
              </section>
            ) : null}

            {completed.has(session.lesson.id) ? (
              <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5">
                <h2 className="text-xl font-semibold text-emerald-950">Checkpoint complete</h2>
                <p className="mt-2 leading-6 text-emerald-950">
                  You passed an independent recall check. A source-linked card is ready in your review queue.
                </p>
                <Link className="mt-3 inline-block font-semibold text-emerald-950 underline" href="/review">
                  Open flashcard review
                </Link>
                {hasNextLesson ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void advance()}
                    className="ml-4 rounded-lg bg-emerald-800 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
                  >
                    Continue to next lesson
                  </button>
                ) : session.status === 'completed' ? (
                  <p className="mt-4 font-semibold">
                    {course.required_assignment_ids.length
                      ? 'Learning activities complete. Your capstone submission remains ungraded; no code was executed.'
                      : 'Course complete. You can revisit this lesson or review your cards.'}
                  </p>
                ) : pendingProjects.length ? (
                  <p className="mt-4 font-semibold">
                    Lesson checkpoints complete. Submit the required capstone project to finish the learning
                    activities. Submission is not a rubric pass.
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="rounded-2xl border bg-white p-5 sm:p-7" aria-labelledby="course-tutor-title">
              <h2 id="course-tutor-title" className="text-xl font-semibold">
                Ask the course tutor
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {session.remediation?.step === 'checkpoint'
                  ? 'Tutor questions resume after you finish the fresh checkpoint on your own.'
                  : "Answers use this course's lesson sources. If the sources do not support an answer, the tutor will say so."}
              </p>
              <ol className="mt-4 space-y-4" aria-label="Course tutor conversation" aria-live="polite">
                {session.conversation.map((message) => (
                  <li
                    key={message.id}
                    className={`rounded-xl p-4 ${message.role === 'user' ? 'bg-slate-100' : 'bg-emerald-50'}`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {message.role === 'user' ? 'You asked' : 'Tutor'}
                    </p>
                    {message.role === 'assistant' ? (
                      <MarkdownRenderer markdown={message.content} className="mt-1 leading-6" />
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap leading-6">{message.content}</p>
                    )}
                    {message.role === 'assistant' && message.evidence_ids.length ? (
                      <details className="mt-3 text-sm">
                        <summary className="cursor-pointer font-medium text-emerald-900">
                          Sources used
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {message.evidence_ids.map((id) => {
                            const source = course.evidence.find((item) => item.id === id);
                            return (
                              <li key={id} className="rounded-lg bg-white p-3">
                                <strong>{source?.locator ?? 'Course source'}:</strong>{' '}
                                {source?.quote ?? 'This source is part of the course release.'}
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    ) : null}
                  </li>
                ))}
                {streamingAnswer ? (
                  <li className="rounded-xl bg-blue-50 p-4" role="status" aria-live="polite">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Tutor response in progress
                    </p>
                    <MarkdownRenderer markdown={streamingAnswer} className="mt-1 leading-6" />
                  </li>
                ) : null}
              </ol>
              <form onSubmit={(event) => void askTutor(event)} className="mt-4">
                <div className="mb-4" role="group" aria-label="Tutor question suggestions">
                  <p id="course-tutor-suggestions-help" className="text-sm leading-6 text-slate-600">
                    Suggestions fill an empty draft. Edit your question before choosing Ask tutor.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {tutorSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.question}
                        type="button"
                        disabled={busy || session.remediation?.step === 'checkpoint' || !!chatQuestion.trim()}
                        aria-describedby="course-tutor-suggestions-help"
                        onClick={() => {
                          setChatQuestion(suggestion.question);
                          tutorQuestionInput.current?.focus();
                        }}
                        className="rounded-full border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        {suggestion.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label htmlFor="course-tutor-question" className="block text-sm font-medium">
                  Your question
                </label>
                <textarea
                  id="course-tutor-question"
                  ref={tutorQuestionInput}
                  rows={3}
                  maxLength={2000}
                  required
                  disabled={busy || session.remediation?.step === 'checkpoint'}
                  value={chatQuestion}
                  onChange={(event) => setChatQuestion(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 p-3"
                  placeholder="Ask about the current lesson…"
                />
                <button
                  type="submit"
                  disabled={busy || session.remediation?.step === 'checkpoint' || !chatQuestion.trim()}
                  className="mt-3 rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'Asking…' : 'Ask tutor'}
                </button>
                {busy && tutorAbort.current ? (
                  <button
                    type="button"
                    onClick={() => tutorAbort.current?.abort()}
                    className="ml-2 mt-3 rounded-lg border border-slate-400 px-4 py-2 font-semibold text-slate-900"
                  >
                    Stop response
                  </button>
                ) : null}
              </form>
            </section>

            <section className="rounded-2xl border bg-white p-5 sm:p-7">
              <h2 className="text-xl font-semibold">My notes and bookmarks</h2>
              <label className="mt-4 block text-sm font-medium">
                Lesson note
                <textarea
                  rows={4}
                  maxLength={5000}
                  value={noteForLesson?.text ?? ''}
                  onChange={(event) => {
                    const text = event.target.value;
                    setNotes((current) => {
                      const rest = current.filter((note) => note.lesson_id !== session.lesson.id);
                      return text
                        ? [
                            ...rest,
                            {
                              id: noteForLesson?.id ?? crypto.randomUUID(),
                              lesson_id: session.lesson.id,
                              text,
                            },
                          ]
                        : rest;
                    });
                  }}
                  className="mt-1 block w-full rounded-lg border border-slate-300 p-3"
                />
              </label>
              <div className="mt-4 space-y-2">
                {session.evidence.map((item) => {
                  const active = bookmarks.some(
                    (entry) => entry.lesson_id === session.lesson.id && entry.evidence_id === item.id,
                  );
                  return (
                    <label key={item.id} className="flex items-start gap-3 rounded-lg border p-3">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() =>
                          setBookmarks((current) =>
                            active
                              ? current.filter(
                                  (entry) =>
                                    !(entry.lesson_id === session.lesson.id && entry.evidence_id === item.id),
                                )
                              : [...current, { lesson_id: session.lesson.id, evidence_id: item.id }],
                          )
                        }
                      />
                      <span className="text-sm leading-6">
                        <strong>{item.locator}:</strong> “{item.quote}”
                      </span>
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveNotes()}
                className="mt-4 rounded-lg border border-emerald-800 px-4 py-2 font-semibold text-emerald-950 disabled:opacity-50"
              >
                Save notes and bookmarks
              </button>
            </section>
          </div>

          <aside className="min-w-0 space-y-5 lg:sticky lg:top-6">
            <section className="rounded-2xl border bg-white p-5">
              <h2 className="font-semibold">Course outline</h2>
              {course.size === 'full' ? (
                <ol className="mt-3 space-y-3 border-b pb-4" aria-label="Module progress">
                  {course.modules.map((module, index) => {
                    const count = module.lesson_ids.filter((id) => completed.has(id)).length;
                    return (
                      <li key={module.id} className="text-sm leading-6">
                        <p className="font-semibold">
                          Module {index + 1}: {module.title}
                        </p>
                        <p>
                          {count}/{module.lesson_ids.length} lesson checkpoints complete
                        </p>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
              <ol className="mt-3 space-y-3">
                {session.lessons.map((lesson, index) => (
                  <li key={lesson.id} className="flex gap-3 text-sm">
                    <span
                      aria-label={
                        lesson.completed
                          ? 'Completed'
                          : lesson.id === session.lesson.id
                            ? 'Current lesson'
                            : 'Not started'
                      }
                      className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold ${lesson.completed ? 'border-emerald-700 bg-emerald-700 text-white' : lesson.id === session.lesson.id ? 'border-emerald-700 text-emerald-900' : 'text-slate-500'}`}
                    >
                      {lesson.completed ? '✓' : index + 1}
                    </span>
                    <span
                      className={
                        lesson.id === session.lesson.id ? 'font-semibold text-slate-950' : 'text-slate-700'
                      }
                    >
                      {lesson.title}
                    </span>
                  </li>
                ))}
              </ol>
              <div
                className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100"
                aria-label="Course progress"
                role="progressbar"
                aria-valuenow={session.completed_lesson_ids.length}
                aria-valuemin={0}
                aria-valuemax={session.lessons.length}
              >
                <div
                  className="h-full bg-emerald-700"
                  style={{
                    width: `${(session.completed_lesson_ids.length / session.lessons.length) * 100}%`,
                  }}
                />
              </div>
            </section>
            <section className="rounded-2xl border bg-white p-5">
              <h2 className="font-semibold">Source references</h2>
              <ul className="mt-3 space-y-2">
                {course.reference_urls.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-words text-sm text-emerald-900 underline"
                    >
                      {new URL(url).hostname}
                    </a>
                  </li>
                ))}
              </ul>
              {session.evidence[0] ? (
                <Link
                  href={`/document/${session.document_id}`}
                  className="mt-4 inline-block text-sm font-medium text-emerald-900 underline"
                >
                  Open this course in your library
                </Link>
              ) : null}
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}
