# Academic tools E08 through E12 acceptance

Local implementation and verification on 2026-11-20. No deployment is included.

| Task | Result and acceptance |
| --- | --- |
| E08 | Explicit selected-text tutor/cards/map previews and accepted undoable additions; six whole/region PNG/SVG/PDF downloads; 12 whiteboard browser journeys, selected-reference contracts and 17 API ownership/race/injection cases pass. Actual PNG and rendered PDF files inspected. See board-learning-and-exports.md. |
| E09 | Real English/Bangla browser OCR, crop/rotation/cancel/failure cleanup, editable text and chosen-lesson notes; five browser journeys and three image-preparation tests pass. See ocr-workspace.md. |
| E10 | Qualified static Big-O review with assumptions/reasoning/context and valid line notes; editable review/reference and bibliography handoffs. No code execution or timing-as-proof claim. Three code-review plus five bibliography browser journeys pass. See code-review-handoffs.md. |
| E11 | Four editable cover templates on A4/Letter; 30 focused tests and ten browser journeys; eight actual covers plus an edited document rendered and all nine pages inspected. Bangla shaping gate preserved. See cover-docx-export.md. |
| E12 and E12a | Three helper candidates evaluated; user selected manual rubric draft checklist. Saved evaluation preceded coding. Exact draft evidence, revision invalidation, owner-scoped local saves/CAS/copy recovery, JSON artifact and chosen-lesson handoff pass three unit and three browser journeys. Other helpers remain evaluated/deferred. See academic-helper-evaluation.md. |

The integration was rebuilt on main commit `a40c19d5`, preserving its completed
course/source work. The integrated AI suite passes **1,215 tests**, with **84
environment-gated skips**, and Ruff is clean. All five whiteboard PostgreSQL tests
ran separately on a disposable UTF-8 PostgreSQL 16 database. Migration
`0022_whiteboards` adds only the two board tables; Drizzle reports no further
schema delta. Existing migrations 0000–0021 are unchanged.

Monorepo lint, typecheck, unit tests and production build pass. The web suite has
295 passing tests and seven optional database skips; shared types have 160 passing
tests. Web Vitest workers are capped at four to avoid CPU/memory contention.
OpenAPI was regenerated; no existing paths or schemas were removed, and only
the existing code-review boundary changed.

Fresh browser verification covers whiteboards 12/12, OCR 5/5, code review 3/3,
cover UI 11/11, narration 3/3 and focus timer 6/6. The DOCX flow downloads all
eight template/paper combinations; those plus an edited-title copy were rendered
and all nine pages inspected. The checklist passes all three journeys together
with one worker, including account isolation, conflict recovery and note handoff.

The whiteboard checks exposed and fixed stale pointer offsets after panels move
the canvas and an extra queued autosave after manual save. Invalidated learning
previews require a fresh review before acceptance.

This is a source integration. Migration 0022 has not been applied to production,
and hosted OAuth/provider/audio behavior remains unverified. Offline board
editing assumes an already loaded shell; device checklist drafts are local and
separate from server privacy export.
