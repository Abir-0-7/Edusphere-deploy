# Editable OCR workspace (8.E09)

The Tools page has an explicit **Source format** selector for images, PDFs, and
Word `.docx` documents. PNG, JPEG and WebP images show an actual crop/rotation
preview and are read in English, Bangla or both with Tesseract.js browser workers.
The input limit is 15 MiB; decoded images are limited to 16 million pixels.
Crop controls describe original-image edges and apply before quarter-turn rotation.
Empty/corrupt/unsupported images fail visibly. Each read has a 60-second limit
and a Cancel control; completion, failure, cancellation and account unmount release
the worker and its timer. Replaced/unmounted image bitmaps are closed, and a stale
image decode or OCR result cannot populate another account's workspace.

The source preview remains beside the editable output and a confidence estimate.
The estimate is not an accuracy guarantee; names, numbers and uncertain characters
must be checked against the image. Changing crop, rotation or language keeps the
previous corrected output visible but prevents note handoff until a fresh read.
Selecting a different image clears the prior result. Images and OCR drafts remain
in transient browser memory; neither is uploaded or retained by the server.

## PDF and Word imports

- PDFs are limited to 15 MiB and 30 pages. PDF.js **6.5.438** renders the selected
  page locally, using a same-origin worker, character maps, fonts and WASM assets.
  Embedded images are capped at 16 million pixels before decoding. Blank pages
  and pages whose unsupported or oversized images were omitted show a visible
  explanation rather than silently presenting an empty preview as readable.
  **Extract PDF text** reads selectable text from every page and identifies pages
  that need OCR. **Read PDF page** recognizes only the selected crop/rotation.
  **Read all PDF pages** recognizes full pages sequentially without preview crops
  and publishes the combined result only when complete. Cancel preserves any
  previously corrected result. Each image recognition has a 60-second deadline;
  a whole-PDF OCR operation has a five-minute deadline. Account changes terminate
  the PDF worker and any active OCR worker. Password-protected, corrupt and
  oversized PDFs fail visibly and can be retried.
- Word `.docx` imports extract paragraph and table text, including Unicode Bangla,
  without uploading the archive. `fflate` **0.8.3** opens only `word/document.xml`,
  in a disposable worker with 4 MiB actual emitted XML, 2,000 ZIP-entry and 500,000
  extracted-character limits. Cancellation terminates decompression, and incorrect
  ZIP size metadata cannot bypass the emitted-byte limit. XML
  declarations with DTD/entities are rejected. Deleted text, field instructions,
  macros, relationships and embedded active content are not imported or executed.
  Image-only Word pages should be exported as PDF and read through PDF OCR.
- Google Docs can be downloaded as `.docx` or PDF first. Legacy binary `.doc`
  files must be saved as `.docx` or PDF; they are not silently treated as `.docx`.
- Extracted document text is editable and shares the explicit course-note handoff
  used by image OCR. A confidence estimate is shown only for actual OCR, not
  selectable PDF or Word text extraction.

The user explicitly chooses an existing enrollment and lesson to save corrected
text through the existing revision-checked study-notes API. Existing lesson notes
and bookmarks are preserved. Combined notes are limited to 5,000 Unicode
characters. Course-note handoff pins the authenticated token across its read/write
sequence and ignores completions after account unmount. A dropped save response
is reconciled against the exact prepared note on retry, avoiding a duplicate append.
Changes after a successful save reopen the handoff controls instead of presenting
the edited text as already saved. The same component is shared with other tools.

## Runtime and sources

Installed Tesseract.js and tesseract.js-core are both **7.0.0**. Their installed
`docs/api.md` and worker core-selection implementation were read before API use.
The worker uses the documented `createWorker`, `recognize` and `terminate` APIs.
`corePath` points to a directory with all six installed WASM JavaScript variants,
allowing the engine to select scalar/SIMD/relaxed-SIMD and LSTM builds. All worker,
core and English/Bangla language assets are served from the application origin;
the first-read browser test asserts there are no external resource requests.
Only one selected core and the chosen language data load for each read.

The static runtime/core variants total about 24.7 MiB; English and Bangla compressed
data total about 4.1 MiB. This changes static hosting bytes, without a paid provider
or API-host inference dependency. Tesseract runtime/core and upstream tessdata use
Apache-2.0; public license and attribution files remain in `apps/web/public/ocr/`.
The language package metadata declares MIT; its upstream data license is also
recorded in the existing Apache license copy. Language payload SHA-256 values are
recorded in `NOTICE.txt` and were checked against the bundled files.

Primary references: [Tesseract.js API](https://github.com/naptha/tesseract.js/blob/v7.0.0/docs/api.md),
[tessdata license](https://github.com/naptha/tessdata/blob/gh-pages/LICENSE), and
[tessdata_best license](https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE).

## Verification on 2026-11-20

- Nine Chromium journeys now include selectable multi-page PDFs, actual scanned
  PDF OCR with cancellation, Unicode Word import, invalid/oversized document
  recovery and the five original image-to-note journeys. Five Word parser/worker
  tests cover emitted-byte bounds, unused entries, malformed packages, cancelled
  work and deadline/retry. A PDF stream test confirms cancellation stops a stalled
  text reader and permits a clean retry. Source account changes release workers.

- Five Chromium journeys pass at **390 × 844**, using actual browser Tesseract
  recognition and the real local course-note API: English crop/correction/handoff,
  Bangla failure/cancel/retry, correcting a sideways original, corrupt input and
  account-switch cleanup, and lost note-response reconciliation without duplicate
  text. Worker count returns to zero after completion, failure and cancellation.
- The English image contains an excluded `BOTTOM LABEL`; the cropped recognition
  includes `ENERGY IS CONSERVED` and excludes that label. The Bangla fixture reads
  `বাংলা ভাষা আমার প্রিয়` and `আজ আমরা পড়ি`; the rendered source and output were
  visually inspected. These clean fixtures demonstrate operation, not a general
  accuracy benchmark for noisy scans or handwriting.
- Three image preparation unit tests pass for file/pixel bounds, source crop and
  rotated dimensions, and invalid crop/rotation rejection. Focused ESLint and full
  web TypeScript checks pass.
- Inspected captures: `output/ocr-workspace/bangla-390.png` and
  `output/ocr-workspace/corrected-390.png`.

```powershell
Set-Location apps/web
node ./node_modules/@playwright/test/cli.js test --config e2e/ocr-isolated.config.ts
node ./node_modules/vitest/vitest.mjs run tests/ocr-image.test.ts
pnpm typecheck
```

No schema migration, new service, original-file retention change or deployment
is part of this task. Signed-in hosted acceptance remains the Phase 8.H release
gate; local fixture auth does not claim a Clerk staging journey.
