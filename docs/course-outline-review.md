# Phase 8.F03: source coverage and editable outline approval

F03 adds a private planning workflow on `/courses`, separate from the immutable
published course releases. A learner selects prepared PDF/repository versions,
authors objectives/modules, links exact evidence, reviews coverage/conflicts and
approves one saved revision. It does not generate lessons, publish a course or
create an editorial role. Those are later tasks.

## Activation and data contracts

The feature defaults off with `AI_SERVICE_COURSE_OUTLINES_ENABLED=false`. Apply
F01 migration 0026 and F03 migration `0019_course_outlines` before enabling it.
The disabled planner displays an unavailable notice while the existing catalog
continues to work. No migration or feature enablement is applied to production
as part of implementation/testing.

The version-one models in `app/course_outlines/contracts.py` and
`packages/types/src/course-outline-api.ts` cover plans, server-derived coverage,
CAS edits, explicit approval, immutable history, source summaries and pagination.
Shared Python-generated wire fixtures live in `contracts/course-outline-api.json`.
All new requests reject unknown fields, including publication/editorial claims.

Plans contain a title/outcome, up to eight immutable source version IDs/hashes,
30 stable objectives, 12 ordered modules and 20 explicit conflict flags. Each
objective has prerequisites, an owner effort estimate, up to four exact source
pins and a human review state. Module references are unique; prerequisites must
reference known objectives and form a DAG. The canonical UTF-8 plan is capped at
128 KiB. Individual source text remains in F01 snapshots; the plan retains only
the exact supporting quotes and locators.

## Coverage means linked evidence, not automatic factual judgment

The server verifies ownership, selected version hashes and every evidence pin's
segment, full typed locator and exact quote before create/edit/approval. Sources
are loaded once per selected version for this validation, not once per pin.
There are no LLM/retrieval/prompt changes in this task; imported text never becomes
instructions. Outline drafting and conflict review are authored learner actions.

The coverage report derives:

- **Missing support:** an objective has no linked evidence.
- **Multi-source overlap:** more than one selected version supplies evidence for
  the same objective. This is neutral coverage overlap, not proof of duplication,
  agreement or contradiction.
- **Needs owner review:** an objective has not been explicitly reviewed.
- **Unassigned objectives:** an objective is missing from the module sequence.
- **Prerequisites taught later:** the flattened module/objective order places a
  mapped prerequisite after its dependent objective.
- **Unresolved conflicts:** the owner flagged two distinct linked excerpts for an
  objective and has not recorded a resolution explanation.
- **Unused sources:** selected versions are not linked to any objective. This is
  a visible warning, not an unsupported claim or an approval blocker by itself.
- **Estimated effort:** the server sums the owner's per-objective estimates.
  This is not measured completion time, mastery or career readiness.

Approval is blocked by missing evidence, unreviewed objectives, missing module
assignments, reversed prerequisite order or unresolved conflict flags. A learner
can save an incomplete plan, remove unsupported objectives by editing the
scope, add exact support, reorder modules, or record a reasoned conflict
resolution. Source location checks do not replace an owner/editor's assessment
that a quote actually supports the intended teaching claim.

## Exact revision approval and publication boundary

Create uses a client UUID for retry-safe identity. The same ID/content returns
the same saved draft; using it for different content returns 409. Updates require
the current `expected_revision`, increment the revision and clear active approval.
No stale save is silently merged or overwritten.

Approval requires `expected_revision`, the saved `content_hash` and strict
`reviewed_evidence=true`. The UI adds a separate acknowledgement for the exact
saved outline. Local edits disable approval until saved and rechecked. The
server revalidates current sources and readiness under transaction locks, then
appends one immutable approval snapshot and marks that revision owner-approved.
Retries return the same receipt. Any later edit needs a new approval; previous
approval snapshots remain available as history.

Every outline/approval response remains `visibility="private"` and
`editorial_status="not_reviewed"`. These are server-controlled response fields.
Owner approval is not publication or editorial authorization. There is no outline
to catalog conversion/publication endpoint, and the existing course contract and
store still reject private source pins in catalog releases. F04 can build on the
exact approved artifact; it must not interpret a draft or owner approval as a
public release.

## Persistence, isolation and resource bounds

Migration 0027 adds `course_outlines`, `course_outline_sources` and immutable
`course_outline_approvals`. All rows have explicit user ownership; composite
foreign keys enforce matching outline/source owners. Source versions receive an
additive `(id,user_id)` uniqueness constraint for those FKs. Existing document,
card, course release, review and enrollment data is not rewritten.

