import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FocusSessionProvider } from '../../../src/components/focus-session-provider';
import { ActiveFocusTimer, FocusTimer } from '../../../src/components/focus-timer';
import '../../../src/app/globals.css';

type View = 'progress' | 'study' | 'overview';

function FocusFixture() {
  const [view, setView] = useState(new URLSearchParams(window.location.search).get('view') ?? 'progress');
  const navigate = (next: View) => {
    window.history.pushState(null, '', `?view=${next}`);
    setView(next);
  };
  return (
    <FocusSessionProvider>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <strong>Study workspace</strong>
        <nav aria-label="Workspace navigation" className="flex flex-wrap gap-4 text-sm">
          <a
            href="?view=progress"
            onClick={(event) => {
              event.preventDefault();
              navigate('progress');
            }}
          >
            Focus &amp; progress
          </a>
          <a
            href="?view=study"
            onClick={(event) => {
              event.preventDefault();
              navigate('study');
            }}
          >
            Study
          </a>
          <a
            href="?view=overview"
            onClick={(event) => {
              event.preventDefault();
              navigate('overview');
            }}
          >
            Overview
          </a>
        </nav>
      </header>
      <ActiveFocusTimer />
      <main className="mx-auto max-w-4xl space-y-6 p-5">
        <h1 className="text-2xl font-semibold">
          {view === 'progress' ? 'Focus & progress' : view === 'study' ? 'Study' : 'Overview'}
        </h1>
        {view !== 'overview' && (
          <section aria-label="Page focus controls">
            <FocusTimer compact={view === 'study'} />
          </section>
        )}
        {view === 'study' && (
          <section className="rounded border p-5">
            <h2 className="text-xl font-semibold">Your chapter</h2>
            <p className="mt-3">
              Keep your focus session in view while reading, asking questions, and reviewing your material.
            </p>
          </section>
        )}
        <div className="h-[1400px]" aria-hidden="true" />
        <p>End of study material</p>
      </main>
    </FocusSessionProvider>
  );
}

const host = document.getElementById('root');
if (!host) throw new Error('Missing focus timer fixture root');
createRoot(host).render(<FocusFixture />);
