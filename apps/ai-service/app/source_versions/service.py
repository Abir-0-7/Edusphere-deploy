"""Pure legacy adapter and evidence resolver; never downloads or executes sources."""

import hashlib
from urllib.parse import quote

from pydantic import ValidationError

from app.documents.store import DocumentRecord
from app.errors import Conflict, InvalidInput
from app.source_versions.contracts import (
    EvidencePin,
    GithubLocator,
    GithubOrigin,
    PdfSnapshotRequest,
    ResolvedEvidence,
    SourceSnapshot,
    SourceVersion,
)


def pdf_snapshot(document: DocumentRecord, request: PdfSnapshotRequest) -> SourceSnapshot:
    """Capture extracted text, never originals. Unknown historic facts stay unknown."""
    if document.status != "parsed" or document.mime_type != "application/pdf":
        raise InvalidInput("A parsed PDF is required to create a source version")
    if not document.page_count or not document.chunks:
        raise InvalidInput("This PDF has no precisely located extracted text")
    if any(int(key) > document.page_count for key in request.printed_page_labels):
        raise InvalidInput("A printed label refers to a PDF position outside this source")
    extracted_pages = {str(chunk.page) for chunk in document.chunks}
    if not set(request.printed_page_labels) <= extracted_pages:
        raise InvalidInput("Printed labels can only annotate pages with extracted evidence")
    chapters = {chapter.id for chapter in document.chapters
                if chapter.document_id == document.id and chapter.user_id == document.user_id}
    if any(
        chunk.document_id != document.id or chunk.user_id != document.user_id
        or chunk.chapter_id is not None and chunk.chapter_id not in chapters
        for chunk in document.chunks
    ):
        raise InvalidInput("PDF chunk ownership or chapter is invalid")
    try:
        return SourceSnapshot.model_validate({
            "title": document.filename,
            "origin": {
                "kind": "pdf", "document_id": document.id, "page_count": document.page_count,
                "book_title": request.book_title, "edition": request.edition,
            },
            "provenance": {
                "adapter": "legacy_pdf_chunks",
                "rights": {"status": "user_declared", "statement": request.rights_statement}
                if request.rights_statement is not None else {"status": "unknown"},
            },
            "segments": [{
                "id": chunk.id,
                "locator": {
                    "kind": "pdf", "pdf_page_index": chunk.page,
                    "printed_page_label": request.printed_page_labels.get(str(chunk.page)),
                    "chunk_id": chunk.id, "chapter_id": chunk.chapter_id,
                },
                "text": chunk.content,
                "text_sha256": hashlib.sha256(chunk.content.encode()).hexdigest(),
            } for chunk in sorted(document.chunks, key=lambda item: (item.ordinal, item.id))],
        })
    except ValidationError as exc:
        # Source text never enters exception details or logs.
        raise InvalidInput("PDF extraction cannot fit the bounded source-version contract") from exc


def resolve_version(version: SourceVersion, pin: EvidencePin) -> ResolvedEvidence:
    if str(pin.version_id) != str(version.id) or pin.content_hash != version.content_hash:
        raise Conflict("Evidence refers to a different source version")
    segment = next((item for item in version.snapshot.segments if item.id == pin.segment_id), None)
    if segment is None or segment.locator != pin.locator or not pin.quote.strip() or pin.quote not in segment.text:
        raise InvalidInput("Evidence locator or exact quote does not match the pinned source")
    origin = version.snapshot.origin
    canonical_url = None
    if isinstance(origin, GithubOrigin) and isinstance(segment.locator, GithubLocator):
        locator = segment.locator
        canonical_url = (
            f"https://github.com/{origin.owner}/{origin.repository}/blob/{origin.commit}/"
            f"{quote(locator.path, safe='/')}"
        )
        # Notebook positions refer to cell source, not lines in the .ipynb JSON.
        if locator.notebook_cell is None:
            canonical_url += f"#L{locator.start_line}-L{locator.end_line}"
    return ResolvedEvidence(
        pin=pin, source_title=version.snapshot.title, content=segment.text, canonical_url=canonical_url,
        source_version_url=f"/api/source-versions/{version.id}",
    )
