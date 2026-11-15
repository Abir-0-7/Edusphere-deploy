import { ClerkProvider, Show, SignInButton, UserButton } from '@clerk/nextjs';
import type { ReactNode } from 'react';
import './globals.css';
import { QueryProvider } from './providers';

export const metadata = { title: 'StudyVault', description: 'AI-powered learning platform' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider dynamic>
      <html lang="en">
        <body>
          <QueryProvider>
            <a
              href="#main-content"
              className="sr-only absolute left-4 top-4 z-50 rounded bg-white px-3 py-2 text-sm font-medium text-blue-700 shadow focus:not-sr-only"
            >
              Skip to content
            </a>
            <header className="flex items-center justify-between border-b px-6 py-3">
              <a href="/" className="text-lg font-bold">
                StudyVault
              </a>
              <nav aria-label="Primary navigation" className="flex items-center gap-4">
                <Show when="signed-out">
                  <SignInButton mode="modal">
                    <button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">
                      Sign in
                    </button>
                  </SignInButton>
                </Show>
                <Show when="signed-in">
                  <a href="/dashboard" className="text-sm text-neutral-700 hover:underline">
                    Dashboard
                  </a>
                  <a href="/progress" className="text-sm text-neutral-700 hover:underline">
                    Progress
                  </a>
                  <a href="/review" className="text-sm text-neutral-700 hover:underline">
                    Review
                  </a>
                  <a href="/tools" className="text-sm text-neutral-700 hover:underline">
                    Tools
                  </a>
                  <a href="/account" className="text-sm text-neutral-700 hover:underline">
                    Account
                  </a>
                  <UserButton />
                </Show>
              </nav>
            </header>
            {children}
          </QueryProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
