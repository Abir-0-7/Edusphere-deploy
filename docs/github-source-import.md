# Phase 8.F02: bounded public GitHub source import

This importer turns explicitly selected public repository text into the private,
immutable evidence snapshots introduced in F01. It does not generate a course,
publish a catalog release, clone a repository or run imported code. Outline
coverage and approval remain F03.

## Activation and API

The feature is off by default. Set `AI_SERVICE_GITHUB_IMPORT_ENABLED=true` in an
environment with the existing Clerk, PostgreSQL and Upstash prerequisites. F01
migration `0018_source_versions` must already be applied before activation. The
endpoint is `POST /api/source-versions/import-github` and uses the existing bearer
authentication and shared error envelope. It accepts only a validated GitHub
owner/repository, a full lowercase 40-character commit SHA, selected paths/ranges,
and the owner's permission statement for intended private study. It does not
accept arbitrary URLs, branch names, credentials, provider keys or archive data.

While the feature is disabled, the PostgreSQL API starts without optional
Upstash credentials and import requests remain unavailable. Enabling imports in
PostgreSQL mode requires both `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`; it never falls back to an in-process limiter for
enabled durable imports.

```json
{
  "origin": {
    "kind": "github",
    "owner": "example",
    "repository": "learning",
    "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "rights_statement": "I have permission to use these sources for private study.",
  "files": [
    { "kind": "text", "path": "docs/lesson.md", "start_line": 1, "end_line": 30 },
    {
      "kind": "notebook",
      "path": "notebooks/lesson.ipynb",
      "cells": [{ "index": 0 }, { "index": 2, "start_line": 1, "end_line": 10 }]
    }
  ]
}
```

The example SHA is a placeholder; callers must supply a real commit in the
selected repository. The response is the existing `SourceVersion` model. Fetch
and resolve it through the F01 owner-scoped endpoints. A complete import is saved
once, after every selected file passes. Identical retries reuse the same immutable
version ID, but every attempt still consumes an hourly admission slot. No raw
repository blobs, notebook outputs or original archives are retained.

Permission statements are declarations, not a license audit. Public visibility
does not establish permission to redistribute. Attribution is retained through
owner/repository/commit/path identity; publication remains blocked by the existing
private-source catalog gate and requires the later editorial rights review.

## Read-only fetch and trust boundary

Only anonymous GET requests to fixed `https://api.github.com` repository metadata,
Git commit, non-recursive tree and blob endpoints are permitted. The importer
verifies public visibility and repository identity, the requested commit, each
selected tree entry's type/mode, blob byte size and Git SHA-1 object hash. It never
follows API-provided URLs or a symlink/submodule target. All redirects, including
renamed repositories, are rejected; choose the canonical repository explicitly.

The exact `httpcore==1.0.9` dependency uses its public network-backend interface.
DNS answers must all be public unicast addresses. IPv4/IPv6 private, loopback,
link-local, multicast, mapped and transition-address ranges are rejected,
including conservative exclusions for older Python 3.12 IP classifications.
TCP is pinned to a validated numeric address while TLS retains `api.github.com`
for SNI and certificate verification. DNS jobs have two bounded shared slots;
timed-out jobs retain their slot until the OS call ends. Environment proxies,
cookies, authorization headers, URL forwarding, automatic retries and compressed
responses are excluded. JSON duplicate keys, nonfinite numbers and deep nesting
are rejected. Source text and upstream error bodies are omitted from errors/logs.

The GitHub API version is pinned to `2026-03-10`. Source extraction is versioned as
`studyvault-github-text/1`. These are protocol/parser revisions, not LLM models.
There are no LLM calls or new paid services in this task.

## Text, notebook and evidence rules

Selected files must be bounded UTF-8 text with an approved documentation/code
extension or a recognized LICENSE/README/NOTICE-style name. Credential files,
hidden paths, vendor/dependency/build output directories, minified/generated
assets, binary formats and Git LFS pointers are rejected. NUL, ambiguous line
separators and invalid Unicode are rejected instead of silently altering evidence.
Credential-pattern checks reject private keys, recognizable provider tokens,
credential-bearing URLs and literal secret assignments before persistence. This
is conservative pattern detection, not a guarantee that arbitrary source text
contains no sensitive data; use reviewed, appropriately redacted sources.

Text selections use one-based inclusive file line ranges. Omitting `end_line`
means the entire remaining file, subject to the line/byte limits; it never means
silent truncation. CRLF is normalized to LF. Lines split into bounded evidence
segments without dropping selected text, and oversized individual lines fail.

Notebooks must be bounded version-4 JSON with explicit selected cell indexes.
Cell indexes are **zero-based**; start/end lines are **one-based within that
cell's source text**. Only markdown/code source is retained. Outputs, execution
counts, notebook metadata, HTML outputs and attachments are discarded, and no
kernel, Python import, shell command or notebook renderer executes imported code.
Notebook locators include the cell index/type. Their canonical GitHub URL points
to the pinned notebook, without a misleading raw-JSON line anchor; the saved
version resolver supplies the precise cell evidence.