Source links retain exactly the union of the current plan and approved snapshot
history. Deleting a source version (including a parent PDF cascade) deletes its
dependent outline and approvals, even if the source is retained only by an old
approval. A source removed from a never-approved draft is no longer retained and
its later deletion does not destroy the revised outline. Deleting an outline
does not delete its sources or other study progress. Account deletion cascades all
outline data; privacy export includes plans, source links and approval snapshots.

Writes serialize the owner, lock all PDF parents before retained source versions,
then lock/CAS the outline. Approval/source deletion races cannot recreate removed
private data. Reads check retained source IDs/ownership and selected hashes in
bulk on the existing timed connection. They derive coverage from the validated
persisted plan and the database's immutable-source guarantee, avoiding full
multi-megabyte historic source loads and new connections merely to list drafts.
Creates, edits and approvals still perform full exact-pin validation.

Defaults are configurable and validated at startup:

| Environment setting | Default |
| --- | ---: |
| `AI_SERVICE_MAX_COURSE_OUTLINES_PER_USER` | 20 |
| `AI_SERVICE_MAX_COURSE_OUTLINE_APPROVALS` | 10 |
| `AI_SERVICE_COURSE_OUTLINE_STORAGE_TIMEOUT_SECONDS` | 5 |

Approval history caps at the configured maximum (protocol maximum 50). Plans
have a 256 KiB DB JSONB text guard; approval snapshots have a 512 KiB DB guard.
Pagination pages contain at most 50 summaries with explicit Load more controls.
The planner can prepare a legacy parsed PDF through the existing F01 endpoint;
repository imports use the separate F02 endpoint and flag. No paid key, service,
original-file retention change or queue system was added.

## API and learner workflow

| Method/path | Action |
| --- | --- |
| `GET /api/source-versions` | Owner's paginated source summaries |
| `GET /api/source-versions/{id}` | Existing exact source snapshot |
| `GET/POST /api/course-outlines` | List summaries / create private draft |
| `GET/PUT/DELETE /api/course-outlines/{id}` | Read / CAS edit / delete owned outline |
| `POST /api/course-outlines/{id}/approve` | Approve exact reviewed revision/hash |
| `GET /api/course-outlines/{id}/approvals` | Immutable owner approval history |

The planner resets its workspace on account changes, keeps local edits on save
failure or 409, and requires explicit reload to replace them. It displays exact
source excerpts and locators as text, supports objective/module editing and
ordering, and labels the saved coverage report by revision. Source and outline
lists use bounded pagination; opening an older outline can load its pinned
sources even when they are outside the first page.

## Verification

The two-source fixture contains a book/PDF and pinned repository. It exposes one
unsupported objective, multi-source overlap and an unresolved system-boundary
conflict. Acceptance removes the unsupported scope, resolves/reviews evidence,
approves one exact revision, reloads it, inspects history and invalidates approval
with a later edit. Separate tests cover reversed prerequisite order, strict wire
types, unauthorized sources, stale hashes/revisions, quotas, races, immutable
history, bulk metadata reads, deletion cascades and transaction timeout rollback.

Real Chromium acceptance uses the actual in-memory FastAPI router/store on ports
4333/4334, tests stale-save recovery and account switching, and checks the 390px
layout. Approved-state screenshots at 390px and 1440px are visually inspected.
These fixtures do not replace hosted Clerk/staging or human curriculum review.

```powershell
# From apps/ai-service; use a disposable UTF-8 PostgreSQL database only.
$env:STUDYVAULT_SOURCE_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/studyvault_f02_acceptance'
.\.venv\Scripts\python.exe -m pytest tests/test_course_outlines.py tests/test_course_outlines_pg.py tests/test_course_outline_contracts.py -q
```

```powershell
# From the repository root.
pnpm --filter @studyvault/web exec playwright test --config e2e/course-outline-isolated.config.ts
```

Verified on 2026-11-19 on branch `codex/phase8f-outline-approval`:

- Full AI service suite: **1,015 passed, 32 skipped**; Ruff passed.
- Monorepo lint, typecheck, tests and production build passed.
- F03 has **4 passing Chromium journeys** and **12 passing PostgreSQL acceptance
  tests**, plus memory/API and Python/shared-TypeScript contract parity coverage.
- Approved-state captures at 390px and 1440px were inspected for readability and
  horizontal overflow.

The existing pipeline test harness now advances its synthetic claim time to a
pending job's scheduled retry. This removes a Windows clock-resolution flake
without altering production worker/retry behavior. Existing staged work is
preserved; F03 is uncommitted on its task branch. Database validation used
disposable schemas only. No production migration, feature activation or deploy
was performed. F04 remains the next task.
