'use client';

import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { askQuestion, getChapters } from '@/lib/ai-client';
import type { Chapter, ChatReply } from '@/lib/ai-types';
import { LEVELS, requestSummary, type SummaryLevel } from '@/components/summary-panel';

const SERVICE_URL = process.env.NEXT_PUBLIC_AI_SERVICE_URL?.replace(/\/$/, '') ?? '';

const QuizQuestionSchema = z.object({
  question: z.string().min(1),
  expected_points: z.array(z.string().min(1)).min(1),
});
const QuizQuestionsSchema = z.array(QuizQuestionSchema).min(1);
const QuizGradeSchema = z.object({
  score: z.number(),
  feedback: z.string(),
  covered: z.array(z.string()).default([]),
  missed: z.array(z.string()).default([]),
});

type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
type QuizGrade = z.infer<typeof QuizGradeSchema>;
type TutorExchange = { question: string; reply: ChatReply };

const summaryLabels: Record<SummaryLevel, string> = {
  eli5: 'Simple',
  standard: 'Standard',
  deep_dive: 'Deep dive',
};

export default function TutorPage() {
  const searchParams = useSearchParams();
  const documentId = searchParams.get('documentId')?.trim() ?? '';
  return <TutorCourse key={documentId} documentId={documentId} />;
}

