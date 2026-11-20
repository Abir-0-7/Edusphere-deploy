import { SignUp } from '@clerk/nextjs';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { AUTH_FALLBACK_URL, SIGN_IN_URL, SIGN_UP_URL } from '@/lib/auth-routes';

export default function SignUpPage() {
  return (
    <AuthShell signingUp>
      <Suspense fallback={<p role="status">Loading sign up…</p>}>
        <SignUp
          routing="path"
          path={SIGN_UP_URL}
          signInUrl={SIGN_IN_URL}
          oauthFlow="redirect"
          fallbackRedirectUrl={AUTH_FALLBACK_URL}
          signInFallbackRedirectUrl={AUTH_FALLBACK_URL}
        />
      </Suspense>
    </AuthShell>
  );
}
