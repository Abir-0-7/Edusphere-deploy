# Production sign-in verification

The app uses Clerk’s embedded sign-in and sign-up pages at `/sign-in` and
`/sign-up`. The provider returns to Clerk’s configured OAuth endpoint first.
Clerk then resumes the application flow at the matching app-owned
`/sign-in/sso-callback` or `/sign-up/sso-callback` route.

Production was returning 200 for both app routes and for
`/__clerk/v1/environment`. The Clerk environment advertised the Account Portal
on `accounts.edusphere-deploy.vercel.app`, where the TLS connection closed
before the sign-in flow could finish. App links now use the embedded pages,
with a full-page provider redirect. Clerk still verifies the flow and handles
sessions and incomplete sign-ins.

For a hosted verification:

1. Keep `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` and
   `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up` in Vercel. Keep the existing Clerk
   Frontend API proxy and production keys together. If Vercel uses
   `NEXT_PUBLIC_CLERK_PROXY_URL`, use the proxy URL registered in the Clerk
   production dashboard.
2. Compare the Google and GitHub provider callback settings to the exact
   callback URL shown for each connection under Clerk Production → SSO
   connections. That provider callback is set by Clerk. The application path
   above is where Clerk resumes the browser flow.
3. Open the deployed app in a fresh browser session for each provider. Use
   the top-level Sign in link and select Google or GitHub directly. Confirm the
   provider returns through the application and loads the signed-in workspace.
   Also check email sign-in and the sign-up path. If a provider still fails,
   check the corresponding `oauth_callback.failed` event in Clerk Logs.

[Clerk app-hosted sign-in setup](https://clerk.com/docs/nextjs/guides/development/custom-sign-in-or-up-page) ·
[Google connection setup](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google) ·
[GitHub connection setup](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/github)
