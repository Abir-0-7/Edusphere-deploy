# Editable academic cover export

Phase 8.E11, verified locally on 2026-11-20.

The cover editor offers **Download editable DOCX** alongside the existing PDF
download. It consumes the same validated `AcademicCoverDraft`, template metadata,
measured line plan and bounded PNG/JPEG logo as the preview/PDF. All four approved
templates support A4 and Letter. The document contains ordinary editable Word
paragraphs, a Title paragraph style, editable text, and an embedded proportional
logo. It does not contain a screenshot of the page, macros, active content,
external images, or external relationships. No source or student details are sent
to a document service.

The small fixed OOXML/OPC package is assembled locally with XML escaping, ZIP
CRC32 and a central directory. Browser downloads and independent Python ZIP/XML
readers verify the package. No new runtime package is required. Existing PDF
download, saved PDF copies, drafts, presets and account separation remain intact.
DOCX downloads are generated from the current editor state; saved PDF copies are
still labeled and stored as PDF copies.

Word font roles map Helvetica to Arial, Times Roman to Times New Roman, and
Courier to Courier New. Font sizes, template text colors, field order, whitespace, alignment
and page margins derive from the approved template. Word processors can reflow
text after editing or font substitution; the editor explains that the page should
be checked after edits. Unsupported characters and one-page overflow fail before
download. Accented Latin text is verified. Bangla remains disabled for both
formats until a renderer/font path passes Bengali shaping acceptance; DOCX
support does not bypass that gate.

## Automated and rendered acceptance

- Focused Vitest: **30 passed**, covering DOCX/PDF/layout contracts, all eight
  template/paper combinations, XML escaping, non-image text, missing fields,
  unsupported glyphs, invalid XML controls, overflow and image validation.
- Existing cover Chromium suite: **9 passed**, including four DOCX templates,
  the Bangla gate, existing PDF bytes/preview/logo and saved-copy behavior,
  keyboard template selection, draft/preset reload and failed browser retention.
- Additional DOCX Chromium journey: **1 passed**, downloading all **eight**
  template/paper variants with a long title, accented institution/student name,
  course/student/instructor/date fields and a 2:1 logo.
- Targeted ESLint and full web TypeScript check pass.
- Independently checked ZIP CRCs, parsed WordprocessingML, correct page sizes,
  field contents, embedded image, and extracted text bounds from actual renders.
- All eight documents were rendered by the document skill's `render_docx.py`
  through LibreOffice **26.8.3.1** to PDF and page PNGs. Every cover is **one page**.
  All eight page images were inspected: no clipped text, overlap, missing accents,
  distorted logos or extra pages. The four typography/alignment variants remain
  recognizable and readable on both paper sizes.
- A downloaded cover was opened using bundled `python-docx`, its Title text was
  edited, and it was saved as another DOCX. That edited document rendered as one
  clean page with the changed title, confirming practical editability.

The fixture downloads, editor screenshots, rendered PNG/PDFs, and machine-readable
results are under `output/docx/e11/`; `render-report.json` records all page sizes.
Logs: `output/phase8e11-unit.log`, `phase8e11-pdf-regression.log`,
`phase8e11-lint.log`, `phase8e11-typecheck.log`, and `phase8e11-all-render.log`.
These QA images/PDFs are internal acceptance artifacts rather than extra product
downloads.

## Reproducing the checks

From `apps/web`:

```powershell
node ./node_modules/vitest/vitest.mjs run tests/cover-docx.test.ts tests/cover-pdf.test.ts tests/cover-layout.test.ts
node ./node_modules/@playwright/test/cli.js test --config e2e/cover-builder-isolated.config.ts
node ./node_modules/@playwright/test/cli.js test --config e2e/cover-docx-isolated.config.ts
```

Resolve the bundled Python/Poppler paths using Codex workspace dependencies and
place a local `soffice.exe` directory on `PATH`, then run from the repository root:

```powershell
& $bundledPython apps/web/scripts/verify-cover-docx.py --fixtures output/docx/e11 --renderer "$documentSkill/render_docx.py"
```

The host's bundled Windows runtime has no LibreOffice. For this acceptance run,
the official [LibreOffice 26.8.3 MSI](https://download.documentfoundation.org/libreoffice/stable/26.8.3/win/x86_64/LibreOffice_26.8.3_Win_x86-64.msi)
was downloaded through its official mirror, and Windows verified a **Valid**
Authenticode signature from **The Document Foundation**. Its embedded cabinet was
extracted read-only and the MSI file/directory map reconstructed beneath
`output/tools/libreoffice/`, with every resolved destination checked to remain
inside that directory. This acquired a project-local renderer without installing
an application or altering system settings. The skill renderer used bundled
Python/Poppler with a unique temporary LibreOffice profile. Initial sandbox
temporary-directory/subprocess restrictions were resolved with the authorized
local subprocess permission; the successful renderer log records actual output.

Downloaded renderer SHA-256:
`0e6918c273eabbdbbd800ee0dacbbf130a14c13c2e4cec861b06dd59e015bf94`.

This is local editable-cover acceptance. It does not enable unverified Bangla
fonts, install Office for learners, change the approved templates, or authorize
deployment.


## Combined study repairs acceptance

The combined integration keeps the refreshed navy/gold, teal, violet and
terracotta designs in preview, PDF and DOCX. DOCX colors come from each measured
line; page backgrounds, borders and ornaments use native editable Word header
shapes behind the body text. Each shape has its own picture run so Word and
LibreOffice both retain every shape. Body paragraphs, Title style and logo
remain editable. The same eight colored fixtures plus the edited Title copy
are rendered again; the earlier monochrome render is not used to claim design
parity for the refreshed templates.

Integration checks: cover/layout/PDF/vault/summary unit suites **47 passed**;
combined cover browser suite **11 passed**; the additional eight-variant DOCX
browser journey **1 passed**; voice/speed/fallback/source-change cancellation
browser suite **3 passed**. Integration logs are
`output/integration-cover-voice-unit.log`, `integration-cover-browser.log`,
`integration-cover-docx-browser.log`, `integration-listen-browser.log`, and
`integration-docx-all-render.log`. The current rendering report remains
`output/docx/e11/render-report.json` in the isolated integration worktree.


## Fresh checkout acceptance on 20 November 2026

The final frontend integration in `phase8-e-rebase` retained the existing main
workspace and landing-page styles while adding route-based sign-in/sign-up,
active navigation, the shared persistent focus timer, and the repaired library
upload cancellation and chapter-summary narration behavior.

The focused cover, layout, DOCX, vault, summary and library-polling checks passed
52 tests across six files. The cover browser suite passed 11 cases; the DOCX
suite downloaded all eight template and page-size combinations. The current
bundled document renderer produced nine one-page results, including the editable
Title revision. All nine PNGs were opened and visually inspected: text, accents,
proportional logos and template decoration remained readable without clipping.
The fresh machine-readable result is `output/docx/e11/render-report.json`.

The narration browser suite passed three cases, the persistent timer suite six,
and code review three. Checklist first ran with two passing cases and a timeout
before the initial UI mounted; the isolated retry of that case passed. OCR first
failed during worker startup while the new checkout's runtime and build work
was active; a focused retry and the final full five-case suite passed after the
local assets were ready. No OCR product change was needed for that retry.

Current logs are under `output/frontend-*.log`, including cover, DOCX downloads,
DOCX rendering, narration, timer, code review, checklist/retry and OCR/final.
These local runs verify the feature workflows; they do not verify a hosted
OAuth return through an external identity provider.
