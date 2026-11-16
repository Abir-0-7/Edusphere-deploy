import { clerkMiddleware } from '@clerk/nextjs/server';
import { getContentSecurityPolicyDirectives } from './lib/security-policy';

const aiServiceUrl = process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';

/**
 * Clerk session proxy (Next 16 renamed `middleware.ts` -> `proxy.ts`).
 *
 * Route protection is done per-page/per-route with `auth()` / `auth.protect()`
 * (the current recommended pattern); this just attaches the session so those
 * checks and the <Show> control component work. The webhook route is NOT
 * protected here — it is verified by its own svix signing secret.
 */
export default clerkMiddleware({
  contentSecurityPolicy: {
    strict: true,
    directives: getContentSecurityPolicyDirectives(aiServiceUrl),
  },
});

export const config = {
  matcher: [
    // OCR runtime/language files are public static assets, like other bundled scripts.
    // Skip static files and Next internals; run on everything else including api routes.
    '/((?!ocr/|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
};
