'use client';

import dynamic from 'next/dynamic';
import type {
  AssignmentDraftRequest,
  CodeChallengeGrade,
  CourseAssignment,
  CourseDetail,
  SessionResponse,
} from '@studyvault/types';
import { runCourseCodeChallenge, runCourseLab, saveCourseAssignment } from '@/lib/course-client';
import type { GetToken } from '@/lib/ai-client';
import { useEffect, useMemo, useRef, useState } from 'react';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <textarea aria-label="Code editor" rows={12} readOnly value="Loading editor…" />,
});

function AssignmentCard({
  assignment,
  course,
  required,
  session,
  getToken,
  onUpdated,
  onDirtyChange,
}: {
  assignment: CourseAssignment;
  course: CourseDetail;
  required: boolean;
  session: SessionResponse;
  getToken: GetToken;
  onUpdated: () => Promise<void>;
  onDirtyChange: (assignmentId: string, dirty: boolean) => void;
}) {
  const [text, setText] = useState(session.assignment_drafts[assignment.id] ?? '');
  const [sections, setSections] = useState<Record<string, string>>(
    session.assignment_sections[assignment.id] ?? {},
  );
  const [evidenceIds, setEvidenceIds] = useState<string[]>(
    session.assignment_evidence_ids[assignment.id] ?? [],
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const status = session.assignment_status[assignment.id] ?? 'draft';
  const pending = useRef<{ signature: string; body: AssignmentDraftRequest } | null>(null);
  const structured = assignment.sections.length > 0;
  const lessonsReady = session.completed_lesson_ids.length === session.lessons.length;
  const canSubmit =
    (!required || lessonsReady) &&
    (structured
      ? assignment.sections.every(
          (section) => (sections[section.id] ?? '').trim().length >= section.min_chars,
        ) &&
        (!assignment.require_evidence || evidenceIds.length > 0)
      : text.trim().length >= 80);

  function markDirty(value: boolean) {
    setDirty(value);
    onDirtyChange(assignment.id, value);
  }

  useEffect(() => {
    // Progress refreshes must not erase a project that is still being edited.
    if (dirty) return;
    setText(session.assignment_drafts[assignment.id] ?? '');
    setSections(session.assignment_sections[assignment.id] ?? {});
    setEvidenceIds(session.assignment_evidence_ids[assignment.id] ?? []);
  }, [
    assignment.id,
    dirty,
    session.assignment_drafts,
    session.assignment_sections,
    session.assignment_evidence_ids,
  ]);

  async function refreshSavedState() {
    setBusy(true);
    setError('');
    try {
      await onUpdated();
      pending.current = null;
      setMessage(
        dirty
          ? 'Saved state refreshed. Your local edits are retained; save to replace the saved draft.'
          : 'Saved project state refreshed.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not refresh this project. Your local edits are retained.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function save(action: 'save' | 'submit') {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    const content = { assignment_id: assignment.id, action, text, sections, evidence_ids: evidenceIds };
    const signature = JSON.stringify(content);
    const request =
      pending.current?.signature === signature
        ? pending.current.body
        : ({
            id: crypto.randomUUID(),
            revision: session.revision,
            ...content,
          } satisfies AssignmentDraftRequest);
    pending.current = { signature, body: request };
    let saved = false;
    try {
      const result = await saveCourseAssignment(getToken, session.id, request);
      saved = true;
      pending.current = null;
      await onUpdated();
      markDirty(false);
      setMessage(
        result.status === 'submitted'
          ? 'Assignment submitted in your account. The rubric has not been graded and your code has not been executed.'
          : 'Assignment draft saved.',
      );
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'Could not save this assignment.';
      setError(
        saved
          ? `Your work was saved, but progress could not refresh. ${detail}`
          : `${detail} Your local edits are retained. Retry unchanged work to reuse its action ID, or refresh saved state after a conflict.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className="min-w-0 rounded-2xl border border-violet-200 bg-violet-50/60 p-5 sm:p-7"
      aria-label={assignment.title}
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-violet-900">
        {required ? 'Required capstone submission' : 'Independent project'}
      </p>
      <h2 className="mt-2 text-xl font-semibold text-slate-950">{assignment.title}</h2>
      <p className="mt-3 whitespace-pre-wrap break-words leading-7 text-slate-800">{assignment.prompt}</p>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">{assignment.deliverable}</p>
      <h3 className="mt-4 font-semibold">Project review rubric</h3>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-sm leading-6 text-slate-700">
        {assignment.rubric.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {assignment.criteria.length ? (
        <details className="mt-3 text-sm leading-6">
          <summary className="cursor-pointer font-semibold">Inspect rubric objectives and evidence</summary>
          <ol className="mt-2 space-y-3">
            {assignment.criteria.map((criterion) => (
              <li key={criterion.id}>
                <p className="font-medium">{criterion.description}</p>
                <p>{criterion.review_guidance}</p>
                <p className="text-slate-600">
                  Objectives:{' '}
                  {criterion.objective_ids
                    .map((id) => course.objectives.find((item) => item.id === id)?.title ?? id)
                    .join('; ')}
                </p>
                <p className="break-words text-slate-600">Evidence: {criterion.evidence_ids.join(', ')}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {structured ? (
        assignment.sections.map((section) => (
          <div key={section.id} className="mt-5">
            <label
              className="block text-sm font-semibold text-slate-900"
              htmlFor={`assignment-${assignment.id}-${section.id}`}
            >
              {section.title}
            </label>
            <p
              id={`assignment-help-${assignment.id}-${section.id}`}
              className="mt-1 text-sm leading-6 text-slate-700"
            >
              {section.prompt}
            </p>
            <textarea
              id={`assignment-${assignment.id}-${section.id}`}
              aria-describedby={`assignment-help-${assignment.id}-${section.id}`}
              rows={6}
              maxLength={section.max_chars}
              disabled={busy}
              value={sections[section.id] ?? ''}
              onChange={(event) => {
                setSections((current) => ({ ...current, [section.id]: event.target.value }));
                markDirty(true);
              }}
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-sm leading-6"
            />
            <p className="mt-1 text-right text-xs text-slate-600">
              {(sections[section.id] ?? '').length}/{section.max_chars} characters; at least{' '}
              {section.min_chars} required on submission
            </p>
          </div>
        ))
      ) : (
        <>
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
            disabled={busy}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              markDirty(true);
            }}
            className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-sm leading-6"
            placeholder="Write your proposed code/command sequence and explanation here."
          />
          <p className="mt-1 text-right text-xs text-slate-600">{text.length}/5000 characters</p>
        </>
      )}
      {assignment.require_evidence || structured ? (
        <fieldset className="mt-5 space-y-3 rounded-lg border border-violet-200 p-3">
          <legend className="px-1 text-sm font-semibold">
            Project evidence references{assignment.require_evidence ? ' (required)' : ''}
          </legend>
          <p className="text-xs leading-5 text-slate-600">
            Select the course evidence you used, then explain its relevance in your work.
          </p>
          {assignment.evidence_ids.map((id) => {
            const source = course.evidence.find((item) => item.id === id);
            return (
              <label key={id} className="flex items-start gap-3 text-sm leading-6">
                <input
                  type="checkbox"
                  checked={evidenceIds.includes(id)}
                  disabled={busy}
                  onChange={(event) => {
                    setEvidenceIds((current) =>
                      event.target.checked ? [...current, id] : current.filter((item) => item !== id),
                    );
                    markDirty(true);
                  }}
                  className="mt-1.5"
                />
                <span className="min-w-0 break-words">
                  <strong>{source?.locator ?? id}</strong>
                  <span className="mt-1 block">{source?.quote ?? 'See this versioned course source.'}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : null}
      <p className="mt-3 text-sm text-slate-700">
        Saved status: {status}
        {dirty ? ' · Unsaved local changes' : ''}
      </p>
      {required && !lessonsReady ? (
        <p className="mt-2 text-sm font-medium text-violet-950">
          Save a draft at any time. Complete every lesson and module checkpoint before submitting this
          capstone.
        </p>
      ) : null}
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
          disabled={busy || !canSubmit}
          onClick={() => void save('submit')}
          className="rounded-lg bg-violet-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          Submit assignment
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refreshSavedState()}
          className="rounded-lg border border-violet-800 bg-white px-4 py-2.5 text-sm font-semibold text-violet-950 disabled:opacity-50"
        >
          Refresh saved project state
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
        Your submission stays in this account. Submission checks completeness only; the rubric is not graded,
        code/SQL is not executed, and submission grants no mastery or XP.
      </p>
    </article>
  );
}

export function CourseProjectPanel({
  course,
  session,
  getToken,
  onUpdated,
  onDirtyChange,
}: {
  course: CourseDetail;
  session: SessionResponse;
  getToken: GetToken;
  onUpdated: () => Promise<void>;
  onDirtyChange: (assignmentId: string, dirty: boolean) => void;
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
      {course.assignments.map((assignment) =>
        course.required_assignment_ids.includes(assignment.id) ? (
          <details
            key={`${session.id}:${assignment.id}`}
            open={session.completed_lesson_ids.length === session.lessons.length}
            className="rounded-2xl border border-violet-200 bg-white"
          >
            <summary className="cursor-pointer p-5 font-semibold text-violet-950">
              Capstone project · {session.assignment_status[assignment.id] ?? 'draft'}
            </summary>
            <AssignmentCard
              assignment={assignment}
              course={course}
              required
              session={session}
              getToken={getToken}
              onUpdated={onUpdated}
              onDirtyChange={onDirtyChange}
            />
          </details>
        ) : (
          <AssignmentCard
            key={`${session.id}:${assignment.id}`}
            assignment={assignment}
            course={course}
            required={false}
            session={session}
            getToken={getToken}
            onUpdated={onUpdated}
            onDirtyChange={onDirtyChange}
          />
        ),
      )}
    </section>
  );
}