function TutorCourse({ documentId }: { documentId: string }) {
  const { getToken } = useAuth();
  const requestLifetime = useRef<AbortController | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [loadingCourse, setLoadingCourse] = useState(Boolean(documentId));
  const [courseError, setCourseError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [summaryLevel, setSummaryLevel] = useState<SummaryLevel>('standard');
  const [summaryText, setSummaryText] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [questionInput, setQuestionInput] = useState('');
  const [exchanges, setExchanges] = useState<TutorExchange[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswer, setQuizAnswer] = useState('');
  const [quizGrade, setQuizGrade] = useState<QuizGrade | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState('');
  const [hintsVisible, setHintsVisible] = useState(false);
  const [quizComplete, setQuizComplete] = useState(false);

  const chapter = chapters[chapterIndex] ?? null;
  const currentQuestion = quizQuestions[quizIndex] ?? null;
  const progress = chapters.length ? Math.round(((chapterIndex + 1) / chapters.length) * 100) : 0;
  const serviceMissing = !SERVICE_URL;

  useEffect(() => {
    const controller = new AbortController();
    requestLifetime.current = controller;
    return () => {
      controller.abort();
      requestLifetime.current = null;
    };
  }, []);

  useEffect(() => {
    let current = true;
    if (!documentId) {
      setLoadingCourse(false);
      setChapters([]);
      return;
    }
    if (!SERVICE_URL) {
      setCourseError('The AI service URL is not configured for this deployment.');
      setLoadingCourse(false);
      return;
    }
    setLoadingCourse(true);
    setCourseError('');
    void (async () => {
      try {
        const rows = await getChapters(getToken, documentId);
        if (!current) return;
        setChapters(rows);
        setChapterIndex(0);
        setQuizQuestions([]);
        setQuizComplete(false);
      } catch {
        if (current) setCourseError('We could not load this course. Check the deployment connection and try again.');
      } finally {
        if (current) setLoadingCourse(false);
      }
    })();
    return () => { current = false; };
  }, [documentId, getToken, retryCount]);

  useEffect(() => {
    if (!chapter || serviceMissing) {
      setSummaryText('');
      setSummaryError(serviceMissing ? 'The AI service URL is not configured.' : '');
      setSummaryLoading(false);
      return;
    }
    const controller = new AbortController();
    let current = true;
    setSummaryText('');
    setSummaryError('');
    setSummaryLoading(true);
    void (async () => {
      try {
        const token = await getToken();
        if (!current || controller.signal.aborted) return;
        const result = await requestSummary(
          chapter.id,
          summaryLevel,
          token,
          controller.signal,
          (part) => {
            if (current) setSummaryText((previous) => previous + part);
          },
        );
        if (current) setSummaryText(result);
      } catch {
        if (current && !controller.signal.aborted) {
          setSummaryError('Could not load this lesson summary. Try again.');
        }
      } finally {
        if (current) setSummaryLoading(false);
      }
    })();
    return () => {
      current = false;
      controller.abort();
    };
  }, [chapter?.id, getToken, serviceMissing, summaryLevel]);

  const askTutor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = questionInput.trim();
    const signal = requestLifetime.current?.signal;
    if (!question || !documentId || serviceMissing || !signal || signal.aborted) return;
    setChatLoading(true);
    setChatError('');
    try {
      const reply = await askQuestion(getToken, documentId, question);
      if (signal.aborted) return;
      setExchanges((previous) => [{ question, reply }, ...previous].slice(0, 5));
      setQuestionInput('');
    } catch {
      if (!signal.aborted) setChatError('The tutor could not answer right now. Please try again.');
    } finally {
      if (!signal.aborted) setChatLoading(false);
    }
  };

  const startQuiz = async () => {
    const signal = requestLifetime.current?.signal;
    if (!documentId || serviceMissing || !signal || signal.aborted) return;
    setQuizLoading(true);
    setQuizError('');
    setQuizGrade(null);
    setQuizComplete(false);
    setHintsVisible(false);
    try {
      const token = await getToken();
      if (signal.aborted) return;
      const response = await fetch(`${SERVICE_URL}/api/documents/${encodeURIComponent(documentId)}/viva-questions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token ?? ''}` },
        signal,
      });
      if (!response.ok) throw new Error('Question generation failed');
      const parsed = QuizQuestionsSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('Invalid question response');
      if (signal.aborted) return;
      setQuizQuestions(parsed.data);
      setQuizIndex(0);
      setQuizAnswer('');
    } catch {
      if (!signal.aborted) setQuizError('Could not create a check-in for this course. Try again after the lesson is ready.');
    } finally {
      if (!signal.aborted) setQuizLoading(false);
    }
  };

  const gradeAnswer = async () => {
    const signal = requestLifetime.current?.signal;
    if (!currentQuestion || !quizAnswer.trim() || !signal || signal.aborted) return;
    setQuizLoading(true);
    setQuizError('');
    setQuizGrade(null);
    try {
      const token = await getToken();
      if (signal.aborted) return;
      const response = await fetch(`${SERVICE_URL}/api/viva-grade`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          question: currentQuestion.question,
          expected_points: currentQuestion.expected_points,
          answer: quizAnswer.trim(),
        }),
        signal,
      });
      if (!response.ok) throw new Error('Answer grading failed');
      const parsed = QuizGradeSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('Invalid grading response');
      if (signal.aborted) return;
      setQuizGrade(parsed.data);
    } catch {
      if (!signal.aborted) setQuizError('Your answer could not be graded. Please try again.');
    } finally {
      if (!signal.aborted) setQuizLoading(false);
    }
  };

  const nextQuizQuestion = () => {
    setQuizGrade(null);
    setQuizAnswer('');
    setHintsVisible(false);
    if (quizIndex + 1 >= quizQuestions.length) {
      setQuizComplete(true);
      return;
    }
    setQuizIndex((index) => index + 1);
  };

  if (!documentId) {
    return (
      <main className="min-h-[calc(100vh-65px)] bg-[#f3f7f5] px-4 py-12 sm:px-8">
        <section className="mx-auto max-w-2xl border border-[#d6e3dd] bg-white p-8 shadow-sm sm:p-10">
          <p className="text-xs font-semibold uppercase text-[#0f766e]">Tutor</p>
          <h1 className="mt-3 text-3xl font-semibold text-[#172b29]">Choose a course to begin</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#52635f]">
            Open a document from your Library to study its chapters, ask grounded questions, and check what you remember.
          </p>
          <Link href="/library" className="mt-6 inline-flex min-h-11 items-center bg-[#0f766e] px-5 text-sm font-semibold text-white hover:bg-[#115e59]">
            Open my library
          </Link>
        </section>
      </main>
    );
  }

  if (loadingCourse) {
    return (
      <main className="min-h-[calc(100vh-65px)] bg-[#f3f7f5] px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-7xl animate-pulse space-y-5" aria-label="Loading course">
          <div className="h-24 bg-white" />
          <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="h-96 bg-white" />
            <div className="h-[34rem] bg-white" />
          </div>
        </div>
        <p className="sr-only" role="status">Loading your course</p>
      </main>
    );
  }

  if (courseError) {
    return (
      <main className="min-h-[calc(100vh-65px)] bg-[#f3f7f5] px-4 py-12 sm:px-8">
        <section className="mx-auto max-w-2xl border border-[#d6e3dd] bg-white p-8 shadow-sm" role="alert">
          <p className="text-xs font-semibold uppercase text-[#b45309]">Course unavailable</p>
          <h1 className="mt-3 text-2xl font-semibold text-[#172b29]">We couldn’t open this course</h1>
          <p className="mt-2 text-sm leading-6 text-[#52635f]">{courseError}</p>
          <button type="button" onClick={() => setRetryCount((count) => count + 1)} className="mt-6 min-h-11 bg-[#0f766e] px-5 text-sm font-semibold text-white hover:bg-[#115e59]">
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (chapters.length === 0) {
    return (
      <main className="min-h-[calc(100vh-65px)] bg-[#f3f7f5] px-4 py-12 sm:px-8">
        <section className="mx-auto max-w-2xl border border-[#d6e3dd] bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase text-[#0f766e]">Mini-course</p>
          <h1 className="mt-3 text-2xl font-semibold text-[#172b29]">Your lessons are not ready yet</h1>
          <p className="mt-2 text-sm leading-6 text-[#52635f]">
            This document has no chapters yet. Check that PDF processing has finished, then reload the course.
          </p>
          <button type="button" onClick={() => setRetryCount((count) => count + 1)} className="mt-6 min-h-11 bg-[#0f766e] px-5 text-sm font-semibold text-white hover:bg-[#115e59]">
            Reload lessons
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-65px)] bg-[#f3f7f5] text-[#172b29]">
      <header className="border-b border-[#d6e3dd] bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-5 px-4 py-7 sm:px-8">
          <div>
            <p className="text-xs font-semibold uppercase text-[#0f766e]">Study room / mini-course</p>
            <h1 className="mt-2 text-3xl font-semibold">Learn with your tutor</h1>
            <p className="mt-2 text-sm text-[#52635f]">{chapters.length} lessons from your document</p>
            <Link href={`/document/${encodeURIComponent(documentId)}`} className="mt-3 inline-flex min-h-10 items-center border border-[#cbd8d2] px-3 text-sm font-medium text-[#0f766e] hover:bg-[#eef7f3]">
              All document tools: flashcards, audio, mind map & planner
            </Link>
          </div>
          <div className="w-full max-w-xs" aria-label="Current lesson position">
            <div className="flex justify-between text-xs font-medium text-[#52635f]">
              <span>Lesson {chapterIndex + 1} of {chapters.length}</span>
              <span>{progress}%</span>
            </div>
            <div className="mt-2 h-2 bg-[#e1ebe6]">
              <div className="h-2 bg-[#0f766e] transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:px-8 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="h-fit border border-[#d6e3dd] bg-white p-4 lg:sticky lg:top-4" aria-label="Course lessons">
          <div className="flex items-center justify-between gap-3 border-b border-[#e5ece9] pb-3">
            <h2 className="text-sm font-semibold">Course outline</h2>
            <span className="text-xs text-[#687873]">{chapters.length} lessons</span>
          </div>
          <ol className="mt-3 space-y-1">
            {chapters.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setChapterIndex(index)}
                  aria-current={chapterIndex === index ? 'step' : undefined}
                  className={`flex min-h-14 w-full items-start gap-3 border-l-2 px-3 py-2 text-left transition-colors ${chapterIndex === index ? 'border-[#0f766e] bg-[#eef7f3]' : 'border-transparent hover:bg-[#f6f9f7]'}`}
                >
                  <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center text-xs font-semibold ${chapterIndex === index ? 'bg-[#0f766e] text-white' : 'bg-[#edf1ef] text-[#52635f]'}`}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-5">{item.title}</span>
                    {item.start_page != null && (
                      <span className="mt-1 block text-xs text-[#687873]">
                        Page {item.start_page}{item.end_page && item.end_page !== item.start_page ? `-${item.end_page}` : ''}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <div className="min-w-0 space-y-5">
          {chapter && (
            <section className="border border-[#d6e3dd] bg-white p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e5ece9] pb-5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase text-[#0f766e]">Lesson {chapterIndex + 1}</p>
                  <h2 className="mt-2 break-words text-2xl font-semibold leading-tight">{chapter.title}</h2>
                  {chapter.start_page != null && (
                    <p className="mt-2 text-sm text-[#687873]">
                      Source pages {chapter.start_page}{chapter.end_page && chapter.end_page !== chapter.start_page ? `-${chapter.end_page}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => setChapterIndex((index) => Math.max(0, index - 1))} disabled={chapterIndex === 0} className="min-h-10 border border-[#cbd8d2] px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40">
                    Previous
                  </button>
                  <button type="button" onClick={() => setChapterIndex((index) => Math.min(chapters.length - 1, index + 1))} disabled={chapterIndex === chapters.length - 1} className="min-h-10 bg-[#0f766e] px-3 text-sm font-semibold text-white hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-40">
                    Next lesson
                  </button>
                </div>
              </div>

              <div className="pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">Lesson guide</h3>
                    <p className="mt-1 text-sm text-[#687873]">Choose how much detail you want.</p>
                  </div>
                  <div className="inline-flex border border-[#cbd8d2] p-1" role="group" aria-label="Summary detail">
                    {LEVELS.map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setSummaryLevel(level)}
                        aria-pressed={summaryLevel === level}
                        disabled={summaryLoading}
                        className={`min-h-9 px-3 text-xs font-medium disabled:opacity-50 ${summaryLevel === level ? 'bg-[#0f766e] text-white' : 'text-[#52635f] hover:bg-[#eef7f3]'}`}
                      >
                        {summaryLabels[level]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-4 min-h-32 border-l-4 border-[#d97706] bg-[#fbfaf5] px-4 py-4">
                  {summaryLoading && !summaryText && <p className="text-sm text-[#687873]" role="status">Preparing your lesson guide...</p>}
                  {summaryError && <p className="text-sm text-[#b45309]" role="alert">{summaryError}</p>}
                  {summaryText && <p className="whitespace-pre-wrap text-sm leading-7 text-[#344642]">{summaryText}</p>}
                </div>
              </div>
            </section>
          )}

          <section className="border border-[#d6e3dd] bg-white p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase text-[#b45309]">Practice</p>
                <h2 className="mt-1 text-xl font-semibold">Check your understanding</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#52635f]">Answer a question from your document. You can ask to reveal the key points when you need a hint.</p>
              </div>
              <button type="button" onClick={() => void startQuiz()} disabled={quizLoading || serviceMissing} className="min-h-11 bg-[#172b29] px-4 text-sm font-semibold text-white hover:bg-[#294541] disabled:cursor-not-allowed disabled:opacity-50">
                {quizLoading && !currentQuestion ? 'Preparing...' : quizQuestions.length ? 'New questions' : 'Start practice'}
              </button>
            </div>
            {quizError && <p className="mt-4 text-sm text-red-700" role="alert">{quizError}</p>}
            {quizComplete ? (
              <div className="mt-5 border border-[#c7ded4] bg-[#f0f8f4] p-4">
                <p className="font-semibold text-[#14532d]">Practice set complete</p>
                <p className="mt-1 text-sm text-[#52635f]">Try another question set or continue to the next lesson.</p>
                <button type="button" onClick={() => void startQuiz()} className="mt-3 min-h-10 border border-[#9ecab4] px-3 text-sm font-medium text-[#14532d] hover:bg-white">Practice again</button>
              </div>
            ) : currentQuestion ? (
              <div className="mt-5 border-t border-[#e5ece9] pt-5">
                <p className="text-xs font-semibold uppercase text-[#687873]">Question {quizIndex + 1} of {quizQuestions.length}</p>
                <h3 className="mt-2 text-base font-semibold leading-6">{currentQuestion.question}</h3>
                <label htmlFor="tutor-quiz-answer" className="mt-4 block text-sm font-medium">Your answer</label>
                <textarea
                  id="tutor-quiz-answer"
                  value={quizAnswer}
                  onChange={(event) => setQuizAnswer(event.target.value)}
                  rows={3}
                  maxLength={4000}
                  disabled={Boolean(quizGrade) || quizLoading}
                  placeholder="Write what you remember..."
                  className="mt-2 w-full resize-y border border-[#cbd8d2] bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-[#0f766e]"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => void gradeAnswer()} disabled={quizLoading || Boolean(quizGrade) || !quizAnswer.trim()} className="min-h-10 bg-[#0f766e] px-4 text-sm font-semibold text-white hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-50">
                    {quizLoading ? 'Checking...' : 'Check answer'}
                  </button>
                  <button type="button" onClick={() => setHintsVisible((visible) => !visible)} aria-expanded={hintsVisible} className="min-h-10 border border-[#cbd8d2] px-4 text-sm font-medium text-[#344642] hover:bg-[#f3f7f5]">
                    {hintsVisible ? 'Hide hint points' : 'Show hint points'}
                  </button>
                  {quizGrade && quizIndex + 1 < quizQuestions.length && (
                    <button type="button" onClick={nextQuizQuestion} className="ml-auto min-h-10 px-3 text-sm font-semibold text-[#0f766e] hover:bg-[#eef7f3]">Next question</button>
                  )}
                  {quizGrade && quizIndex + 1 === quizQuestions.length && (
                    <button type="button" onClick={nextQuizQuestion} className="ml-auto min-h-10 px-3 text-sm font-semibold text-[#0f766e] hover:bg-[#eef7f3]">Finish practice</button>
                  )}
                </div>
                {hintsVisible && (
                  <div className="mt-4 border-l-4 border-[#d97706] bg-[#fbfaf5] px-4 py-3">
                    <p className="text-sm font-semibold text-[#7c2d12]">Key points</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-[#52635f]">
                      {currentQuestion.expected_points.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}
                    </ul>
                  </div>
                )}
                {quizGrade && (
                  <div className="mt-4 border border-[#d6e3dd] bg-[#f7faf8] p-4">
                    <p className="text-sm font-semibold">Score {quizGrade.score}/5</p>
                    <p className="mt-1 text-sm leading-6 text-[#52635f]">{quizGrade.feedback}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-5 border-t border-[#e5ece9] pt-4 text-sm text-[#687873]">A short set of questions will be generated from this document.</p>
            )}
          </section>

          <section className="border border-[#d6e3dd] bg-white p-5 sm:p-7">
            <div>
              <p className="text-xs font-semibold uppercase text-[#0f766e]">Ask and explore</p>
              <h2 className="mt-1 text-xl font-semibold">Ask your tutor</h2>
              <p className="mt-2 text-sm text-[#52635f]">Answers are grounded in the document and include source excerpts when available.</p>
            </div>
            <form onSubmit={askTutor} className="mt-4">
              <label htmlFor="tutor-question" className="sr-only">Question about this course</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="tutor-question"
                  value={questionInput}
                  onChange={(event) => setQuestionInput(event.target.value)}
                  maxLength={2000}
                  placeholder="Ask about an idea, term, or example..."
                  className="min-h-11 min-w-0 flex-1 border border-[#cbd8d2] px-3 text-sm outline-none focus:border-[#0f766e]"
                />
                <button type="submit" disabled={chatLoading || serviceMissing || !questionInput.trim()} className="min-h-11 bg-[#0f766e] px-5 text-sm font-semibold text-white hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-50">
                  {chatLoading ? 'Thinking...' : 'Ask'}
                </button>
              </div>
            </form>
            {chatError && <p className="mt-3 text-sm text-red-700" role="alert">{chatError}</p>}
            <div className="mt-5 space-y-4" aria-live="polite">
              {exchanges.map((exchange, exchangeIndex) => (
                <article key={`${exchangeIndex}-${exchange.question}`} className="border-t border-[#e5ece9] pt-4">
                  <p className="text-sm font-semibold">{exchange.question}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#344642]">{exchange.reply.answer}</p>
                  {exchange.reply.citations.length > 0 && (
                    <div className="mt-3 border-l-2 border-[#9ecab4] pl-3">
                      <p className="text-xs font-semibold uppercase text-[#52635f]">Sources</p>
                      <ul className="mt-2 space-y-2">
                        {exchange.reply.citations.map((citation, index) => (
                          <li key={`${citation.chunk_id}-${index}`} className="text-xs leading-5 text-[#687873]">
                            {citation.page != null && <span className="font-semibold">Page {citation.page}: </span>}
                            <span>“{citation.quote}”</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
