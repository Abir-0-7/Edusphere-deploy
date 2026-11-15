"""Ingest pipeline job handlers (tasks 2.2, 2.4, 2.7).

parse_pdf          -> extract text (pdfplumber, Tesseract for scanned pages) -> Markdown,
                      then enqueue structure_chapters. Bad files fail permanently (no retry).
structure_chapters -> chapters (LLM, schema-validated, heuristic fallback) -> page-aware chunks.

The two steps are separate jobs so an LLM retry never re-runs OCR.
Dependencies are injected so handlers are unit-testable without FastAPI or an LLM.
"""

import logging
import uuid
from collections.abc import Callable
from typing import Any

from app.ai.outline import Outline
from app.documents.store import ChapterRecord, ChunkRecord, InMemoryDocumentStore
from app.errors import ApiError
from app.jobs.worker import Handler, PermanentJobError
from app.parsing.pages import Page, split_pages
from app.parsing.pdf import OcrBackend, parse_pdf
from app.rag.chunking import ChapterSpan, chunk_inputs_from_pages, chunk_markdown

logger = logging.getLogger("studyvault.pipeline")

Enqueue = Callable[[str, dict[str, Any]], str]
# (pages, page_count) -> (chapters, source) where source is "llm" or "heuristic"
OutlineFn = Callable[[list[Page], int], tuple[list[Outline], str]]


def make_parse_handler(
    *, docs: InMemoryDocumentStore, enqueue: Enqueue, ocr: OcrBackend | None, max_pages: int
) -> Handler:
    def handle(payload: dict[str, Any]) -> dict[str, Any]:
        document_id = payload["document_id"]
        pdf_bytes = payload.get("pdf_bytes")
        if pdf_bytes is None:
            # Production path: the upload is stored on the document row and
            # cleared as soon as we read it (originals are not retained).
            pdf_bytes = docs.take_source_bytes(document_id)
        if pdf_bytes is None:
            reason = "Uploaded file is no longer available; please re-upload"
            docs.mark_failed(document_id, reason)
            raise PermanentJobError(reason)
        try:
            result = parse_pdf(pdf_bytes, max_pages=max_pages, ocr=ocr)
        except ApiError as exc:  # encrypted / corrupt / too many pages: retrying cannot help
            docs.mark_failed(document_id, exc.message)
            raise PermanentJobError(exc.message) from exc
        if not result.markdown.strip():
            reason = "No text could be extracted from this PDF (scanned pages could not be read)"
            docs.mark_failed(document_id, reason)
            raise PermanentJobError(reason)
        docs.mark_parsed(document_id, markdown=result.markdown, page_count=result.page_count)
        next_job_id = enqueue(
            "structure_chapters", {"user_id": payload["user_id"], "document_id": document_id}
        )
        return {
            "document_id": document_id,
            "page_count": result.page_count,
            "unreadable_pages": result.ocr_pages,
            "next_job_id": next_job_id,
        }

    return handle


def make_embed_handler(*, docs: Any, embedder: Any) -> Handler:
    """Fill chunk embeddings after structuring (task 2.8).

    Idempotent: only chunks with `embedding IS NULL` are processed, so a retry
    after a partial failure resumes without recomputing.
    """

    def handle(payload: dict[str, Any]) -> dict[str, Any]:
        document_id = payload["document_id"]
        doc = docs.get_internal(document_id)
        if doc.user_id != payload["user_id"]:
            raise PermanentJobError("job owner does not match document owner")
        pending = docs.chunks_missing_embeddings(document_id)
        if not pending:
            return {"document_id": document_id, "embedded": 0}
        vectors = embedder.embed([c.content for c in pending])
        for chunk, vec in zip(pending, vectors, strict=True):
            docs.set_embedding(chunk.id, vec)
        logger.info("embedded document=%s chunks=%d backend=%s", document_id, len(pending), type(embedder).__name__)
        return {"document_id": document_id, "embedded": len(pending)}

    return handle


def make_flashcard_handler(*, docs: Any, router: Any) -> Handler:
    """Generate flashcards for a document's chapters (task 2.11). Idempotent:
    deletes the document's cards then regenerates, so a retry never duplicates."""

    def handle(payload: dict[str, Any]) -> dict[str, Any]:
        from datetime import UTC, datetime

        from app.ai.flashcards import generate_for_chapter

        document_id = payload["document_id"]
        doc = docs.get_internal(document_id)
        if doc.user_id != payload["user_id"]:
            raise PermanentJobError("job owner does not match document owner")

        today = datetime.now(UTC).date().isoformat()
        all_cards: list[dict[str, Any]] = []
        for chapter in doc.chapters:
            cards = generate_for_chapter(chapter=chapter, chunks=doc.chunks, router=router)
            all_cards.extend(
                {
                    "id": c.id,
                    "chapter_id": chapter.id,
                    "source_chunk_id": c.source_chunk_id,
                    "front": c.front,
                    "back": c.back,
                }
                for c in cards
            )
        if hasattr(docs, "delete_flashcards"):
            docs.delete_flashcards(document_id, doc.user_id)
        count = docs.add_flashcards(all_cards, document_id=document_id, user_id=doc.user_id, due_date=today)
        return {"document_id": document_id, "flashcard_count": count}

    return handle


def make_structure_handler(
    *,
    docs: InMemoryDocumentStore,
    outline_fn: OutlineFn,
    chunk_max_chars: int,
    chunk_overlap_chars: int,
    enqueue: Enqueue | None = None,
) -> Handler:
    def handle(payload: dict[str, Any]) -> dict[str, Any]:
        doc = docs.get_internal(payload["document_id"])
        if doc.user_id != payload["user_id"]:
            raise PermanentJobError("job owner does not match document owner")
        if doc.markdown is None or doc.page_count is None:
            raise PermanentJobError("document has not been parsed")

        pages = split_pages(doc.markdown)
        outlines, source = outline_fn(pages, doc.page_count)

        chapters = [
            ChapterRecord(
                id=str(uuid.uuid4()),
                document_id=doc.id,
                user_id=doc.user_id,
                title=o.title,
                ordinal=i,
                start_page=o.start_page,
                end_page=o.end_page,
            )
            for i, o in enumerate(outlines, start=1)
        ]
        spans = [ChapterSpan(c.title, c.ordinal, c.start_page or 1, c.end_page or doc.page_count) for c in chapters]
        by_ordinal = {c.ordinal: c.id for c in chapters}
        pieces = chunk_markdown(
            chunk_inputs_from_pages([(p.number, p.text) for p in pages], spans),
            max_chars=chunk_max_chars,
            overlap_chars=chunk_overlap_chars,
        )
        chunks = [
            ChunkRecord(
                id=str(uuid.uuid4()),
                document_id=doc.id,
                user_id=doc.user_id,
                chapter_id=by_ordinal.get(p.chapter_ordinal) if p.chapter_ordinal is not None else None,
                content=p.content,
                page=p.page,
                ordinal=p.ordinal,
            )
            for p in pieces
        ]
        docs.replace_structure(doc.id, chapters, chunks)
        logger.info(
            "structured document=%s chapters=%d chunks=%d source=%s", doc.id, len(chapters), len(chunks), source
        )
        # Chain embedding so retrieval has vectors to work with (task 2.8).
        next_job_id = (
            enqueue("embed_chunks", {"user_id": doc.user_id, "document_id": doc.id}) if enqueue else None
        )
        return {
            "document_id": doc.id,
            "chapter_count": len(chapters),
            "chunk_count": len(chunks),
            "structure_source": source,
            "next_job_id": next_job_id,
        }

    return handle
