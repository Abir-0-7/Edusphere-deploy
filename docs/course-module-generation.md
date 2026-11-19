# Phase 8.F04: bounded resumable module generation

F04 generates private lesson drafts from an exact F03 outline approval. It uses
the existing Postgres jobs worker and fallback LLM router. It does not create,
publish or replace a `CourseRelease`; full-course curriculum review, checkpoints
and capstone publication remain F05. Existing catalog releases and enrollments
remain pinned to their current versions.

## Owner workflow and contracts

On `/courses`, open a saved approved outline with no unsaved changes, then:

1. Preview the generation budget for that exact approval ID, revision and hash.
2. Review the bounded stage list and explicitly accept its conservative ceiling.
3. Start generation. Each approved objective becomes one lesson stage in the
   approved module order. No whole module, book or repository is sent at once.
4. Refresh/reopen saved progress, inspect lesson drafts and their exact approved
   source excerpts, and cancel or explicitly resume when appropriate.

Unsaved edits cannot start generation. A saved outline edit invalidates its active
F03 approval but does not silently change a run already bound to an immutable
historical approval. Starting new work requires the current exact approval. Source
deletion revokes the outline, dependent runs and retained generated text.

The API is authenticated and owner scoped:

| Method/path | Purpose |
| --- | --- |
| `POST /api/course-generations/preview` | Preview exact approved scope and policy |
| `POST /api/course-generations` | Retry-safe create using a client UUID and accepted preview hash |
| `GET /api/course-generations` | Bounded paginated run summaries |
| `GET /api/course-generations/{generation_id}` | Progress and validated private lesson checkpoints |
| `POST /api/course-generations/{generation_id}/cancel` | CAS cancellation and lease revocation |
| `POST /api/course-generations/{generation_id}/resume` | Explicit CAS resume within the retained budget |

Python contracts are in `app/course_generation/contracts.py`; shared Zod/TS
contracts are in `packages/types/src/course-generation-api.ts`. OpenAPI includes
all five new path templates. Contract fixtures test strict numbers/booleans,
Unicode, objective/module order, evidence labels, hashes and budget invariants.
The server owns cryptographic verification; browser schemas validate wire shape.

## Bounded untrusted input and reviewed output

A prompt contains the course title/outcome, one objective's ID/title, and only its
already-approved exact evidence quotes. It never includes source snapshot text,
other objectives, repository files or arbitrary fetched context. UTF-8 byte limits
include both system and user messages. Oversized stages fail preview with guidance
to shorten/reapprove scope; evidence is never silently truncated.

Uploaded text, repository code and owner-authored text stay inside an explicitly
untrusted JSON data object, separate from the system instruction. Neither imported
nor generated code executes. Every output must be one strict JSON lesson object
with bounded title, explanation, worked example, question, suggested answer and
unique evidence labels. The server resolves labels only against that objective's
approved pins. Extra publication/editorial/execution fields, invalid evidence,
fences, blank text, invalid Unicode and oversized output fail closed.

Saved drafts always retain `visibility=private` and
`editorial_status=not_reviewed`. Location/schema validation does not prove semantic
correctness. The question/answer is a suggested practice draft, not a validated
assessment or mastery result. Human review and real-provider curriculum quality
remain release gates.

## Durable stages, leases and cancellation

Migration `0020_course_generation.sql` adds owner-scoped runs with immutable
approval references, a bounded JSON state, CAS revision and current queue job ID.
Run creation/resume and jobs-table enqueue happen in the same transaction. There
is no second queue or paid service.

Each stage allocates its logical attempt before any provider request. A validated
output is checkpointed before the worker advances. Completed stages and their
outputs cannot be overwritten, removed or charged a new stage attempt. The
existing jobs lease/heartbeat/reclaim mechanism handles worker death; every
checkpoint verifies the current job and lease while committing its CAS update.

Stable operation keys use the run, objective and logical attempt, independently
of a replacement queue job. A successful raw provider response can be recovered
after a crash before checkpoint persistence. Completed checkpoints are reused
after a crash, cancellation or provider interruption. A crash after the final
lesson checkpoint needs only finalization, with no new provider call/allocation.

Cancellation revokes the queue lease atomically with run state. It is cooperative:
an HTTP call already in progress may finish or time out, but its late lesson cannot
commit. The router checks the claim before another retry/fallback request.
Cancellation cannot undo provider work already transmitted.

Known successful operations are reused. Quota/capacity waits reuse the allocated
attempt. An uncertain operation is never automatically replayed; it stops with
`operation_uncertain` and requires deliberate owner retry. Provider outage or
invalid output also requires explicit retry. A new logical attempt retains all
prior allocations and cannot exceed the original per-stage attempt cap. Changed
policy/model configuration requires a fresh reviewed preview rather than silently
changing the accepted run.

## Budget meaning and configuration

