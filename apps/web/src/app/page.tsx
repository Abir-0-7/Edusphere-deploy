'use client';

import { Show } from '@clerk/nextjs';
import Link from 'next/link';
import { SIGN_IN_URL, SIGN_UP_URL } from '@/lib/auth-routes';

const paths = [
  {
    number: '01',
    mark: '▤',
    title: 'Read by chapter',
    detail: 'Open a summary alongside the source.',
    href: '/library',
    action: 'Open my library',
    tone: 'green',
  },
  {
    number: '02',
    mark: '✧',
    title: 'Ask with evidence',
    detail: 'Jump from an answer to the page it cites.',
    href: '/tutor',
    action: 'Open your tutor',
    tone: 'orange',
  },
  {
    number: '03',
    mark: '↻',
    title: 'Review on schedule',
    detail: 'Spend your time on cards that are due.',
    href: '/review',
    action: 'Review flashcards',
    tone: 'blue',
  },
];

export default function Home() {
  return (
    <main className="welcome-page">
      <section className="welcome-intro">
        <div className="welcome-hero-copy">
          <p className="page-kicker">YOUR PERSONAL STUDY WORKSPACE</p>
          <h1>
            Turn a PDF into
            <br />a study plan.
          </h1>
          <p className="welcome-copy">
            Find the chapters that matter, ask questions with page citations, and review flashcards when
            they’re due.
          </p>
          <div className="welcome-actions">
            <Show when="signed-in">
              <Link className="action-primary" href="/library">
                Get started <span aria-hidden="true">↗</span>
              </Link>
              <Link className="welcome-text-link" href="/dashboard">
                Explore my workspace
              </Link>
            </Show>
            <Show when="signed-out">
              <Link href={SIGN_UP_URL} className="action-primary">
                Get started <span aria-hidden="true">↗</span>
              </Link>
              <Link href={SIGN_IN_URL} className="welcome-text-link">
                Sign in
              </Link>
            </Show>
          </div>
        </div>
        <div
          className="coast-study-art"
          role="group"
          aria-label="A source document, cited answer, and recall card"
        >
          <div className="coast-orbit coast-orbit-outer" aria-hidden="true" />
          <div className="coast-orbit coast-orbit-inner" aria-hidden="true" />
          <article className="coast-source-sheet">
            <span className="coast-art-label">SOURCE · PDF</span>
            <strong>Cell Biology</strong>
            <i aria-hidden="true" />
            <i aria-hidden="true" />
            <i aria-hidden="true" />
            <span className="coast-art-page">Chapter 4 · p. 18</span>
          </article>
          <article className="coast-answer-card">
            <span className="coast-art-label">CITED ANSWER</span>
            <strong>How does ATP synthase work?</strong>
            <span className="coast-citation">Cell Biology · p. 18</span>
          </article>
          <article className="coast-recall-card">
            <span className="coast-art-label">FLASHCARD</span>
            <strong>What drives ATP production?</strong>
          </article>
          <span className="coast-art-spark coast-art-spark-one" aria-hidden="true">
            ✳
          </span>
          <span className="coast-art-spark coast-art-spark-two" aria-hidden="true">
            ✦
          </span>
        </div>
      </section>

      <section className="welcome-paths" id="study-loop" aria-labelledby="welcome-paths-title">
        <div className="welcome-paths-head">
          <div>
            <p className="page-kicker">A STUDY LOOP THAT MOVES</p>
            <h2 id="welcome-paths-title" className="section-heading">
              What would you like to do?
            </h2>
          </div>
          <Show when="signed-out">
            <span className="muted-label">Sign in to open your workspace</span>
          </Show>
        </div>
        <div className="welcome-path-grid">
          {paths.map((path) => (
            <article key={path.number} className={'welcome-path welcome-path-' + path.tone}>
              <span className="welcome-path-number" aria-hidden="true">
                {path.mark}
              </span>
              <h3>{path.title}</h3>
              <p>{path.detail}</p>
              <Show when="signed-in">
                <Link href={path.href} className="welcome-path-link">
                  {path.action} <span aria-hidden="true">→</span>
                </Link>
              </Show>
              <Show when="signed-out">
                <Link href={SIGN_IN_URL} className="welcome-path-link">
                  Explore after sign in <span aria-hidden="true">→</span>
                </Link>
              </Show>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
