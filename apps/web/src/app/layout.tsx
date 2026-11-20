import { ClerkProvider, Show, UserButton } from '@clerk/nextjs';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';
import { GamesNavigation } from '@/components/games-navigation';
import { WorkspaceNavigation } from '@/components/workspace-navigation';
import { AUTH_FALLBACK_URL, SIGN_IN_URL, SIGN_UP_URL } from '@/lib/auth-routes';
import { QueryProvider } from './providers';

export const metadata = {
  title: 'EduSphere',
  description: 'Your study workspace for courses, practice, and progress.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      dynamic
      signInUrl={SIGN_IN_URL}
      signUpUrl={SIGN_UP_URL}
      signInFallbackRedirectUrl={AUTH_FALLBACK_URL}
      signUpFallbackRedirectUrl={AUTH_FALLBACK_URL}
    >
      <html lang="en">
        <body>
          <QueryProvider>
            <a href="#main-content" className="skip-link">
              Skip to content
            </a>
            <div className="app-frame">
              <Show when="signed-in">
                <aside className="app-sidebar" aria-label="EduSphere workspace">
                  <Link href="/dashboard" className="app-brand">
                    <span className="app-brand-mark" aria-hidden="true">
                      ES
                    </span>
                    <span>
                      <strong>EduSphere</strong>
                      <small>LEARNING WORKSPACE</small>
                    </span>
                  </Link>
                  <div className="app-workspace-label">YOUR WORKSPACE</div>
                  <WorkspaceNavigation />
                  <div className="app-sidebar-bottom">
                    <div className="app-sidebar-note">
                      <span className="app-status-dot" aria-hidden="true" />
                      <span>Make time to learn</span>
                    </div>
                    <UserButton />
                  </div>
                </aside>
              </Show>

              <div className="app-main-column">
                <header className="app-topbar">
                  <Show when="signed-in">
                    <Link href="/dashboard" className="app-mobile-brand">
                      <span className="app-brand-mark" aria-hidden="true">
                        ES
                      </span>
                      <strong>EduSphere</strong>
                    </Link>
                    <span className="app-topbar-context">PERSONAL STUDY SPACE</span>
                  </Show>
                  <Show when="signed-out">
                    <Link href="/" className="app-guest-brand">
                      <span className="app-brand-mark" aria-hidden="true">
                        ES
                      </span>
                      <strong>EduSphere</strong>
                    </Link>
                  </Show>
                  <div className="app-topbar-actions">
                    <Show when="signed-in">
                      <GamesNavigation />
                      <Link href="/library" className="app-upload-link">
                        Add material <span aria-hidden="true">+</span>
                      </Link>
                      <span className="app-topbar-user">
                        <UserButton />
                      </span>
                    </Show>
                    <Show when="signed-out">
                      <Link href={SIGN_IN_URL} className="app-signin-button">
                        Sign in
                      </Link>
                    </Show>
                  </div>
                </header>
                <Show when="signed-in">
                  <WorkspaceNavigation mobile />
                </Show>
                <div id="main-content" tabIndex={-1} className="app-page-content">
                  {children}
                </div>
              </div>
            </div>
          </QueryProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
