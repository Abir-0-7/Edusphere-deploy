# SQL Query Foundations and Git Foundations candidates

Prepared for Phase 8.C05. Status: **authored curriculum candidates,
not published courses**. This document and the corresponding server-side course
drafts require human content/editorial approval plus the full guided-course
8.B10 acceptance journey before either course can be promoted.

Both are five-lesson Mini candidates with bounded deterministic choice/number
practice, independent checkpoints, a hands-on lab and a project assignment. They
use original short explanations and static examples. SQL practice compares a
single read-only query against a fixed authored target; the Git Practice Shell
simulates an allowlist against fake repository state. Neither starts a SQL
engine, operating-system shell, real Git repository, or arbitrary code runner.
Lab transcript and assignment draft writes are bounded owner-scoped enrollment
state; they never count as checkpoint mastery, create flashcards, or schedule
reviews. Assignment text remains private to the learner, is not sent to an
instructor, and is not automatically graded. Answer keys live only in
`apps/ai-service/app/courses/catalog_candidates.py`; public lab/course payloads
omit SQL targets and expected outputs. Their status remains `draft`, and the
shipped `catalog()` does not include them.

## SQL Query Foundations

**Outcome:** Read and reason about filtered, ordered, grouped queries and inner
joins in small fixed table examples. **Prerequisites:** none. **Estimate:** 45
minutes. The course covers
`SELECT`/`FROM`/`WHERE`, boolean predicates and `NULL`, ordering and bounded
results, aggregation and grouping, and row matching with an inner join.

Primary references are the [PostgreSQL table-expression documentation](https://www.postgresql.org/docs/18/queries-table-expressions.html),
[select lists](https://www.postgresql.org/docs/18/queries-select-lists.html),
[ordering](https://www.postgresql.org/docs/18/queries-order.html),
[LIMIT](https://www.postgresql.org/docs/18/queries-limit.html), and
[aggregate functions](https://www.postgresql.org/docs/18/functions-aggregate.html),
and [comparisons and NULL](https://www.postgresql.org/docs/18/functions-comparison.html).
Examples state their tables and assumptions locally. Human review should check
the accuracy of original explanation-to-evidence locators and checkpoint keys
against these references before publication.

## Git Foundations

**Outcome:** Explain a local change from working tree to staged snapshot and
commit, use branches for isolated work, integrate a completed branch, and inspect
history. **Prerequisites:** none. **Estimate:** 40 minutes. It avoids remote
credentials, server setup, reset and force-push commands, and executing learner
commands.

Primary references are the official [Git book section on recording changes](https://git-scm.com/book/en/v2/Git-Basics-Recording-Changes-to-the-Repository),
[branches in a nutshell](https://git-scm.com/book/en/v2/Git-Branching-Branches-in-a-Nutshell),
and the references for [diff](https://git-scm.com/docs/git-diff),
[switch](https://git-scm.com/docs/git-switch), [merge](https://git-scm.com/docs/git-merge),
[log](https://git-scm.com/docs/git-log) and [show](https://git-scm.com/docs/git-show). Human review
should verify descriptions of the index, checkout/merge target, and conflict
resolution against supported Git documentation and recorded version policy.

## Publication gate

| Draft | Release ID | Draft SHA-256 | Human review |
|---|---|---|---|
| SQL Query Foundations v1 | 92c888e9-ba99-57af-8a3c-87c8bb94e78e | 29e09683cb0f3f7f308f2dee1a43172d2b7f853b41d75f988a8680700266cd57 | Pending |
| Git Foundations v1 | efed7462-6f7b-589f-a155-213e4e922ea3 | 87d40d1dfbeab2376c4589f801885ab87c0684ff55b3ab702b10b1901b80c7da | Pending |

For each course separately:

1. Assign a named human curriculum reviewer. Check each learning objective,
   static example, answer key, misconception feedback, evidence quote and source
   locator against the official references. Record the reviewer, review date,
   draft release ID and content hash, corrections, and pass/fail decision.
2. Run the complete 8.B10 scenario in a disposable accepted-review fixture:
   enroll from a fresh library, explanation, practice/feedback, fresh independent
   checkpoints, cards/review queue, resume and progress. Confirm answer keys are
   absent from learner payloads and that one user's material is not visible to
   another user.
3. Verify every citation/locator against the saved version. For each sampled
   teaching claim, record its official supporting passage and mark it supported
   or unsupported. The 8.B10 target is at least 95% supported claims, with all
   locators resolving and no severe assessment-key errors.
4. Record the verified draft as reviewed. Publish that version through the
   reviewed catalog process only after the review and acceptance are recorded.
   The published content hash is immutable; later edits require a new release.

The candidate tests cover accepted and incorrect assessment fixtures, hidden
keys, exact source locators, owner isolation, all five lessons, source-linked
cards, SM-2 scheduling, resume, and recorded course completion in a disposable
in-memory fixture. Lab tests additionally reject shell operators and SQL
commands, verify that simulated Git changes stay within the fake repository,
hide SQL expected results, and assert that lab/assignment writes do not add
checkpoint attempts, mastery or cards. Assignment save/resume is owner-scoped.
The isolated 390px browser flow completes the full lab and persists the
assignment draft after reload. These checks are preliminary evidence. Named
human review and the grounded-claim 8.B10 review remain pending.