Each file records its observed raw-byte SHA-256, Git blob SHA and byte count.
Each extracted segment records its own text hash. The snapshot hash also covers
all locators, parser metadata and the rights declaration. Optional notebook/file
provenance fields are omitted from older snapshots so F01 hashes remain stable.

## Configurable bounds and failure semantics

Defaults, all exposed in `.env.example` and validated at startup:

| Setting suffix (`AI_SERVICE_GITHUB_IMPORT_…`) | Default |
| --- | ---: |
| `MAX_FILES` | 8 |
| `MAX_FILE_BYTES` | 131072 |
| `MAX_TOTAL_BYTES` | 524288 |
| `MAX_RESPONSE_BYTES` | 262144 |
| `MAX_WIRE_BYTES` | 2097152 |
| `MAX_API_REQUESTS` | 24 |
| `MAX_PATH_DEPTH` | 6 |
| `MAX_SELECTED_LINES` | 1000 |
| `REQUEST_TIMEOUT_SECONDS` | 5 |
| `TOTAL_TIMEOUT_SECONDS` (fetch/extraction stage) | 30 |
| `SAVE_TIMEOUT_SECONDS` (per SQL statement/lock) | 5 |
| `PER_USER_HOUR` | 2 |
| `GLOBAL_HOUR` | 2 |
| `MAX_ACTIVE` (per process) | 2 |

There are also protocol caps: at most 16 paths/request, 8 selected cells/notebook,
256 cells/notebook, 16000 Unicode code points/segment and a 2 MiB snapshot. The
active-work semaphore rejects busy requests immediately. Per-user/global hourly
admission is atomic; durable deployments use Upstash only for rate limiting,
with hashed owner keys and expiring counters. Failures are not refunded or
automatically retried. Settings require `MAX_API_REQUESTS × GLOBAL_HOUR <= 48`,
leaving headroom under GitHub's documented anonymous 60 requests/hour/IP limit.
Fixed UTC admission windows do not guarantee alignment with GitHub's own window,
and shared-IP traffic can still exhaust upstream capacity. Respect the returned
429 retry hint; no paid key is requested as a fallback.

The 30-second fetch budget includes DNS/TCP/TLS/read/write work through validation;
each low-level socket operation is clamped to the remaining deadline. It excludes
the preceding existing Upstash admission check and final PostgreSQL transaction.
The final save has bounded connection and SQL/lock waits and rolls back on failure.
Disconnects are checked during fetch and immediately before save. A disconnect
racing with an already-started atomic save may still leave one complete immutable
snapshot, which a retry can recover. No intermediate file or source row is saved.
Account deletion is rechecked and locked by the store; an in-flight fetch cannot
recreate a deleted owner. Exports include all source provenance; deletion cascades.

## Verification

The representative fixture contains README/docs, Bengali text, code that would
write a marker if executed, and a notebook with selected cells plus excluded
outputs/metadata. Unit and real FastAPI tests cover private access, precise
resolution, replay, fail-fast path policies, malformed API objects, Git hashes,
symlink/submodule ancestors, binary/secret cases, every work cap, cancellation,
rate limits and disabled-feature behavior. The network tests use real HTTPCore
framing with mocked DNS/TCP, including rebinding, mixed addresses, TLS identity,
deadlines, redirects, hostile JSON and transfer limits.

PostgreSQL tests use random temporary schemas in a dedicated **UTF-8 disposable
database**; the old Windows test database was WIN1252 and is unsuitable for the
Unicode round-trip check. Tests verify durable import, source hashes, account
isolation/deletion, no partial save and lock-timeout rollback/slot recovery. They
do not apply a production migration. No new table/migration is needed beyond F01.

Run from `apps/ai-service`:

```powershell
$env:STUDYVAULT_SOURCE_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/studyvault_f02_acceptance'
.\.venv\Scripts\python.exe -m pytest tests/test_github_importer.py tests/test_github_import_pg.py tests/test_github_http.py tests/test_github_admission.py tests/test_github_import_contracts.py -q
```

Reviewed primary references (2026-11-19):

- [GitHub Git trees: modes and bounded/nonrecursive responses](https://docs.github.com/en/rest/git/trees)
- [GitHub Git blobs: content encoding, size and SHA](https://docs.github.com/en/rest/git/blobs)
- [GitHub primary/secondary rate limits and retry headers](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [HTTPCore public network backends](https://www.encode.io/httpcore/network-backends/)
- [Python 3.12 address classifications and corrections](https://docs.python.org/3.12/library/ipaddress.html)

Final verification on 2026-11-19: **248 F02 tests passed** (94 network, 38 admission,
68 extraction/API/settings, 45 shared-contract parity and three PostgreSQL tests).
Full AI service pytest: **920 passed, 32 skipped**; Ruff passed. Monorepo lint,
typecheck, tests (`turbo run test --concurrency=1`) and production build passed;
shared types passed 71 tests. PostgreSQL acceptance used only temporary schemas
in `studyvault_f02_acceptance` (UTF-8). Production was not migrated or enabled.
No live GitHub fetch or hosted signed-in staging acceptance is claimed by these
fixture/network-boundary tests.

Work is on `codex/phase8f-github-import`. Existing staged and unstaged changes were
preserved; no mixed commit or deployment was created.
