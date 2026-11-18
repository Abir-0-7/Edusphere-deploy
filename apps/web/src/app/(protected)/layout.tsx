import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Server-side auth guard for every signed-in route (OWASP "auth on every
 * route", task 7.3). Doing this in a layout — rather than relying on client
 * Clerk state — means an unauthenticated request is redirected before any page
 * code runs, and it is testable without Clerk's JS bundle.
 */
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  return <div id="main-content">{children}</div>;
}
