'use client';

import { Show } from '@clerk/nextjs';
import Link from 'next/link';
import { SIGN_IN_URL, SIGN_UP_URL } from '@/lib/auth-routes';

const paths = [
  {
    number: '01',
    title: 'Learn from your material',
    detail: 'Turn a lecture PDF into short lessons, grounded explanations, and a viva you can answer.',
    href: '/library',
    action: 'Open my library',
    tone: 'green',
  },
  {
    number: '02',
    title: 'Practice until it sticks',
    detail: 'Review due flashcards, build a focus streak, and see the study time you have put in.',
    href: '/review',
    action: 'Review flashcards',
    tone: 'orange',
  },
  {
    number: '03',
    title: 'Take a short reset',
    detail: 'Play a quick logic or sorting challenge in the Game Vault between study sessions.',
    href: '/games',
    action: 'Visit Game Vault',
    tone: 'blue',
  },
];

export default function Home() {
  return (
    <main className="welcome-page">
      <section className="welcome-intro">
        <p className="page-kicker">YOUR MATERIAL. YOUR STUDY PLAN.</p>
        <h1>
          Make your notes
          <br />
          work harder.
        </h1>
        <p className="welcome-copy">
          EduSphere turns your course material into guided study, active recall, and small wins you can track.
        </p>
        <div className="welcome-actions">
          <Show when="signed-in">
            <Link className="action-primary" href="/library">
              Upload a study PDF <span aria-hidden="true">→</span>
            </Link>
            <Link className="welcome-text-link" href="/dashboard">
              Go to my workspace
            </Link>
          </Show>
          <Show when="signed-out">
            <Link href={SIGN_IN_URL} className="action-primary">
              Start studying <span aria-hidden="true">&#8594;</span>
            </Link>
            <Link href={SIGN_UP_URL} className="welcome-text-link">
              Create an account
            </Link>
          </Show>
        </div>
        <div className="welcome-stats" aria-label="Study workflow">
          <span>
            <b>01</b> Add material
          </span>
          <span aria-hidden="true">/</span>
          <span>
            <b>02</b> Learn a lesson
          </span>
          <span aria-hidden="true">/</span>
          <span>
            <b>03</b> Remember more
          </span>
        </div>
      </section>

      <section className="welcome-paths" aria-labelledby="welcome-paths-title">
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
            <article key={path.number} className={`welcome-path welcome-path-${path.tone}`}>
              <span className="welcome-path-number">{path.number}</span>
              <h3>{path.title}</h3>
              <p>{path.detail}</p>
              <Show when="signed-in">
                <Link href={path.href} className="welcome-path-link">
                  {path.action} <span aria-hidden="true">→</span>
                </Link>
              </Show>
              <Show when="signed-out">
                <Link href={SIGN_IN_URL} className="welcome-path-link">
                  Explore after sign in <span aria-hidden="true">&#8594;</span>
                </Link>
              </Show>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
