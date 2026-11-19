import { ClerkProvider, Show, SignInButton, UserButton } from '@clerk/nextjs';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';
import { GamesNavigation } from '@/components/games-navigation';
import { QueryProvider } from './providers';

export const metadata = {
  title: 'EduSphere',
  description: 'Your study workspace for courses, practice, and progress.',
};

const navSections = [
  {
    label: 'STUDY',
    links: [
      { href: '/dashboard', label: 'Overview', mark: '01' },
      { href: '/library', label: 'My library', mark: '02' },
      { href: '/tutor', label: 'AI tutor', mark: '03' },
    ],
  },
  {
    label: 'PRACTICE',
    links: [
      { href: '/review', label: 'Flashcards', mark: '04' },
      { href: '/courses', label: 'Guided courses', mark: '05' },
      { href: '/learning-profile', label: 'Learning profile', mark: '06' },
      { href: '/progress', label: 'Focus & progress', mark: '07' },
      { href: '/games', label: 'Game vault', mark: '08' },
    ],
  },
  {
    label: 'TOOLS',
    links: [
      { href: '/tools', label: 'Academic toolkit', mark: '09' },
      { href: '/account', label: 'Account', mark: '10' },
    ],
  },
];

function Navigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav aria-label="Primary navigation" className={mobile ? 'app-mobile-nav' : 'app-side-nav'}>
      {navSections.flatMap((section) => [
        <p key={`${section.label}-label`} className="app-nav-section">
          {section.label}
        </p>,
        ...section.links.map((link) => (
          <Link key={link.href} href={link.href} className="app-nav-link">
            <span className="app-nav-mark" aria-hidden="true">
              {link.mark}
            </span>
            <span>{link.label}</span>
          </Link>
        )),
      ])}
    </nav>
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider dynamic>
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
                  <Navigation />
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
                      <SignInButton mode="modal">
                        <button type="button" className="app-signin-button">
                          Sign in
                        </button>
                      </SignInButton>
                    </Show>
                  </div>
                </header>
                <Show when="signed-in">
                  <Navigation mobile />
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
