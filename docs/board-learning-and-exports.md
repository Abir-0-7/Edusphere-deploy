# Board learning and exports

E08 extends the existing owned Excalidraw 0.18.1 board. Select saved text,
labelled shapes or a frame to request a tutor answer, up to five card suggestions
or a small concept map. The server reads only the selected IDs from the current
owner-scoped saved revision. It rejects other accounts, stale revisions, deleted
or blank shapes, non-text IDs, more than 20 excerpts, text over 600 characters per
shape and combined UTF-8 context over 4,000 bytes before provider use.

Board text and the question are JSON data in a separate untrusted user message.
Calls use the existing fallback router with authenticated admission, quotas,
budgets and usage logging. The response is transient: no board-linked private
cache or durable operation result is retained. Cancellation discards the client
preview; it does not claim to reverse a completed provider call. The client
prevents duplicate pending submissions. Invalid provider JSON, wrong action,
unknown evidence IDs, oversized output and unavailable providers fail visibly.
These deterministic checks verify the shape and selected references, not the
factual correctness of model claims.

The server rechecks board existence and revision after generation. The UI keeps
suggestions in an explicit preview with their exact board excerpts. Discard and
cancel do not change the board. Add reviewed shapes rechecks the server revision
and local selection before inserting editable shapes in one undoable operation.
Original shapes remain, and source board/revision/excerpt metadata travels with
the additions. Cards are board study shapes and do not update a scheduled deck
or award mastery. Changing accounts unmounts the preview and ignores late results.

Whole-board and selected-area PNG, SVG and PDF downloads share the same selected
element set, including bound labels and frame descendants. Exports remove links
and custom data, include only the images used by that region, require local raster
bytes and never fetch arbitrary image URLs. SVG serialization rejects script,
foreign objects, handlers and remote links. Raster output is capped at 4096px per
edge and extreme/nonfinite bounds fail. PDF embeds the same PNG at 72/96 points
per pixel. PDF labels are rasterized; editable vector/text is available as SVG.

The editor refreshes Excalidraw's pointer offsets after panels expand or the page
scrolls. Excalidraw 0.18.1 observes its canvas dimensions, but a panel above the
canvas can move it without changing those dimensions. A coalesced animation-frame
refresh keeps clicks aligned with the rendered shapes without changing saved
scene coordinates or creating board revisions. Browser acceptance chooses the
selection tool before measuring the canvas, so toolbar scrolling cannot leave
the test with stale click coordinates. This uses the documented
[refresh API](https://plus.excalidraw.com/docs/sdk/excalidraw/api/props/excalidraw-api#refresh).
Manual saves also consume the queued autosave and skip a clean board, preventing
an unchanged follow-up revision from invalidating a learning preview. After a
stale-revision refusal, the browser check requests and reviews a fresh preview
before adding shapes.

Verification on 2026-11-20: all 12 existing whiteboard Chromium journeys pass,
including original recovery and the new preview/no-mutation, stale-accept,
cards/map, 390px and six export cases. The actual full/region PNG/SVG/PDF downloads
are preserved under `apps/web/.tmp-playwright/e08/`. Both PDFs were rendered with
Poppler and inspected alongside the PNGs: each label is visible, the selected-area
export excludes the outside label, and page sizes agree with the PNG dimensions.
The browser suite uses fixture transport; API tests separately exercise real
handlers, ownership, model validation and post-provider revision/deletion races.
RAG scoring/prompt isolation regressions run with the AI quality suite; no live
provider groundedness percentage is claimed.

The installed package manifests and upstream versioned
[Excalidraw export documentation](https://github.com/excalidraw/excalidraw/blob/v0.18.1/dev-docs/docs/%40excalidraw/excalidraw/api/utils/export.mdx),
[PDF-LIB API](https://pdf-lib.js.org/docs/api/classes/pdfdocument) and
[Pydantic validator docs](https://docs.pydantic.dev/latest/concepts/validators/)
were checked before extending the integration. E08 adds no migration, paid key,
source-retention policy change or deployment.
