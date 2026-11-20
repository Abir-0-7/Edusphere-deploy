# Phase 8.A05 and 8.B persistence acceptance

Verified locally on 2026-11-20. Phase 8.F was excluded from this work.

## 8.A05 provider decision

The configured primary → Groq → Hugging Face failure-vector and router/settings
tests pass, including final-fallback 402, 403, 429, 503 and timeout cases that
terminate after the three configured providers. Hugging Face documents the OpenAI-compatible chat endpoint at
`https://router.huggingface.co/v1/chat/completions`; the current adapter can use
that protocol without adding another SDK. See the official
[Inference Providers documentation](https://huggingface.co/docs/inference-providers/en/index)
and [chat-completion API](https://huggingface.co/docs/inference-providers/en/tasks/chat-completion).

As checked on 2026-11-20, standard free accounts receive no included Inference
Providers credits. Hosted requests require purchasing credits or using a paid
subscription. The previous $0.10 free allowance is absent from current pricing.
[Hugging Face pricing and billing](https://huggingface.co/docs/inference-providers/pricing)

On 2026-11-20 the workspace owner confirmed the project uses Logfare and Groq.
The approved provider order is `logfare,groq`. The router exhausts that list and
returns its existing clear failure when both providers are unavailable. The
Hugging Face compatibility slot remains inactive under this configuration.
Provider routing and exhaustion are verified with simulated responses. Current
account capacity and hosted failure behavior remain part of the deployment
verification.

## 8.B01 / 8.B02 / 8.B04: local persistence acceptance

The existing course schema migration (`0009_phase8c.sql`) and its parent
migrations now run in a generated schema on the existing local disposable UTF8
PostgreSQL server. The script accepts only a loopback server, rejects non-UTF8
databases, redirects explicit `public` foreign-key references into the generated
schema, and removes only that schema in `finally`. Existing application/F data
and database settings are not modified.

The local PostgreSQL distribution lacks pgvector. The unrelated legacy embedding
column is represented as text in this harness; vector extension/HNSW creation is
omitted. All **116 other SQL statements**, including all **33 statements** in the
course migration, execute. This is course migration/persistence acceptance;
production pgvector migration, backup restore and rollback remain **8.H04**.

Run from the repository root:

```powershell
& .\apps\ai-service\.venv\Scripts\python.exe apps/ai-service/scripts/verify_course_persistence.py --database-url postgresql://postgres@127.0.0.1:55439/studyvault_d01_utf8
```

Result: **83 passed**, zero skipped, one existing Starlette/httpx deprecation
warning. The generated schema was removed. Coverage includes:

- Published release immutability and parent-owner mismatch rejection.
- Private draft owner access, exclusion from public listings, cross-account
  rejection, and blocked draft enrollment on fresh database connections.
- Authored teaching-block fixtures, objective-cycle and invalid-evidence
  rejection, exact materialized chapter/chunk locators, and concurrent enrollment
  producing one owner-scoped source copy.
- Committed exercise state restored by a fresh store/connection after a new
  release is saved; the original enrollment retains its pinned release/title.
- Action replay after reconnection produces one attempt row; stale writes roll
  back, cross-owner access fails, and hint/reveal does not award mastery.
- Existing SQL/Git simulation and assignment persistence, without executing
  learner SQL, shell commands or Python, or manufacturing mastery.
- Router failure/retry/circuit/cache behavior and provider settings validation.

New regressions are in `apps/ai-service/tests/test_pg_courses.py` and
`apps/ai-service/tests/test_router.py`. The harness
runs that file plus `test_courses.py`, `test_router.py`, and `test_settings.py`.
Focused lint:

```powershell
cd apps/ai-service
& .\.venv\Scripts\python.exe -m ruff check scripts/verify_course_persistence.py tests/test_pg_courses.py tests/test_router.py
```

Result: **All checks passed**. Installed versions inspected before edits:
psycopg 3.3.9, pytest 9.2.0, httpx 0.28.1, pydantic 2.14.3 and respx 0.23.1.
Reviewed the current official
[psycopg connection usage](https://www.psycopg.org/psycopg3/docs/basic/usage.html),
[connection-string helpers](https://www.psycopg.org/psycopg3/docs/api/conninfo.html),
[SQL identifier composition](https://www.psycopg.org/psycopg3/docs/api/sql.html),
and [pytest invocation](https://docs.pytest.org/en/stable/how-to/usage.html).

These tests provide the previously missing local disposable-database evidence
for 8.B01/8.B02/8.B04. They do not supply human curriculum/assessment or tutor
grounding approval for **8.B03 / 8.B10 / 8.C05**, live provider capacity, signed-in
staging, or any release/deploy authorization. Repository-wide quality checks are
recorded separately by the coordinating task.

Abir approved the four mini releases covered by the editorial packet on
2026-11-20. SQL Query Foundations and Git Foundations now appear in the local
catalog through the same publication path as Python Foundations and PyTorch
Fundamentals. A regression test covers the failed PyTorch refusal example
recorded in the packet. The approval supplies no per-claim tutor support rate
for 8.B10. [Editorial packet](curricula/mini-course-editorial-review-packet.md)
and [approval receipt](curricula/mini-course-human-review.json).

## 8.H01: workspace quality snapshot

The coordinated 2026-11-20 local snapshot passes the following checks. These
commands compile and test locally; no deployment or production migration ran.

| Check | Result | Evidence log |
| --- | --- | --- |
| `pnpm lint` | 7/7 Turbo tasks pass | `output/phase8h01-final-lint.log` |
| `pnpm typecheck` | 11/11 tasks pass, including shared whiteboard API exports and final browser fixtures | `output/phase8h01-final-typecheck-verified.log` |
| `pnpm test` | 7/7 tasks pass; 516 tests pass, 7 optional database tests skip | `output/phase8h01-final-test.log` |
| `pnpm build` | 8/8 tasks pass; Next.js compilation, TypeScript and page generation pass | `output/phase8h01-final-build-verified.log` |
| AI service Ruff | All app/tests/scripts checks pass | `output/phase8h01-python-lint.log` |
| AI service `pytest -q` | 1,243 pass, 83 environment-gated skips | `output/phase8h01-python-test.log` |

The first sandbox test launch failed before running tests because Vitest workers
could not spawn (`EPERM`). The authorized subprocess run passed; build used the
same subprocess permission. Initial lint found generated Playwright transform
JavaScript under `apps/web/.tmp-playwright`; the shared lint configuration now
ignores that generated directory. Initial typecheck reported whiteboard-fixture
ID narrowing and a nullable Phase 8.F approval access. Their owning tasks updated
those files during coordination; this acceptance worker made no Phase 8.F fixes.
The requested subsequent lint/typecheck runs pass. Final test/build validation
was repeated after E07 renderer/shared-contract changes. A newly added browser
commit-race test initially caused a Window-field type error during that build;
the owning task guarded its optional field and the final build/typecheck passed.
The final TypeScript test totals are web 253, types 164, game engine 65, realtime
22, code runner 7 and database 5, with five web/two realtime optional DB skips.

The checks emit non-fatal Turbo cache-access warnings and the existing
Starlette/httpx deprecation warning. Database skips in the broad suites remain
explicit; the separate B persistence harness above executes its eight real
PostgreSQL tests without skips. Browser, RAG, staging, accessibility, failure-drill,
restore, pilot and human-review gates remain separate. **8.H01 is not declared
complete by this workspace snapshot alone.**