For each logical stage attempt, the estimate mirrors the router's conservative
reservation: UTF-8 prompt bytes plus message overhead and maximum output tokens,
multiplied by the maximum provider-request count. The run ceiling includes every
allowed logical attempt for every stage. These are upper bounds, not actual token
usage, a price or a reservation of future daily quota.

`allocated_tokens` records the retained stage upper bounds, including prior
cancelled/failed/uncertain attempts. Actual usage, conservative uncertain charges,
daily quota admission, rate limits, provider fallback and capacity reservations
remain in the existing router/usage/budget system. Retrying a saved stage does not
reset those ledgers. Cache writes occur only after lesson/evidence validation.

| Setting | Default |
| --- | ---: |
| `AI_SERVICE_COURSE_GENERATION_ENABLED` | `false` |
| `AI_SERVICE_MAX_COURSE_GENERATIONS_PER_USER` | 10 |
| `AI_SERVICE_COURSE_GENERATION_STORAGE_TIMEOUT_SECONDS` | 5 |
| `AI_SERVICE_COURSE_GENERATION_MAX_INPUT_BYTES` | 24000 |
| `AI_SERVICE_COURSE_GENERATION_MAX_OUTPUT_TOKENS` | 1024 |
| `AI_SERVICE_COURSE_GENERATION_MAX_PROVIDER_ATTEMPTS` | 3 |
| `AI_SERVICE_COURSE_GENERATION_MAX_STAGE_ATTEMPTS` | 2 |
| `AI_SERVICE_COURSE_GENERATION_MAX_RUN_TOKENS` | 2000000 |

Global router input/output/provider ceilings can further reduce effective policy.
F03 bounds the scope to at most 30 objectives and 12 modules. Storage is capped
below 2 MiB per run; list pages contain at most 50 summaries. Polling is bounded,
with manual refresh/reopen available after it stops.

## Privacy, rollout and rollback

Writes follow the existing owner -> PDF parents -> retained source versions ->
outline -> run -> job lock order. Source/outline/account deletion cascades the run,
all matching generation jobs and linked raw-operation/validated-cache text. New
operation claims and cache writes verify the surviving owned run, preventing late
responses from recreating deleted content. Usage/budget rows retain accounting
metadata until normal account deletion. Privacy export includes run state and AI
operation/cache run references.

Apply migrations through `0026`, `0027` and `0028` to the intended database before
setting both `AI_SERVICE_COURSE_OUTLINES_ENABLED=true` and
`AI_SERVICE_COURSE_GENERATION_ENABLED=true`. The existing worker must be enabled.
Do not apply this test database URL to production. No production migration,
feature activation, deploy or paid key was performed for this task.

To stop new generation, disable the generation flag and restart workers. Active
queue claims cannot bypass the flag on the restarted process; unhandled queued
generation jobs fail without provider work and may be explicitly resumed after
reactivation. To stop work already running in a live process, use its authenticated
cancel action before restart. Retain the migration/data for recovery; dropping
tables is not a rollback strategy.

## Verification

The fixture transport makes deterministic HTTP responses through the real router,
admission, operations, budget, cache and worker layers. It does not contact a
hosted model or claim that generated curriculum quality was approved.

```powershell
# From apps/ai-service; disposable UTF-8 PostgreSQL only.
$env:STUDYVAULT_SOURCE_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/studyvault_f02_acceptance'
.\.venv\Scripts\python.exe -m pytest tests/test_course_generation.py tests/test_course_generation_pg.py tests/test_course_generation_contracts.py tests/test_course_generation_safety.py tests/test_rag.py -q
```

```powershell
# From repository root.
pnpm --filter @studyvault/web exec playwright test --config e2e/course-generation-isolated.config.ts
```

Acceptance covers worker death before/after checkpoint persistence, successful
operation reuse, finalization after all checkpoints, outage/resume, uncertain
operations, retained budget, quota waits, cancellation before another provider
attempt, stale actions, source-deletion races, atomic queue rollback, ownership,
fixed input/output bounds, default-off/errors, and unchanged published content.
The existing offline RAG regression/eval-scoring tests run with the Python suite;
retrieval behavior is unchanged. F04 additionally has independent adversarial
prompt/output guard tests. Real-provider groundedness and human curriculum review
remain separate from deterministic recovery acceptance.

Verified on 2026-11-19 on branch `codex/phase8f-resumable-generation`:

- Full Python suite: **1,161 passed, 32 skipped**; Ruff passed.
- Monorepo lint, typecheck, tests and production build passed. Shared types:
  **162 tests**; web: **253 passed, 5 skipped**, including 9 new generation client
  checks. Other package suites retained their existing passes/skips.
- F04: **17 PostgreSQL acceptance tests**, **100 Python wire parity tests**,
  **12 independent prompt/output safety tests**, and **17 worker/API/unit tests**.
- **4 F04 Chromium journeys** and **4 F03 browser regressions** passed. Desktop
  1440px and mobile 390px progress/expanded lesson captures were visually inspected.
- No new production data was written. Existing staged work remains preserved;
  task changes are uncommitted on the separate F04 branch. F05 remains next.
