# End-to-end tests

Playwright specs live in `e2e/` and run with `pnpm --filter @studyvault/web test:e2e`.

`guard.spec.ts` covers anonymous route protection and runs without credentials.
`learning-loop.spec.ts` exercises upload -> chapters -> grounded chat ->
flashcard generation -> review. It uses Clerk's official Playwright helper to
sign in an existing development-instance test user; it does not bypass the
application's protected layout.

Set these values before running the authenticated spec:

```bash
E2E_CLERK_USER_EMAIL='studyvault+clerk_test@example.com' \
CLERK_SECRET_KEY='sk_test_...' \
pnpm --filter @studyvault/web test:e2e
```

The Clerk publishable key must also be configured through the normal web
environment. The test is skipped with a clear reason when the test account or
secret is absent, so anonymous guard specs remain runnable on contributor
machines without credentials. `fixtures/lecture.pdf` is committed beside this
README and contains two text pages for deterministic upload coverage.
