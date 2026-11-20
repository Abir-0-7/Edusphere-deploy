# Whiteboard ownership and recovery (8.E07)

## Backend and storage

Migration `0019_whiteboards.sql` adds owner-scoped named snapshots and separate
opaque raster assets. Each asset has a composite foreign key to its board and
owner; deleting the board or account cascades to its image bytes. Neither the
snapshot nor an asset payload can supply an owner identity. Existing authenticated
request resolution provides the owner to every query.

Snapshots use the app-owned `studyvault-whiteboard` version-1 envelope and the
exact Excalidraw 0.18.1 renderer identifier. New saves validate native element
types and IDs, duplicate IDs, in-scene frame/container/binding references, image
references, and the small persisted app-state allowlist. Deleted images retain
authorized references so undo does not lose their files. Embedded/iframe content,
remote/inline binary URLs, prototype keys, excessive nesting, oversized strings,
non-JSON values and non-finite numbers are rejected. The complete envelope is
validated before a memory mutation or PostgreSQL commit, so a failed size check
cannot save an unreadable revision.

The server serializes board updates under a row lock and checks the supplied
`expected_revision`. Exactly one of two competing updates can commit; the other
receives the shared 409 error envelope with `current_revision`. An account-level
transaction lock protects the configured board-count cap. Board lists are bounded
and paginated; image upload count and total byte limits are checked under the same
board lock as scene updates/deletion.

Image file IDs are immutable: identical uploads replay the same authorized asset;
different bytes under an existing file ID return 409 and require a new file ID.
This preserves images in saved and undo states instead of silently changing their
content from another tab. Upload quota queries read metadata rather than copying
all existing image bytes into process memory. Asset downloads require both owner
and board scope, return the verified SHA-256 ETag and `private, no-store`, and never
fetch remote content. Referenced assets cannot be deleted separately until the
scene releases them.

The existing account export includes named snapshots and image manifests with
image bytes encoded as base64. Account deletion removes both by database cascade;
the browser's separate account-scoped recovery cache is managed by the editor.
No production migration, deployment, sharing change or paid service is included.

## Backend verification

Installed versions checked: Python FastAPI 0.162.6, Pydantic 2.14.3 and psycopg
3.3.9. API use follows the current primary documentation for
[Pydantic validators](https://docs.pydantic.dev/latest/concepts/validators/) and
[psycopg transactions](https://www.psycopg.org/psycopg3/docs/basic/transactions.html).
Native renderer types were checked against the installed Excalidraw 0.18.1 type
declarations.

The focused backend run passed **34 tests**: 29 HTTP/memory/contract tests and five
real PostgreSQL tests. The PostgreSQL fixture applies migration 0025 in a unique
temporary schema inside the local disposable UTF-8 database and removes only that
schema afterward. It verifies restart persistence, cross-owner API/store/FK
rejection, competing revision and account-cap updates, immutable assets,
transaction rollback, pagination, actual privacy export and account cascade.
The focused Ruff check passes.

```powershell
$env:STUDYVAULT_WHITEBOARD_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/studyvault_d01_utf8'
Set-Location apps/ai-service
& .venv/Scripts/python.exe -m pytest tests/test_whiteboards.py tests/test_whiteboards_pg.py -q
& .venv/Scripts/python.exe -m ruff check app/whiteboards tests/test_whiteboards.py tests/test_whiteboards_pg.py
```

Editor/browser recovery acceptance and repository-wide results are recorded
separately as they complete. These backend checks do not substitute for browser
offline, account-switch, undo, image-hydration and conflict-recovery tests.

## Editor and recovery verification (2026-11-20)

The shared source of truth is `packages/types/src/whiteboard-api.ts`; browser
requests and responses validate against the same app-owned envelope as the Python
API. Excalidraw's native optional undefined properties are serialized to JSON
before validation. Persisted numeric zoom restores through the renderer's
documented zoom object. Excalidraw 0.18.1 and Dexie 4.4.7 were inspected locally;
[renderer APIs](https://plus.excalidraw.com/docs/sdk/excalidraw/api/props/excalidraw-api)
and [Dexie transactions](https://dexie.org/docs/Dexie/Dexie.transaction())
were checked before the changes. Bundled fonts use the local /whiteboard/ asset
path per the installed package README.

The device cache stores verified snapshots/images separately from unsynced drafts.
Every key includes the authenticated owner. Draft keys additionally include a
tab UUID; an exclusive browser Web Lock detects copied sessionStorage from
Duplicate Tab and assigns a separate UUID. A reload can reclaim its original UUID
after the old document releases its lock. Current browsers with Web Locks in a
secure context are required for safe draft recovery.

Captures, temporary-to-server board ID remaps, and server-save finalization share
one ordered local queue. Queued captures rebase onto the latest committed revision;
a response cannot erase a draft created during an IndexedDB await. A failed save
keeps the draft and reports the error. A remote conflict offers a separate named
recovery project or Reload Latest, which first preserves the draft in a recovery
project and then clears the stale original. Recovery titles respect the 200
character contract. The editor preserves undo image references and prefers
authorized server manifests when a local image is corrupted.

Earlier owner-scoped tldraw bytes remain untouched and can be downloaded exactly
for recovery. Unowned legacy shared keys are never imported. Automatic conversion
of unsupported legacy shapes is not claimed. Offline editing/reopening works
inside an already loaded application shell; a service worker that makes the whole
site navigable offline is outside E07.

The production component passes **10 isolated Chromium journeys**: real drawing,
undo/redo and named project switching; reload; outage recovery; offline editor
reopening/reconnect; actual duplicated-window conflict/reload recovery; edits
during a delayed provider-free HTTP save; account isolation; a delayed previous
account response; edits while IndexedDB commits are blocked; exact legacy-byte
download; and inserted image recovery after local blob corruption. Some journeys
combine several checks. The 390px capture was visually inspected. Transport is
fixture-controlled; this is local browser acceptance and does not replace signed-in
staging.

`pnpm --filter @studyvault/web test:e2e:whiteboards` runs the suite.
Tests use Vite port 4331 and a separate whiteboard result directory to avoid
interfering with the concurrently running F test suites.

Repository-wide final results are in `docs/phase8-early-acceptance.md` and
`output/phase8h01-final-*.log`. No F implementation was changed by this task.
