# Phase 8D deployment verification

Phase 8D was ported independently onto the deployment repository after Phase 8C. This branch excludes the other staged Phase 8 work from the source workspace.

Implemented: versioned decks and draft generation/merge, card viewer/editor/quality reports, private source quizzes and safe CSV, bounded account-scoped offline decks/reviews, saved concept graph/editor/exports, source/deck/practice/course handoffs, explicit insertion into the existing account-scoped Tldraw board, and regeneration that preserves learner annotations/layout.

The port preserves Phase 8A's exact per-card source revision, owner validation, normal page bounds and review idempotency. CSV/quiz reads paginate the whole bounded deck. Missing course-tutor exports and the shared Markdown renderer were restored to match the existing integrated baseline contracts.

Validation on the deployment branch:

- Full monorepo test command passed: web 173, shared types 37, DB 5, game engine 65, realtime 22, code runner 7, extension 8 and OCR asset scripts 4. The eight TypeScript database tests gated in that command also passed separately: web 6 and realtime 2.
- Chromium: Studio 7, offline 1, graph explorer/actions 5, existing course candidates/practice 7, Python/PyTorch 3, track plan 1, Game Vault 16 passed.
- Default production browser suite: 6 passed, 7 explicitly gated by live Clerk or a standalone game-engine URL.
- Monorepo lint, typecheck and the exact `pnpm build` command passed. The Webpack production build passed too.
- Final AI unit/API suite after rebasing onto the published four-course catalog: 457 passed, 29 environment-gated skips. Ruff passed. The D graph PostgreSQL test and 31 other Python database checks passed separately without skips.
- `pnpm audit --prod` passed after pinning transitive KaTeX to the already-used 0.19.1 version. The [upstream advisory](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7) requires at least 0.18.2; renderer tests and the production build passed after the lockfile update.
- Disposable PostgreSQL rehearsed baseline migrations plus exact 0011–0015 D SQL: legacy card IDs, evidence, schedules and reviews preserved; default decks, versions, owner checks and cascades passed. The local PostgreSQL bundle lacks pgvector, so pre-existing vector extension/index definitions were substituted only in the disposable fixture. D migration SQL was unchanged.

Live Clerk/provider/staging, actual pgvector retrieval, and Tesseract tests remain environment gates. They are not represented by the isolated browser transport or local migration rehearsal.

The final branch includes main's course publication/runtime update `481c63dd`. Its stricter tutor validation, catalog fixture and Markdown renderer were preserved; the originally overlapping prerequisite application-code edits are already present on main. Full monorepo and Python checks plus the production build passed again after reconciliation.
