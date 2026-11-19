# Phase 8.F01: immutable source evidence bridge

This is the first task in 8.F. The subsequent bounded public repository importer
is documented in [F02](github-source-import.md). Outline approval, module generation
and source-release upgrades remain F03–F06.

## Contracts and storage

`app/source_versions/contracts.py` and `packages/types/src/source-version-api.ts`
define the version-one wire models. Migration `0018_source_versions.sql` adds one
private, immutable table; it does not rewrite documents, chunks, cards, schedules,
course releases or enrollments. The database prevents updates and enforces owner
and source deletion cascades. A source version hash covers the entire canonical
snapshot: source identity, edition, locators, text, text hashes, parser and rights.
It is **not** the original PDF's hash. Exact replay returns the same saved version.

Snapshots are limited to 2 MiB of canonical UTF-8 JSON, 2,000 segments, and 16,000
Unicode code points per segment. A quote is limited to 4,000 code points. The DB's
3 MiB JSONB serialization guard allows PostgreSQL's additional JSON whitespace;
the stricter application limit still applies. The account cap defaults to 100
versions, configured with `AI_SERVICE_MAX_SOURCE_VERSIONS_PER_USER`; replay does
not consume another slot. Account writes lock the owner to serialize quota,
deduplication and deletion. There is no new service, provider or network access.

The server validates exact UTF-8 SHA-256 hashes. Shared synchronous Zod schemas
validate structure and bounds; the server remains authoritative for hashing,
ownership and quote authenticity.

## Existing PDF/book adapter

An authenticated owner calls `POST /api/documents/{document_id}/source-versions`
with optional `book_title`, `edition`, `printed_page_labels` and
`rights_statement`. Content, document/chapter/chunk identity and page positions
come from the owner's saved extraction, never a client-supplied source body.
The durable store rechecks the extraction inside its write transaction.

`pdf_page_index` is the existing **one-based PDF position**, not a printed label
and not a zero-based array offset. For example position 5 may carry the printed
label `iii` or `1`. Labels and editions are owner-declared annotations, not
metadata verified by a publisher or parser. An optional rights statement is also
a declaration, not verification or permission to publish.

The adapter records `legacy_pdf_chunks`. Historical parser name/version and
original-byte SHA-256 remain explicitly unknown because existing rows do not
retain these facts. It never retroactively attributes a current parser version.
Original PDF retention is unchanged: originals remain temporary and are not
stored by this bridge. Saved extracted text provides exact evidence after a
reparse; it does not make a deleted original file downloadable. PDFs without
valid page/chunk metadata fail this new snapshot action clearly while existing
study endpoints continue to work.

## Repository adapter boundary

An internal snapshot may describe selected text from `github.com` with a full
40-character commit, relative file path and one-based inclusive line range.
The selected text's line count and SHA-256 must match. The resolver constructs
only canonical GitHub commit/blob links, URL-encoding the validated path. It
rejects traversal, absolute/empty path components, backslashes, control characters,
URL schemes, fragments, queries and percent-encoded paths.

There is no endpoint accepting an arbitrary repository snapshot or fetching an
arbitrary URL. F02 adds a separate opt-in endpoint for explicit public repository,
commit, path/range and notebook-cell selections, including the network and content
checks described in its implementation notes. Imported text is data; no imported
code is evaluated or executed.

## Resolving and consuming evidence

`GET /api/source-versions/{version_id}` returns an authorized frozen extraction.
`POST /api/source-versions/{version_id}/resolve` accepts an `EvidencePin` containing
the same version ID/hash, segment ID, full typed locator and exact quote. A wrong
owner/deleted source returns 404; a wrong version hash returns 409; a mismatched
locator or quote returns the shared 400 error shape. Substring comparison is
exact, with no whitespace normalization. Errors do not contain source text.

The response contains the verified text and saved-version API link. Repository
responses also include the constructed pinned commit URL. PDF responses do not
invent a link to retained originals or redirect old evidence to today's chunks.
Deleting a PDF revokes its snapshot links; deleting the owner cascades all source
versions. Privacy export includes complete snapshots and provenance. Existing
course materialization/retention is unchanged; this task does not erase previously
derived course text or silently regenerate old lessons when a source changes.

Course `Evidence.source_pin` is optional. Legacy evidence, wire payloads and
published hashes stay stable when it is absent. A private release may mix PDF and
repository pins; its quote must match both course source text and the pinned
segment. Saves, course reads, enrollments, session reads and mutations validate
pins for the release owner; a removed source cannot yield a new enrollment or a
session with dead evidence. PostgreSQL course writes hold source/version locks
through the transaction, taking document locks before version locks to match
source-deletion order. The pin survives into learner
session evidence alongside existing document/chapter/chunk links. Catalog pins
remain prohibited until the explicit editorial/coverage gate in F03. Creating a
source snapshot alone never publishes private material.

## Verification

Run from `apps/ai-service`:

```powershell
$env:STUDYVAULT_SOURCE_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/studyvault_f01_acceptance'
.\.venv\Scripts\python.exe -m pytest tests/test_source_versions.py tests/test_source_versions_pg.py tests/test_course_source_versions.py tests/test_source_version_contracts.py -q
```

The PostgreSQL tests create and remove random schemas in a disposable database;
they never migrate production or modify existing application rows. Coverage
includes owner scoping, immutable text across reparsing, edition and printed
labels, unsafe paths, exact quote/hash/locator checks, additive migration, DB
immutability, rollback, duplicate-write races, quota races and deletion cascades.
Shared wire fixtures verify Python/Zod compatibility. Existing course/PDF/review
tests remain part of the full regression suite.

Final verification on 2026-11-19: full AI service pytest **672 passed, 32 skipped**,
including all **six** source-version PostgreSQL tests; Ruff passed. Monorepo lint,
typecheck, tests (`turbo run test --concurrency=1`) and production build passed.
Shared types passed 65 tests and web passed 236 tests (five optional DB tests
skipped). One unused import in the existing whiteboard Playwright configuration
was removed to unblock global lint/typecheck/build. Initial checks under heavy
host load encountered a retry timing failure, DB connection timeout and a bounds
test timeout; after the bounded test's allocation/timeout correction, the complete
reruns passed. No feature service retry or production DB timeout was weakened.

F01 work was prepared on `codex/phase8f-evidence-bridge`. The pre-existing staged/unstaged
worktree changes were preserved; no mixed commit or deployment was created.
