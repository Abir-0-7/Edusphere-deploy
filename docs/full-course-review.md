# Phase 8.F05: full-course candidate and capstone review

Status on 2026-11-20: **Abir explicitly approved the entire unchanged human
review packet with no corrections and authorized adding it to the local catalog.**
The completed receipt is recorded, and a hash-guarded published copy is now in
`catalog()`. Publication acceptance passed and F05 is complete; F06 is now current.
No production data, feature flag or deployment was changed.

The confirmation was received at 2026-11-20 00:03:57 +06:00. This is the receipt
time, not a claim about the review's duration. Per-item decisions transcribe the
explicit entire-packet approval; no separate item-specific findings were supplied.

## Concrete candidate

The existing design proposes Practical Python Foundations as a full course. F05
now provides that original authored draft through
`app.courses.full_course_candidate.practical_python_foundations()`:

- Four modules with three teaching/workshop lessons and one explicit composite
  checkpoint lesson each: 16 lessons, 12 teaching objectives and 80 exercises.
- Seventeen authored sources/evidence records, versioned by the release hash.
- A self-contained study-session analyzer capstone with fixed input records,
  four structured submission sections, four linked rubric criteria and selected
  evidence references.
- Python Foundations or its existing equivalent diagnostic as prerequisite.
- No executable Python/SQL activity or runtime dependency. Code and pseudocode
  remain inert text throughout this course.

Release ID: `78afc1e3-47dc-5e13-a73b-9264662bdb20`.

SHA-256: `8d0d00657b631698c83363fa4f68fbc3d8f7a24ce75d66090310c32d9fb87f1e`.

That is the approved **draft** hash. Publication changes only `status` to
`published`, producing release hash
`6950baaf82af5901a9905bc6985a453012b2439b0a36b951f9625df09d3f3718`.
`full_course_release.py` refuses publication if the canonical draft hash changes.

The approximately 5,000 rendered instructional words include substantial paper
activities and original examples. The 840-minute estimate includes workshops,
checkpoints, project and revision, and is **not measured learner duration**. The
human reviewer must decide whether the scope and estimate are appropriate. See
`docs/curricula/practical-python-foundations.md` for the curriculum rationale,
module map, capstone contract and estimate breakdown.

## Progress and project semantics

Module checks are explicit lessons in the existing sequential course engine.
`checkpoint_ids` remain alternative fresh questions; they are not misrepresented
as a list of questions all of which the engine requires. The final checkpoint
combines the full course's objectives. Revealing a solution cannot count as an
independent checkpoint pass.

Optional `required_assignment_ids` let a course require a submitted capstone
before activity completion. Submission requires all independent lesson/module
checkpoints, every authored section within its length bounds, and authorized
assignment evidence. Drafts may be saved earlier. Saving a submitted required
project as a draft reopens activity completion.

The server checks completeness, not semantic correctness of free text. A submitted
project is **ungraded**, has not executed and grants no project mastery, score or
XP. The UI says that explicitly. Completion means lesson checkpoints plus the
required submission activities are complete; it is not a certification that the
program works or the learner is career-ready.

The public rubric links each criterion to objectives and evidence and gives
review guidance. The learner can inspect those links, save/reload sections and
selected references, and recover after stale revisions or lost responses. An
unchanged retry keeps the same action ID and revision; explicit refresh preserves
local edits and enables a deliberate CAS retry after conflict.

## Contracts and persistence

`CourseAssignment` adds optional sections, criteria and an evidence requirement.
Assignment requests/responses and sessions carry structured section text and
selected evidence IDs. `CourseDetail` exposes required assignment IDs. Python,
shared Zod/TS and OpenAPI describe the same fields.

Existing empty/false metadata is excluded from release serialization, preserving
legacy published release hashes. Old assignment action fingerprints omit empty
new fields so saved idempotency records still replay. Existing optional projects
keep their old behavior.

The existing owner-scoped enrollment JSONB stores the new draft/status fields.
There is no new table or migration. Ownership, CAS, exact action replay, failed
validation rollback and account deletion retain their existing boundaries. New
submission fields reject NUL, lone surrogates, unauthorized/duplicate evidence,
unknown sections, oversized work and client-supplied grading claims.

## Required human review

The roadmap F05 row makes curriculum review a prerequisite for publication. Its
grounding requirement and `TASKS.md` 8.H01 explicitly require human review rather
than another model's approval. Abir's explicit approval is recorded in
`docs/curricula/practical-python-human-review.json`; the original pending form is
preserved separately. No model's assessment has been substituted for that approval.

