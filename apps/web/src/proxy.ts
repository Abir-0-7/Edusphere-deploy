import { clerkMiddleware } from '@clerk/nextjs/server';
import { getContentSecurityPolicyDirectives } from './lib/security-policy';
import { NextResponse, NextRequest, type NextFetchEvent } from 'next/server';
import { isLocalDemoEnabled, isLocalDemoRequest } from './lib/local-demo';

const aiServiceUrl = process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';

/**
 * Clerk session proxy (Next 16 renamed `middleware.ts` -> `proxy.ts`).
 *
 * Route protection is done per-page/per-route with `auth()` / `auth.protect()`
 * (the current recommended pattern); this just attaches the session so those
 * checks and the <Show> control component work. The webhook route is NOT
 * protected here — it is verified by its own svix signing secret.
 */
const withClerk = clerkMiddleware({
  contentSecurityPolicy: {
    strict: true,
    directives: getContentSecurityPolicyDirectives(aiServiceUrl),
  },
});

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const requestHeaders = new Headers(request.headers);
  // Never trust a caller-supplied demo marker.
  requestHeaders.delete('x-edusphere-local-demo');
  if (isLocalDemoEnabled()) {
    if (!isLocalDemoRequest(request)) {
      return new NextResponse('Local demo is available only through localhost.', { status: 403 });
    }
    const path = request.nextUrl.pathname;
    if (path === '/') return NextResponse.redirect(new URL('/games', request.url));
    if (path === '/games' || path.startsWith('/games/') || path.startsWith('/api/game-vault/')) {
      requestHeaders.set('x-edusphere-local-demo', '1');
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    return new NextResponse('Local offline mode supports Game Vault only. Open /games.', { status: 503 });
  }
  return withClerk(new NextRequest(request, { headers: requestHeaders }), event);
}

export const config = {
  matcher: [
    // OCR runtime/language files are public static assets, like other bundled scripts.
    // Skip static files and Next internals; run on everything else including api routes.
    '/((?!ocr/|games/cyberverse/|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
};
