# Phase 8F main integration

The 2026-11-20 integration starts from GitHub main `4e479789`. It adds the
completed F02-F07 work to the existing F01 evidence bridge, preserving the
deployment history, authentication, same-origin API proxy and the four published
v2 course releases with their existing coding, SQL and Git labs.

Practical Python Foundations is the fifth course. Its unchanged draft and
status-only published copy remain bound to Abir's recorded approval in
`curricula/practical-python-human-review.json`. The course has four modules,
16 lessons, 80 assessment keys and a required written capstone. Its learner
activities execute no code or SQL.

The integration includes bounded GitHub and local text/HTML/EPUB preparation,
private editable outline approval, resumable module generation, source impact
reports, append-only authored lesson revisions and explicitly accepted release
upgrades. Older enrollments and their original study history remain available.
Generated material stays private and unreviewed until separately reviewed.

The deployment migration sequence is additive:

| Source-workspace migration | Deployment migration |
| --- | --- |
| 0026 source versions | Existing 0018 source versions |
| 0027 outlines | 0019 course outlines |
| 0028 generation | 0020 course generation |
| 0029 authored revisions | 0021 generation lesson edits |

The snapshots and journal match the declared schema; a fresh Drizzle generation
reports no changes. Custom immutability and cascade triggers remain in SQL.
Apply the deployment migrations before enabling the optional F flags. GitHub
imports also need the existing Upstash rate-limit configuration. All new F flags
default to false. The database checks use disposable generated schemas; this
task does not migrate the production database or claim hosted acceptance.

Verification in the isolated integration checkout:

- Frozen-lockfile installation, monorepo lint, typecheck, tests and production
  build passed: 29 tasks. Ruff passed.
- Full Python suite with disposable source-database checks: 1,157 passed,
  31 environment-dependent cases skipped.
- TypeScript suites: 588 passed, nine optional database cases skipped. The
  existing Node OCR asset preparation tests passed as part of the web suite.
- Thirteen F Chromium journeys and seven existing course browser regressions
  passed against local real API handlers and production components. This covers
  the existing coding labs, imports, outline approval, saved generation,
  structured capstone, source impact and accepted upgrades. Mobile and desktop
  capstone/impact/upgrade captures were inspected.
- The CI PostgreSQL step now includes the scoped GitHub, outline, generation,
  refresh, capstone, upgrade and local adapter integration tests. Its exact
  combined command passed all 78 tests locally.

Unrelated source-worktree changes, nested deployment checkouts, generated browser
output, temporary scripts and credentials are excluded from the integration.
