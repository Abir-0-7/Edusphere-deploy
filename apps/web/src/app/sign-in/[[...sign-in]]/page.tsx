import { SignIn } from '@clerk/nextjs';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { AUTH_FALLBACK_URL, SIGN_IN_URL, SIGN_UP_URL } from '@/lib/auth-routes';

export default function SignInPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p role="status">Loading sign in…</p>}>
        <SignIn
          routing="path"
          path={SIGN_IN_URL}
          signUpUrl={SIGN_UP_URL}
          oauthFlow="redirect"
          fallbackRedirectUrl={AUTH_FALLBACK_URL}
          signUpFallbackRedirectUrl={AUTH_FALLBACK_URL}
        />
      </Suspense>
    </AuthShell>
  );
}
