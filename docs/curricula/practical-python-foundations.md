# Practical Python Foundations: F05 full-course candidate

Prepared 2026-11-19; reviewed and authorized for the repository catalog by **Abir
on 2026-11-20** with no corrections. No production deployment is authorized.
The canonical review constructor remains
`app/courses/full_course_candidate.py::practical_python_foundations` (draft).
`full_course_release.py::practical_python_release` publishes only its approved
hash and is included in `catalog()`. The completed human receipt is
`practical-python-human-review.json`.
Original teaching text, examples and assessments were prepared with model
assistance. Automated schema, arithmetic and learning-flow tests are supporting
evidence; they do not replace a named human's editorial judgment.

This implements the planned full-course candidate in the platform design. The
earlier user-requested Python Foundations and PyTorch Fundamentals remain separate
Mini courses. This candidate builds on Python Foundations or the existing
equivalent diagnostic rather than changing either mini course's published hash.

## Scope and intended outcome

Design, trace and justify a study-session analyzer, with explicit input contracts,
deterministic transformations, decomposed functions, independently justified test
cases and source-linked explanations. The learner produces a reviewable project
artifact; StudyVault does not execute the submitted Python, SQL or shell text.
The candidate neither claims to measure runtime correctness nor certifies mastery
or career readiness from lesson activity.

There are 12 substantive teaching/workshop lessons and four explicit composite
checkpoint lessons, grouped into four modules. Each teaching lesson includes an
explanation, worked static example, extended paper activity, deterministic
practice and four fresh checkpoint alternatives. The learner needs one unaided
correct active alternative per lesson; the four IDs are **alternatives**, not four
separate required tests. A hint or solution reveal does not earn an independent
checkpoint pass. The final checkpoint combines the whole course's 12 objectives.

The teaching blocks contain about 5,000 words, including worked examples and
review recaps. The **840-minute / 14-hour estimate** is a planning allowance for
active work, not the time needed merely to read those words:

| Activity | Planning allowance |
| --- | ---: |
| 12 teaching/workshop lessons, including written trace/design exercises | 12 × 35 = 420 minutes |
| Four composite checkpoint and correction sessions | 4 × 20 = 80 minutes |
| Capstone specification, pseudocode, manual trace and independent test plan | 240 minutes |
| Consolidation, corrections and project review/revision | 100 minutes |
| Total | 840 minutes |

These durations have not been validated with learners. A human reviewer must
judge whether the content and assigned work justify the Full scope and estimate.
Fast completion of static questions does not prove that the extended work occurred.

## Curriculum map

| Module | Lesson ID | Teaching objective / checkpoint |
| --- | --- | --- |
| 1: Reliable input contracts | `pp-contract` | State required fields, exact types, inclusive boundaries and whole-dataset failure behavior |
| | `pp-records` | Distinguish list positions, dictionary keys, aliases and fresh records |
| | `pp-validation` | Normalize deliberately and validate all rows, strict flags and unique normalized IDs |
| | `pp-module-1-checkpoint` | Combine type, normalization and dataset-acceptance reasoning |
| 2: Deterministic transformations | `pp-filter` | Trace selection, count and summation with a loop invariant |
| | `pp-group` | Accumulate repeated topics without overwriting or mutating inputs |
| | `pp-order` | Derive a descending-total order with an explicit ascending-topic tie key |
| | `pp-module-2-checkpoint` | Reconcile a mixed-completion report's total, grouping and order |
| 3: Functions and testable design | `pp-functions` | Separate local returned results from shared state and input mutation |
| | `pp-pipeline` | Decompose validation, summarization, ordering and presentation at clear boundaries |
| | `pp-tests` | Choose independent expected outcomes and discriminating normal/boundary/failure tests |
| | `pp-module-3-checkpoint` | Repair four different faulty designs using function, pipeline and testing principles |
| 4: Integrated report and evidence | `pp-errors` | Preserve visible whole-dataset failure instead of silently returning partial output |
| | `pp-integration` | Trace the fixed analyzer case and reconcile all report invariants |
| | `pp-evidence` | Distinguish specification, language references, submission and actual execution evidence |
| | `pp-module-4-checkpoint` | Cumulative changed-dataset, validation, testing and evidence case |

The module practice items teach a review strategy using a separate question from
the independent composite checkpoint bank. Checkpoint keys, explanations and hints
are server-owned, and existing learner-payload redaction remains authoritative.

## Source and evidence policy

All 17 course sources and 17 primary evidence quotes are original authored course
material, with `authored/<lesson-id>/...` or capstone locators. Each quote resolves
to its stored source body; the lesson text includes the evidence needed by its
teaching blocks. Sources are not private user uploads, and the candidate contains
no `source_pin` references that would bypass the private-to-catalog boundary.

Supporting official references were opened as the **Python 3.12.16** documentation
on 2026-11-19. The course uses the Python 3.12 reference family and a stable
language subset rather than interpreting a moving `/3/` URL as a pinned lesson:

