# Bounded local source adapters

Private source preparation accepts pasted notes and user-provided `.txt`,
saved `.html/.htm`, and narrow EPUB 3 files. Enable it with
`AI_SERVICE_SOURCE_TEXT_IMPORT_ENABLED=true`; the default is false.
The outline planner provides import, cancellation and precise line pins.

Send authenticated uncompressed JSON to `POST /api/source-versions/import-text`.
All formats require a title and a declared intended-use rights statement.
For pasted notes use `format: "notes"` and `text`. Files use a matching
`format`, plain `filename`, declared `media_type`, and `content_base64`:
text/plain for txt, text/html for saved HTML, application/epub+zip for EPUB.
A web page is supplied as a local saved file. This API does not accept a URL,
follow links, render a browser page or fetch scripts, fonts or images.
No allowed-origin policy is inferred for future live fetching.

Requests are limited to 256 KiB and ten seconds. Per process, two imports can
read, extract or save concurrently. Raw inputs and extracted UTF-8 text are
limited to 128 KiB; extracted output allows 2,000 lines, 8,000 characters per
line and 12,000 per segment. Wrong filenames/media, binary controls, non-UTF-8,
ambiguous separators and blank content fail before persistence. Notes and txt
retain code indentation, blank lines, Markdown tables, and Unicode text.
Line endings normalize to LF and an initial UTF-8 BOM is removed.

HTML uses an inert structural text parser. Script/style/template/iframe/SVG
and other interactive material is omitted. Preformatted code retains
indentation, and simple table rows produce pipe-delimited text. Images, CSS,
dynamic content and complex merged/nested table layout are not reconstructed.
These omissions are recorded as extraction notes, not a numeric confidence
claim. Exact pins refer to the extracted line ranges, not source HTML line
numbers or the current live page.

EPUB reads only selected HTML/XHTML spine members from the supplied archive.
It checks the EPUB mimetype, one container rootfile, EPUB 3 package, unique
manifest IDs, one to sixteen local reading-order items, UTF-8 and safe relative
member paths. It rejects encrypted/DRM indicators, duplicate/link/unsafe
members, unsupported compression, XML entities/DTDs, missing resources,
archives over 64 entries or 512 KiB expanded, individual members over 128 KiB
and compression ratios over 80. No ZIP member is written to disk. Reading order
is retained. Images, fonts, CSS, interactive content and EPUB page numbering are
not retained; exact citations address the normalized extracted source version.

Extraction checks cooperative cancellation between HTML feed chunks, EPUB
reading-order chapters and output line batches. A disconnect before save
persists nothing. A disconnect racing an already-started atomic save may leave
one complete immutable version recoverable by identical retry. A cancelled
request holds its concurrency slot until the actual worker exits.

The existing owner source store provides deduplication, immutable rows, the
account cap and privacy export/deletion. Provenance records parser revision,
input and normalized text digests, declared rights and extraction uncertainty.
Rights are owner declarations. A snapshot alone never authorizes publication.
Original files are not retained by this path. Network crawling and retention
changes remain separate decisions.

Current acceptance covers source format/rights bounds, code/table/Unicode
samples, HTML executable/remote-resource omission, EPUB reading order and
hostile archives, ownership, exact pin resolution, cancellation and durable
replay/account cascades in generated disposable PostgreSQL schemas. Real OCR
is separate from these local text adapters. Earlier PDF fixtures lost code
indentation and table structure; GitHub selected text retained both.
Verification on 2026-11-20:

- In apps/ai-service, run `python -m pytest -p no:cacheprovider -q tests/test_local_text_source.py tests/test_local_text_source_pg.py tests/test_source_version_contracts.py tests/test_source_versions.py tests/test_source_refresh.py tests/test_api.py` with `STUDYVAULT_SOURCE_TEST_DATABASE_URL` set to the disposable PostgreSQL URL. Result: 105 passed.
- In apps/web, run `pnpm exec playwright test --config e2e/course-outline-isolated.config.ts --workers=1`. Result: five Chromium journeys passed, including mobile imports and the original outline approval/history regressions.
- Shared source/outline contract tests: 18 passed. Web typecheck, shared types lint, local UI lint and Python Ruff passed.
