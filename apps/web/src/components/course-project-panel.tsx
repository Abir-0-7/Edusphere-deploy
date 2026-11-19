'use client';

import dynamic from 'next/dynamic';
import type { CodeChallengeGrade, CourseAssignment, CourseDetail, SessionResponse } from '@studyvault/types';
import { runCourseCodeChallenge, runCourseLab, saveCourseAssignment } from '@/lib/course-client';
import type { GetToken } from '@/lib/ai-client';
import { useEffect, useMemo, useState } from 'react';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <textarea aria-label="Code editor" rows={12} readOnly value="Loading editor…" />,
});

function AssignmentCard({
  assignment,
  session,
  getToken,
  onUpdated,
}: {
  assignment: CourseAssignment;
  session: SessionResponse;
  getToken: GetToken;
  onUpdated: () => Promise<void>;
}) {
  const [text, setText] = useState(session.assignment_drafts[assignment.id] ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const status = session.assignment_status[assignment.id] ?? 'draft';

  useEffect(() => {
    setText(session.assignment_drafts[assignment.id] ?? '');
  }, [assignment.id, session.assignment_drafts]);

  async function save(action: 'save' | 'submit') {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await saveCourseAssignment(getToken, session.id, {
        id: crypto.randomUUID(),
        revision: session.revision,
        assignment_id: assignment.id,
        action,
        text,
      });
      await onUpdated();
      setMessage(
        result.status === 'submitted'
          ? 'Assignment marked submitted in your account.'
          : 'Assignment draft saved.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this assignment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-widest text-violet-900">Independent project</p>
      <h2 className="mt-2 text-xl font-semibold text-slate-950">{assignment.title}</h2>
      <p className="mt-3 leading-7 text-slate-800">{assignment.prompt}</p>
      <p className="mt-3 text-sm text-slate-700">{assignment.deliverable}</p>
      <h3 className="mt-4 font-semibold">Self-review rubric</h3>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-sm leading-6 text-slate-700">
        {assignment.rubric.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <label
        className="mt-5 block text-sm font-medium text-slate-900"
        htmlFor={`assignment-${assignment.id}`}
      >
        Your work
      </label>
      <textarea
        id={`assignment-${assignment.id}`}
        rows={9}
        maxLength={5000}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-sm leading-6"
        placeholder="Write your SQL/command sequence and explanation here."
      />
      <p className="mt-1 text-right text-xs text-slate-600">
        {text.length}/5000 characters · {status}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save('save')}
          className="rounded-lg border border-violet-800 bg-white px-4 py-2.5 font-semibold text-violet-950 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          disabled={busy || text.trim().length < 80}
          onClick={() => void save('submit')}
          className="rounded-lg bg-violet-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          Submit assignment
        </button>
      </div>
      {message ? (
        <p role="status" className="mt-3 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-900">
          {error}
        </p>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-slate-600">
        Your submission stays in this account for self-review; it is not sent to an instructor, automatically
        graded, or counted as mastery or XP.
      </p>
    </article>
  );
}

export function CourseProjectPanel({
  course,
  session,
  getToken,
  onUpdated,
}: {
  course: CourseDetail;
  session: SessionResponse;
  getToken: GetToken;
  onUpdated: () => Promise<void>;
}) {
  const labs = course.labs;
  const [selectedLabId, setSelectedLabId] = useState(labs[0]?.id ?? '');
  const lab = labs.find((item) => item.id === selectedLabId) ?? labs[0];
  const initialTask = lab?.tasks[0]?.id ?? '';
  const [taskId, setTaskId] = useState(initialTask);
  const [text, setText] = useState(lab?.starter ?? '');
  const [language, setLanguage] = useState<'python' | 'javascript'>('python');
  const [codingGrade, setCodingGrade] = useState<CodeChallengeGrade | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const transcript = useMemo(
    () => (lab ? (session.lab_transcripts[lab.id] ?? []) : []),
    [lab, session.lab_transcripts],
  );
  const progress = lab ? (session.lab_progress[lab.id] ?? 0) : 0;
  const selectedTask = lab?.tasks.find((task) => task.id === taskId) ?? null;

  useEffect(() => {
    if (!lab) return;
    setTaskId(lab.tasks[Math.min(progress, lab.tasks.length - 1)]?.id ?? '');
  }, [lab?.id, progress]);

  useEffect(() => {
    if (!lab) return;
    setText(lab.starter);
    setCodingGrade(null);
    setMessage('');
    setError('');
  }, [lab?.id, lab?.starter]);

  useEffect(() => {
    const languageStarter =
      language === 'javascript'
        ? (selectedTask?.starter_javascript ?? selectedTask?.starter)
        : selectedTask?.starter;
    if (languageStarter !== undefined) setText(languageStarter ?? '');
    setCodingGrade(null);
  }, [taskId, lab?.id, language]);

  async function runLab() {
    if (!lab || !text.trim() || busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (lab.kind === 'code_editor') {
        if (!selectedTask?.runner_problem_id) throw new Error('This coding task is not configured.');
        const grade = await runCourseCodeChallenge({
          problemId: selectedTask.runner_problem_id,
          language,
          source: text,
          courseContext: { enrollmentId: session.id, labId: lab.id, taskId: selectedTask.id },
        });
        setCodingGrade(grade);
        if (grade.passed !== grade.total) {
          setMessage(`${grade.passed}/${grade.total} fixed tests passed. Review the output and try again.`);
          return;
        }
        if (!grade.courseReceipt)
          throw new Error(
            'Course progress could not be recorded. Check the runner configuration and try again.',
          );
        const recorded = await runCourseLab(getToken, session.id, {
          id: crypto.randomUUID(),
          revision: session.revision,
          lab_id: lab.id,
          task_id: selectedTask.id,
          text,
          runner_receipt: grade.courseReceipt,
          runner_problem_id: selectedTask.runner_problem_id,
          runner_language: language,
        });
        await onUpdated();
        setMessage(
          recorded.complete
            ? 'All coding lab tasks completed. Practice does not award mastery or XP.'
            : 'All tests passed and the practice task was saved. Try the next task.',
        );
        return;
      }
      const result = await runCourseLab(getToken, session.id, {
        id: crypto.randomUUID(),
        revision: session.revision,
        lab_id: lab.id,
        ...(lab.kind === 'sql_query' ? { task_id: taskId } : {}),
        text,
      });
      await onUpdated();
      if (lab.kind === 'sql_query' && result.accepted && !result.complete) setText('');
      setMessage(
        result.accepted
          ? result.complete
            ? 'All lab tasks completed. This is practice evidence only.'
            : 'Accepted. Try the next authored task.'
          : 'Not accepted yet. Read the feedback and try again.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not run this lab action.');
    } finally {
      setBusy(false);
    }
  }

  if (!lab && !course.assignments.length) return null;

  return (
    <section className="space-y-5" aria-label="Practice lab and assignment">
      {lab ? (
        <article className="min-w-0 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-5 sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-widest text-cyan-950">
            Practice lab · {progress}/{lab.tasks.length} tasks
          </p>
          {labs.length > 1 ? (
            <label className="mt-3 block max-w-md text-sm font-medium text-slate-900">
              Practice mode
              <select
                aria-label="Practice mode"
                value={lab.id}
                onChange={(event) => {
                  const nextLab = labs.find((item) => item.id === event.target.value);
                  setSelectedLabId(event.target.value);
                  setTaskId(nextLab?.tasks[0]?.id ?? '');
                }}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
              >
                {labs.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <h2 className="mt-2 text-xl font-semibold text-slate-950">{lab.title}</h2>
          <p className="mt-2 leading-6 text-slate-700">{lab.instructions}</p>
          <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-sm leading-6 text-slate-100">
            {lab.workspace}
          </pre>
          {lab.kind !== 'git_shell' ? (
            <div
              className="mt-4 flex flex-wrap gap-2"
              role="group"
              aria-label={lab.kind === 'sql_query' ? 'SQL lab tasks' : 'Coding lab tasks'}
            >
              {lab.tasks.map((task, index) => (
                <button
                  key={task.id}
                  type="button"
                  aria-pressed={task.id === taskId}
                  disabled={index > progress}
                  onClick={() => {
                    setTaskId(task.id);
                    setText('');
                  }}
                  className="rounded-full border bg-white px-3 py-1.5 text-sm aria-pressed:border-cyan-800 aria-pressed:bg-cyan-100"
                >
                  {index + 1}. {task.title}
                </button>
              ))}
            </div>
          ) : null}
          <p className="mt-4 font-semibold text-slate-900">
            {lab.kind === 'git_shell'
              ? (lab.tasks[progress]?.prompt ?? lab.tasks.at(-1)?.prompt)
              : selectedTask?.prompt}
          </p>
          {lab.kind === 'code_editor' ? (
            <>
              <label className="mt-3 block max-w-xs text-sm font-medium text-slate-900">
                Language
                <select
                  aria-label="Coding language"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as 'python' | 'javascript')}
                  className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
                >
                  <option value="python">Python</option>
                  <option value="javascript">JavaScript</option>
                </select>
              </label>
              <div className="mt-3" role="group" aria-labelledby={`lab-code-label-${lab.id}`}>
                <p id={`lab-code-label-${lab.id}`} className="text-sm font-medium text-slate-900">
                  Code editor
                </p>
                <div className="mt-1 overflow-hidden rounded-lg border border-slate-700">
                  <MonacoEditor
                    height="280px"
                    language={language}
                    value={text}
                    onChange={(value) => {
                      const next = value ?? '';
                      if (next.length <= 20_000) setText(next);
                    }}
                    options={{ ariaLabel: 'Course code editor', fontSize: 14, minimap: { enabled: false } }}
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {text.length}/20,000 characters. Code runs against fixed tests in an isolated sandbox with
                network access disabled.
              </p>
            </>
          ) : lab.kind === 'sql_query' ? (
            <label className="mt-3 block text-sm font-medium text-slate-900" htmlFor={`lab-${lab.id}`}>
              SQL query
              <textarea
                id={`lab-${lab.id}`}
                rows={7}
                maxLength={4000}
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-sm leading-6"
              />
            </label>
          ) : (
            <label className="mt-3 block text-sm font-medium text-slate-900" htmlFor={`lab-${lab.id}`}>
              Command
              <input
                id={`lab-${lab.id}`}
                maxLength={200}
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm"
                placeholder="git status"
              />
            </label>
          )}
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => void runLab()}
            className="mt-3 rounded-lg bg-cyan-950 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            {busy
              ? 'Checking…'
              : lab.kind === 'code_editor'
                ? 'Run tests'
                : lab.kind === 'sql_query'
                  ? 'Check query'
                  : 'Run in simulated shell'}
          </button>
          {lab.kind === 'code_editor' && codingGrade ? (
            <div
              className="mt-4 space-y-2 rounded-lg bg-slate-950 p-3 font-mono text-sm text-slate-100"
              aria-label="Coding test output"
              aria-live="polite"
            >
              {codingGrade.results.map((result, index) => (
                <div
                  key={`${codingGrade.problemId}-${index}`}
                  className="border-b border-slate-700 pb-2 last:border-0"
                >
                  <p className={result.passed ? 'text-emerald-300' : 'text-amber-200'}>
                    Test {index + 1}: {result.passed ? 'passed' : 'needs work'}
                  </p>
                  {result.output ? (
                    <pre className="whitespace-pre-wrap break-words text-slate-200">{result.output}</pre>
                  ) : null}
                  {result.error ? (
                    <pre className="whitespace-pre-wrap break-words text-rose-200">{result.error}</pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {lab.kind !== 'code_editor' ? (
            <div
              className="mt-4 rounded-lg bg-slate-950 p-3 font-mono text-sm text-slate-100"
              aria-label="Lab terminal output"
              aria-live="polite"
            >
              {transcript.length ? (
                transcript.map((entry, index) => (
                  <div key={`${index}-${entry.progress}`} className="mb-3 whitespace-pre-wrap break-words">
                    <p>
                      <span className="text-cyan-300">&gt;</span> {entry.text}
                    </p>
                    <pre className="mt-1 whitespace-pre-wrap break-words">{entry.output}</pre>
                  </div>
                ))
              ) : (
                <p className="text-slate-300">Lab output will appear here.</p>
              )}
            </div>
          ) : null}
          {message ? (
            <p role="status" className="mt-3 text-sm text-emerald-950">
              {message}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 text-sm text-red-900">
              {error}
            </p>
          ) : null}
          <p className="mt-3 text-xs leading-5 text-slate-600">
            Shell tasks are simulated. Code tasks use the isolated runner; practice does not award mastery,
            create flashcards, or schedule review.
          </p>
        </article>
      ) : null}
      {course.assignments.map((assignment) => (
        <AssignmentCard
          key={assignment.id}
          assignment={assignment}
          session={session}
          getToken={getToken}
          onUpdated={onUpdated}
        />
      ))}
    </section>
  );
}
