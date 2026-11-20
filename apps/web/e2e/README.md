# End-to-end tests

Playwright specs live in `e2e/` and run with `pnpm --filter @studyvault/web test:e2e`.

The Game Vault suite runs with `test:e2e:games`. It includes nine focus-lock
scenarios that render the production focus provider, timer, games layout, and
player using authenticated HTTP fixtures: restoration loading/failure, active
focus, deep links/reloads/Cyberverse, completion retry, expiry, mobile, cross-tab
updates, and delayed-response races. Desktop/mobile captures are written to
`apps/web/test-results/game-vault`. Hosted signed-in acceptance is separate.

Academic tools run with `test:e2e:whiteboards`, `test:e2e:ocr`,
`test:e2e:code-review` and `test:e2e:checklists` on the web package. Narration
uses `pnpm --filter @studyvault/web exec playwright test --config
e2e/listen-isolated.config.ts`; editable covers use
`e2e/cover-docx-isolated.config.ts`. These isolated fixtures require no live
provider or Clerk account. The OCR fixture also starts the local Python API;
set `OCR_E2E_PYTHON` if its interpreter is outside `apps/ai-service/.venv`.

`guard.spec.ts` covers anonymous route protection and runs without credentials.
With the exact CI placeholder publishable key, its test-only request harness
fetches document responses with `sec-fetch-dest: empty` so Clerk's development
browser handshake does not navigate to the nonexistent placeholder domain.
Requests still execute the actual middleware, signed-out auth checks, CSP, and
redirects. Real Clerk keys use normal browser navigation.
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

Phase 8D has three isolated Chromium suites that mount the actual UI with fixture
transport. Run them with `test:e2e:flashcard-studio`, `test:e2e:offline-decks`, and
`test:e2e:maps` on the web package. The fixtures use separate local ports 4332,
4333, and 4334; no Clerk account or external API is needed. These suites cover
Studio draft/merge/edit/quiz/CSV, bounded offline study without scheduled-review
effects, and saved maps with full-label exports, learning actions, source checks,
and explicit board insertion. Native Tldraw insertion and account-local snapshot
isolation also have unit coverage in `concept-graph-board.test.ts` and
`local-boards.test.ts`.
