# Phase 8D deployment verification

Phase 8D was ported independently onto the deployment repository after Phase 8C. This branch excludes the other staged Phase 8 work from the source workspace.

Implemented: versioned decks and draft generation/merge, card viewer/editor/quality reports, private source quizzes and safe CSV, bounded account-scoped offline decks/reviews, saved concept graph/editor/exports, source/deck/practice/course handoffs, explicit insertion into the existing account-scoped Tldraw board, and regeneration that preserves learner annotations/layout.

The port preserves Phase 8A's exact per-card source revision, owner validation, normal page bounds and review idempotency. CSV/quiz reads paginate the whole bounded deck. Missing course-tutor exports and the shared Markdown renderer were restored to match the existing integrated baseline contracts.

Validation on the deployment branch:

- Full web unit suite: 167 passed, 6 PostgreSQL-gated skips.
- Chromium: Studio 7, offline 1, graph explorer/actions 5, existing course candidates/practice 5, Python/PyTorch 3, Game Vault 16 passed.
- Monorepo lint/typecheck and Webpack production build passed.
- Full AI unit/API suite before final compatibility fixes: 444 passed, 28 environment-gated skips. Final results are recorded in the release commit task note.
- Disposable PostgreSQL rehearsed baseline migrations plus exact 0011–0015 D SQL: legacy card IDs, evidence, schedules and reviews preserved; default decks, versions, owner checks and cascades passed. The local PostgreSQL bundle lacks pgvector, so pre-existing vector extension/index definitions were substituted only in the disposable fixture. D migration SQL was unchanged.

Live Clerk/provider/staging, actual pgvector retrieval, and Tesseract tests remain environment gates. They are not represented by the isolated browser transport or local migration rehearsal.
