# Qualified code review and academic handoffs — 8.E10

Implemented locally on 2026-11-20. The Tools page now uses the account-keyed
`CodeReviewWorkspace`. It accepts a bounded snippet, language and optional input
sizes/helper-operation context. A separate learner-supplied reference is retained
for the lesson note; it is labeled unverified and is not sent to the model.

The review is an explicit static estimate. No code, SQL, shell command, imported
module or benchmark is executed. The UI explains that finite runtime measurements
cannot prove an asymptotic bound. It renders the estimate, explanation, assumptions,
ordered reasoning, valid line notes and possible improvements using the existing
sanitized Markdown renderer.

## Contract and provider behavior

`POST /api/code-review` retains its existing fields and adds optional `context`
(1,500 characters maximum). Code is limited to 6,000 characters and language to
100. The shared Zod and Python contracts now require one to six assumptions and
one to six steps, each bounded to 300 characters; the other response fields and
collections are bounded as well. Unknown fields in generated output are rejected.

The prompt asks for input-size variables, case, helper costs and space conventions,
and asks for `unknown` where dependencies prevent a supported bound. Code,
language and context remain JSON string values inside the untrusted-data wrapper,
separate from the system prompt. No source reference is invented by the provider.

The existing fallback router continues to own calls, admission, budgets, usage,
timeouts and retry policy. The route uses `code-review-v2` cache scope. A legacy
unqualified result, blank/oversized reasoning, malformed JSON or a line note that
does not resolve produces an explicit unknown result. Invalid generated text is
not accepted into the durable response cache. Provider outages preserve the input
and show a retryable error. Client cancellation, edits and account changes invalidate
late responses; cancellation does not claim that an already-started provider call
was never billed.

These checks validate the output structure and request behavior. They do not prove
the model's semantic answer correct, and no live-provider quality percentage is
claimed.

## Chosen lesson notes and references

The learner can edit the complete note draft, then choose an existing course
enrollment and lesson. The draft includes code, learner context and reference,
estimate qualifications, assumptions, steps and line notes. Nothing saves until
the learner selects the target and presses **Add to lesson notes**. Drafts over
5,000 characters must be shortened explicitly; code and notes are never silently
truncated.

The bibliography preview also offers the same course/lesson handoff for its
displayed citation and bibliography. Its note pins the formatting style at preview
creation, carries the exact displayed text and states that supplied metadata is
not independently verified. No metadata lookup or new source claim is added.

Both handoffs use `CourseNoteHandoff`: the account is pinned across the read/write,
the current enrollment revision protects other edits, existing notes/bookmarks
are preserved, and a dropped response can be reconciled before retrying. Existing
course API authorization remains authoritative. They save ordinary private notes,
not curriculum edits, assessment keys, mastery or public catalog content.

## Verification

Installed versions inspected before the APIs were used: React 19.3.1, Zod 4.6.7,
Pydantic 2.14.3, HTTPX 0.28.1 and FastAPI 0.162.6. Current official
[React effect documentation](https://react.dev/reference/react/useEffect),
[Zod schema documentation](https://zod.dev/api) and
[Pydantic models documentation](https://docs.pydantic.dev/latest/concepts/models/)
were read. This slice adds no framework route conventions beyond the existing
FastAPI route and adds no dependency, migration, paid key or Phase 8.F change.

Run the focused checks from the repository root:

```powershell
pnpm --filter @studyvault/types test -- tests/tool-api.test.ts
pnpm --filter @studyvault/web test -- tests/code-review-client.test.ts tests/citation-toolkit.test.ts
pnpm --filter @studyvault/web exec playwright test --config e2e/code-review-isolated.config.ts
pnpm --filter @studyvault/web exec playwright test --config e2e/bibliography-isolated.config.ts
pnpm --filter @studyvault/web typecheck
```

From `apps/ai-service`:

```powershell
.venv/Scripts/python.exe -m pytest tests/test_code_review_qualified.py tests/test_phase4.py tests/test_tool_contracts.py tests/test_admission_api.py tests/test_rag.py -q
.venv/Scripts/python.exe -m ruff check app/ai/code_review.py app/ai/tool_contracts.py tests/test_code_review_qualified.py tests/test_phase4.py tests/test_admission_api.py
```

Results: 70 Python tests, four shared contract tests, 11 client/citation tests,
three code-review Chromium journeys and all five bibliography Chromium journeys
passed. Focused ESLint, Ruff, shared-types and full web typechecks passed. The
Python run includes the existing retrieval/citation/eval-score regressions; the
code-review qualification fixtures separately cover prompt injection, malicious
delimiter text, no execution, missing assumptions, empty steps, invented lines,
oversize inputs and cache rejection. These mocked-provider checks are local
safety/contract evidence, not a measured live-model evaluation or staging evidence.

The isolated browser exercises the production component and course client with
validated fixture transport. It verifies the supplied reference and code-review
reasoning save to a selected lesson different from the current one; provider
failure and malformed-response recovery preserve code; edits, cancel and account
changes discard late responses even when a test transport ignores abort.
The bibliography browser verifies exact APA citation/locator/bibliography handoff
while preserving the enrollment revision and bookmarks. The 390px code-review
capture was visually inspected at
`apps/web/test-results/code-review/qualified-handoff-390.png`; all required labels
and controls are readable and the page has no horizontal overflow.