Prepared artifacts:

- `docs/curricula/practical-python-review-packet.md`: readable editor-only review
  with all teaching blocks, all keys, the capstone and source inventory.
- `docs/curricula/practical-python-review-packet.json`: matching exact-version
  original form with all human judgments unset.
- `docs/curricula/practical-python-human-review.json`: the completed receipt,
  transcribed from Abir's explicit approval and local catalog authorization.

The scope includes all 40 teaching blocks, all 80 assessment keys, all 16 lessons,
all four rubric criteria, and all 17 evidence records including capstone-only
evidence. The exporter rejects orphan/shared assessment references rather than
quietly omitting a key. Altered/deleted sample rows, questions, keys or release
hashes cannot be reused as the same review scope.

Mechanical checks find 40/40 teaching references and 17/17 evidence excerpts in
their whitespace-normalized authored sources. **This does not validate semantic
support or resolve an opaque locator.** The completed receipt records Abir's
approval of 40/40 claim groups and 17/17 locators, all 80 keys, all 16 lessons and
all four rubric criteria. The 100% recorded support rate is a transcription of
that entire-packet attestation, not an independently measured model-quality study.
Supporting URLs are references, not automatically verified judgments.

A named human must review the exact packet, record a timezone-aware date, and:

1. Confirm rights/allowed use, curriculum sufficiency, the planning estimate,
   disabled execution and capstone cases.
2. Mark every instructional block supported/unsupported with a supporting
   reference or rationale; the recorded target is at least 95% support.
3. Confirm each evidence locator, every assessment key and no unresolved key
   errors, and approve each rubric criterion.
4. Record corrections. Content changes produce a new release hash and need fresh
   review scope before publication.

Human decisions may be recorded in a completed JSON copy, or supplied as explicit
review findings for transcription. An automated check can verify the record's
completeness and binding; it cannot determine that a person actually performed
the review or act as that person.

```powershell
# From apps/ai-service; validates only, never publishes.
.\.venv\Scripts\python.exe -m scripts.export_full_course_review --check-review PATH_TO_COMPLETED_COPY.json

# Fresh exports use exclusive creation and refuse existing output paths.
.\.venv\Scripts\python.exe -m scripts.export_full_course_review --output PATH_TO_NEW_PENDING_PACKET.json
```

The checker leaves `published=false` even for a structurally complete review.
There is no new reviewer-auth endpoint or automatic catalog promotion. The separate
catalog change was explicitly authorized by Abir; staging/launch gates remain.

## Verified automated acceptance

Branch: `codex/phase8f-full-course-review`. Checks on 2026-11-19:

- Full Python suite: **1,239 passed, 32 skipped**; Ruff passed.
- Monorepo lint, typecheck, tests and production build passed. Shared types:
  **164 tests**; existing web suite: **253 passed, 5 skipped**.
- F05 backend: **23 tests**, including **three disposable PostgreSQL** cases;
  structured persistence/replay, concurrent/stale submission, rollback,
  ownership and account deletion verified.
- Content: **30 tests**, including independent authored capstone vectors and
  hand-recorded numeric/order/validation keys.
- Editorial: **25 tests**, including exact scope, pending human gates, strict
  review fields, orphan-key detection and exclusive output preservation.
- **Two full-course Chromium journeys** passed: all 16 lesson/module gates,
  prerequisite diagnostic, assistance/fresh checkpoints, capstone draft/reload,
  evidence/submission, owner isolation, lost-response replay and stale recovery.
- **Three existing candidate-course browser regressions** passed. Mobile 390px
  and desktop 1440px capstone/module-progress captures were visually inspected.

The isolated browser fixture promotes only an in-memory copy for acceptance and
labels itself as a fixture. Its private test-driver keys are in ignored local
test output, not a learner API. At the original 2026-11-19 acceptance the catalog
was unchanged. On 2026-11-20 Abir authorized the separate repository publication;
both browser journeys were rerun against the actual approved default catalog and
passed. These automated results do not replace the recorded human approval.

```powershell
# Disposable UTF-8 PostgreSQL only, from apps/ai-service.
$env:STUDYVAULT_SOURCE_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/studyvault_f02_acceptance'
.\.venv\Scripts\python.exe -m pytest tests/test_full_course_content.py tests/test_full_course_progress.py tests/test_full_course_editorial.py -q
```

```powershell
# From repository root.
pnpm --filter @studyvault/web exec playwright test --config e2e/full-course-isolated.config.ts
```