- `https://docs.python.org/3.12/tutorial/controlflow.html`
- `https://docs.python.org/3.12/tutorial/datastructures.html`
- `https://docs.python.org/3.12/tutorial/errors.html`
- `https://docs.python.org/3.12/library/stdtypes.html#boolean-type-bool`
- `https://docs.python.org/3.12/howto/sorting.html#key-functions`
- `https://docs.python.org/3.12/library/unittest.html#basic-example`

External references support language semantics. They do not establish authored
application choices such as the 180-minute maximum or the choice to reject an
entire dataset on one invalid record. External pages are not copied wholesale,
downloaded for a learner, or treated as a new unbounded source adapter.

An exact stored locator is not proof that a claim is semantically supported. The
human claim-support benchmark must review that relationship separately, including
the limitations attached to the worked examples and project.

## Capstone: study-session analyzer

The capstone's learner prompt is self-contained: it gives the full contract and
fixed records directly, without requiring access to private editor review vectors
or navigating back to an earlier lesson. Fields are exactly `id`, `topic`,
`minutes` and `completed`:

- IDs/topics are strings stripped of outer whitespace and must remain nonblank.
- Normalized IDs must be unique. Topics are case sensitive: `Python` and `python`
  remain distinct by deliberate project policy.
- `minutes` has exact type `int`, excludes `bool`, and is within inclusive 1–180.
- `completed` has exact type `bool`. Validate every record, including incomplete
  records, before producing an accepted report.
- Reject the whole dataset on invalid input. Do not mutate submitted records or
  silently invent missing values.
- For valid input, include only completed records in the count and minute sum.
  Group by normalized topic; order by decreasing minutes, then increasing topic
  text for ties. Empty or all-incomplete valid input returns zeros and no rows.

The five fixed records are Python25 completed, SQL40 incomplete, Python35
completed, Math20 completed and SQL30 completed, with distinct IDs. Their worked
result is count **4**, total **110**, ordered topic rows **Python60, SQL30, Math20**.
This transparent worked case is intentionally visible to support a manual trace;
it is not an unreleased checkpoint answer key.

The required structured artifact has four sections:

| Section ID | Deliverable | Character bounds |
| --- | --- | ---: |
| `algorithm` | Contract, helper boundaries, nonmutating algorithm and error path | 120–3000 |
| `trace` | Manual fixed-case selection, accumulator, grouping and ordering trace | 100–3000 |
| `test-plan` | At least six independently justified normal, boundary and invalid cases | 160–3000 |
| `limitations` | Supported design claims, chosen evidence and honest execution/assessment limits | 100–2000 |

Required evidence selections connect claims to stored course material. Character
bounds and evidence selections are completeness checks, **not a semantic grade**.
The four rubric criteria are specification, report reasoning, design/tests and
evidence/limitations. Their IDs and referenced objectives/evidence are stored in
the versioned assignment; human review guidance is explicit.

The server-side `CAPSTONE_CASES` contain 11 original review vectors: ordinary
input, empty input, accepted endpoints, ties, all-incomplete input, Boolean
duration, duplicate IDs, blank topic, an excessive duration and a missing field.
Their expected outcomes are checked independently in trusted fixture tests. They
are editor/test data, not a code execution service or automatic project grader.

## Editorial and publication gate

| Item | Current state |
| --- | --- |
| Release | `practical-python-foundations`, version 1 |
| Editorial status | Abir approved the exact unchanged draft on 2026-11-20 |
| Repository catalog inclusion | Approved published copy; no production deployment |
| Runtime execution | Disabled; no learner Python/SQL/shell execution path |
| Human reviewer/date | Abir; confirmation received 2026-11-20 00:03:57 +06:00 |
| Claim-support results / sample size | Entire-packet human attestation: 40/40 supported; not an independent model-quality measurement |
| Assessment-key review | Abir approved all 80 keys with no corrections |
| Effort/scope validation | Abir approved the planning estimate; measured learner duration remains unvalidated |

Review the exact candidate release hash, every teaching block, assessment key and
capstone criterion. Record original-material allowed use, reference/version
policy, explanation/example adequacy, source-to-claim support and observed
results. The recorded human sample target is at least 95% supported claims, every
accepted locator must resolve, and there must be no severe known assessment-key
error. Fixes change the release hash and invalidate earlier judgments.

The full acceptance journey must also verify fresh enrollment, prerequisites,
all 16 lesson gates, separate practice/reveal/independent checkpoint effects,
source handoff, capstone draft/save/reload/submission, scheduled review and
owner isolation. Submission should be labelled awaiting human review; it must
not create an automatic rubric pass or a false claim that code ran. Automated
fixtures now use the approved, hash-guarded catalog factory to exercise this flow;
they cannot supply a human review signature or bypass a changed-content review.

Content checks: `apps/ai-service/tests/test_full_course_content.py` contains 30
independent fixture/structure checks, including 11 capstone review vectors and
hand-recorded assessment-key vectors. Those tests support review but do not
satisfy the named human gate or complete F05 publication by themselves.
