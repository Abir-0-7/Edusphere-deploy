import type { ReactNode } from 'react';

export function AuthShell({ children, signingUp = false }: { children: ReactNode; signingUp?: boolean }) {
  return (
    <main className="auth-page">
      <div className="auth-story">
        <p className="page-kicker">EDUSPHERE</p>
        <h1>{signingUp ? 'Build your study space.' : 'Pick up where you left off.'}</h1>
        <p>
          {signingUp
            ? 'Bring your course material and start building a library you can study, listen to, and review.'
            : 'Your library, lessons, and flashcards are ready when you are.'}
        </p>
      </div>
      <div className="auth-form">{children}</div>
    </main>
  );
}
