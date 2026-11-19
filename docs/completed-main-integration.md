# Completed Phase 8 main integration - 2026-11-19

The user requested that completed work be published together to `main`.

## Scope and history

The integration starts from deployment main `0451f4b5`, preserving its Phase
8A reliability/privacy work, 8B/C courses and publication/runtime repairs, and
the independently verified Phase 8D study-tools port. It merges game expansion
`eb27faf0`: fourteen StudyVault games plus the existing Cyberverse entry.

The unrelated source-history branch was not merged wholesale. Completed cover
work was ported from the final committed source slice through `0ef8931b`.
Completed bibliography (E04/E05), whiteboard evaluation/contracts (E06), and
source-version bridge (F01) files were ported individually from the prepared
source workspace. Deployment-specific course v2 releases, code-editor labs,
same-origin request proxy and existing tools were preserved.

Unfinished GitHub import (F02), replacement whiteboard implementation (E07),
development caches, build outputs, test artifacts, credentials and unrelated
source-tree changes are excluded. Whiteboard E06 is an evaluation and contract
slice, not shipment of the replacement editor.

## Database and API integration

The deployment migration sequence remains additive:

- `0016_bibliography_items`: private bibliography records and owner-safe document unlinking.
- `0017_bibliography_isbn`: ISBN field.
- `0018_source_versions`: immutable private source versions, size/hash checks and owner/document cascades.

Drizzle declarations, journal and per-step snapshots match the final schema;
regeneration reports no changes. Custom database triggers remain in the SQL
migrations. Exact 0016-0018 SQL was rehearsed in a random disposable schema with
legacy-row preservation, ownership, immutability and cascade/unlink assertions.
This component rehearsal does not substitute for full production pgvector
migration/backup acceptance.

Bibliography and source-version calls use the authenticated same-origin learning
proxy allowlist. Server authentication and private ownership checks remain in
place; client owner fields do not grant access. API documentation is regenerated
from the isolated in-memory application, without calling a provider or production
database. Pinned CSL assets and the required third-party attribution/source
notices are included; vendored license source is excluded from first-party lint.

## Verification

- Full monorepo lint, typecheck, test and production build passed. TypeScript and
  Node suites passed 488 tests, including database integration, with no skips.
- Full isolated Python API/unit suite passed 533 tests; 38 environment-dependent
  cases were skipped. Ruff passed. Database checks are run separately with their
  required fixtures rather than pointing the entire suite at an empty database.
- F01 passed six disposable PostgreSQL cases; bibliography passed its focused API
  and disposable database checks; the combined migration component test passed.
- A separate random-schema rehearsal applied all 19 journal migrations and
  passed 19 course/lab/profile/privacy/track/source-pin PostgreSQL tests. The
  local bundle lacks pgvector: only the fixture's vector column and vector-only
  extension/index DDL were substituted/omitted. Real pgvector retrieval and the
  live pipeline remain unverified; production SQL files were not changed.
- Schema regeneration and the production dependency audit passed.
- The frozen-lockfile install check passed. CI now includes cover/bibliography
  browser checks and the self-contained academic/source PostgreSQL checks.
- Fifty isolated Chromium cases passed across the 14-game collection, flashcard studio,
  offline decks, concept explorer, cover builder, bibliography, courses and track
  planning. Six production browser guard cases passed; seven credential-gated
  cases were skipped. Browser transport fixtures do not establish hosted Clerk
  acceptance.

## Release boundary

This publication changes Git history and release code. It does not apply SQL to
the production Neon database or deploy/verify the Render backend. Apply pending
canonical migrations deliberately, deploy the matching API image, and verify the
stable signed-in web flow before declaring the hosted release accepted. Preserve
the existing database and rate-limit stores. Remaining task checkboxes retain
their human review, capacity, pgvector and staging requirements.
