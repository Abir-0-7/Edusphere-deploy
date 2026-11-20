# Guided-course tutor upgrade

Phase 8.B11, November 20, 2026. This release changes the guided-course tutor;
existing provider models, quotas, database schema and account ownership remain intact.

## Changes

- Explain simply and Show a worked example fill an editable draft, focus the
  question and wait for Ask tutor. Go deeper is available after a cited answer
  from the active lesson. Suggestions cannot overwrite a draft or bypass the
  fresh independent checkpoint.
- Lesson prompts select active explanation/example evidence. Referential
  follow-ups inherit only the preceding assistant answer's active evidence IDs.
  The model receives cited public teaching blocks so it can explain the lesson's
  actual example. Assessment prompts and private answer keys are excluded.
- Canonical and legacy lesson refusals save no citations. Streamed refusal text
  stays identical in token and completion events so the browser accepts the turn.
  The production tutor retains its strict Pydantic output boundary.
- A provider outage before any output produces a labeled, cited source excerpt
  that survives reload and replay. Quota/admission/accounting failures remain
  errors. Interrupted, oversized, length-limited or malformed streams do not save
  a partial conversation or advance the lesson.
- Uncertain provider outcomes remain conservatively accounted. The browser checks
  saved session state before allowing an explicit retry under a fresh request ID;
  an ambiguous transport failure retains its original ID for safe replay. No
  automatic new provider request or quota reset is performed.

## Verification and release scope

The source-workspace implementation passed lint, typecheck, tests and build,
1,330 Python tests (88 environment-gated skips) and eight Chromium journeys.
The unchanged 25-case PostgreSQL FTS/RRF corpus returned recall@5 1.00 before
and after the prompt changes, with both owner/document isolation controls passing.
This measures source retrieval, not human grounding of generated answers.

The release port is independently checked against the current production source,
preserving its newer course runtime and strict JSON validation. See the matching
TASKS.md entry for the final release verification results.

Release verification on the integrated main baseline:

- Uncached monorepo lint, typecheck and tests: all 25 tasks passed.
- Production build: all eight tasks passed using non-secret CI placeholder env.
- Full Python suite: 1,248 passed, 84 environment-gated skips; Ruff clean.
  An existing pipeline retry timing test failed once under concurrent load and
  passed on the complete-suite rerun; no pipeline production code was changed.
- Chromium course, tutor and practice suite: 14 journeys passed, including
  keyboard prompts, saved citations, short refusal parsing, transport retry IDs,
  interrupted-response recovery, saved-state read failure, Stop and checkpoints.
- Five streaming-client unit regressions passed within the monorepo run.

The user authorized production deployment and publication to main. A main-branch
push can trigger the configured web deployment; Render API auto-deploy is off and
requires a separate manual release. A Git push is not evidence of API deployment,
hosted provider availability, human grounding, or completed Phase 8 release gates.
No migration or provider configuration change is required for this patch.
