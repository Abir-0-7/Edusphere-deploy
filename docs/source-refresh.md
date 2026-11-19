# Source refresh and course upgrades

Open the course outline planner, select a saved generation, and compare its
source snapshot with the replacement snapshot. The report shows changed text,
locators and exact links to affected lessons, flashcards and concept map items.
Review the limitations and counts alongside the paginated results. Choose two
related PDF snapshots, or two selections from the same GitHub repository. Card and map links
use the original PDF chunk IDs. Repository pins identify linked course material.

Update affected evidence pins and approve the target outline before previewing
selective generation. Keep the original pins for lessons whose evidence should
stay on the original snapshot. Reuse requires identical approved pins, prompt
and generation policy. The preview explains which lessons need fresh provider
work, which edits will be copied and how much the new work could cost. Accepting
it creates a separate private generation. Saved revisions for changed lessons
stay available in the original run. Cards and maps can be reviewed through their
existing library tools.

When the catalog has a newer review-approved release for the same course, an
enrolled learner can preview the upgrade. The preview lists which checkpoints,
notes and bookmarks can carry over. Accepting that exact mapping creates a
second enrollment and preserves access to the original release, cards,
reviews, attempts and project work. Projects start as drafts in the new
enrollment. The catalog prefers the latest enrolled release and lists the
other saved versions separately.

Apply PostgreSQL migration `0021_generation_lesson_edits.sql` before enabling
source impact and authored revisions with `AI_SERVICE_SOURCE_REFRESH_ENABLED`.
Selective generation uses the existing outline and generation flags as well.
`AI_SERVICE_COURSE_UPGRADES_ENABLED` enables upgrade previews and acceptance.
Both F06 flags default to `false`. The publication rules and approval for each
release still apply.

Run `pytest -q tests/test_source_refresh.py tests/test_source_refresh_pg.py
tests/test_course_upgrades.py` from `apps/ai-service`. Set
`STUDYVAULT_TEST_DATABASE_URL` to a disposable PostgreSQL instance for the
integration cases. The Playwright test uses the production components and
local FastAPI handlers with fixture providers and releases:

```sh
pnpm --filter @studyvault/web exec playwright test --config e2e/source-refresh-isolated.config.ts
```
