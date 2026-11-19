"""Ingest pipeline job handlers (tasks 2.2, 2.4, 2.7).

parse_pdf          -> extract text (pdfplumber, Tesseract for scanned pages) -> Markdown,
                      then enqueue structure_chapters. Bad files fail permanently (no retry).
structure_chapters -> chapters (LLM, schema-validated, heuristic fallback) -> page-aware chunks.

The two steps are separate jobs so an LLM retry never re-runs OCR.
Dependencies are injected so handlers are unit-testable without FastAPI or an LLM.
"""

import hashlib
import json
import logging
import uuid
from collections.abc import Callable
from dataclasses import asdict
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.ai.outline import Outline
from app.documents.store import ChapterRecord, ChunkRecord, DocumentRecord, InMemoryDocumentStore
from app.errors import ApiError
from app.jobs.worker import Handler, JobStore, PermanentJobError, check_claim, current_claim, publishing, stage_key
from app.llm.cache_scope import response_scope
from app.parsing.pages import Page, split_pages
from app.parsing.pdf import OcrBackend, parse_pdf
from app.rag.chunking import ChapterSpan, chunk_inputs_from_pages, chunk_markdown

logger = logging.getLogger("studyvault.pipeline")

Enqueue = Callable[[str, dict[str, Any]], str]
# (pages, page_count) -> (chapters, source) where source is "llm" or "heuristic"
OutlineFn = Callable[[list[Page], int], tuple[list[Outline], str]]


def make_parse_handler(
    *,
    docs: InMemoryDocumentStore,
    enqueue: Enqueue,
    ocr: OcrBackend | None,
    max_pages: int,
    job_store: JobStore | None = None,
) -> Handler:
    def handle(payload: dict[str, Any]) -> dict[str, Any]:
        check_claim()
        document_id = payload["document_id"]
        doc = docs.get_internal(document_id)
        if doc.user_id != payload["user_id"]:
            raise PermanentJobError("job owner does not match document owner")
        # A crash after a durable output commit resumes the consumer rather than
        # requiring an already discarded original to be uploaded again.
        next_payload = {
            "user_id": doc.user_id,
            "document_id": document_id,
            "stage_key": stage_key(doc.user_id, document_id, "structure_chapters"),
        }
        if doc.markdown and doc.page_count:
            with publishing():
                next_job_id = enqueue("structure_chapters", next_payload)
            return {
                "document_id": document_id,
                "page_count": doc.page_count,
                "unreadable_pages": [],
                "next_job_id": next_job_id,
            }
        pdf_bytes = payload.get("pdf_bytes")
        if pdf_bytes is None:
            pdf_bytes = docs.read_source_bytes(document_id, doc.user_id)
        if pdf_bytes is None:
            reason = "Uploaded file is no longer available; please re-upload"
            with publishing():
                docs.mark_failed(document_id, reason)
            raise PermanentJobError(reason)
        try:
            result = parse_pdf(pdf_bytes, max_pages=max_pages, ocr=ocr)
        except ApiError as exc:  # encrypted / corrupt / too many pages: retrying cannot help
            with publishing():
                docs.mark_failed(document_id, exc.message)
            raise PermanentJobError(exc.message) from exc
        if not result.markdown.strip():
            reason = "No text could be extracted from this PDF (scanned pages could not be read)"
            with publishing():
                docs.mark_failed(document_id, reason)
            raise PermanentJobError(reason)
        check_claim()
        commit = getattr(job_store, "commit_parse_stage", None)
        if commit is not None and current_claim.get() is not None:
            return commit(
                document_id=document_id,
                user_id=doc.user_id,
                markdown=result.markdown,
                page_count=result.page_count,
                unreadable_pages=result.ocr_pages,
            )
        with publishing():
            docs.mark_parsed(document_id, markdown=result.markdown, page_count=result.page_count)
            next_job_id = enqueue("structure_chapters", next_payload)
        return {
            "document_id": document_id,
            "page_count": result.page_count,
            "unreadable_pages": result.ocr_pages,
            "next_job_id": next_job_id,
        }

    return handle


def make_embed_handler(*, docs: Any, embedder: Any, batch_size: int = 500) -> Handler:
    """Fill chunk embeddings after structuring (task 2.8).

    Idempotent: only chunks with `embedding IS NULL` are processed, so a retry
    after a partial failure resumes without recomputing.
    """

    def handle(payload: dict[str, Any]) -> dict[str, Any]:
        document_id = payload["document_id"]
        doc = docs.get_internal(document_id)
        if doc.user_id != payload["user_id"]:
            raise PermanentJobError("job owner does not match document owner")
        if batch_size <= 0:
            raise ValueError("embedding batch size must be positive")
        embedded = 0
        while pending := docs.chunks_missing_embeddings(document_id, limit=batch_size):
            vectors = embedder.embed([c.content for c in pending])
            for chunk, vec in zip(pending, vectors, strict=True):
                with publishing():
                    docs.set_embedding(chunk.id, vec)
            embedded += len(pending)
        logger.info("embedded document=%s chunks=%d backend=%s", document_id, embedded, type(embedder).__name__)
        return {"document_id": document_id, "embedded": embedded}

    return handle


class FlashcardDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: str = Field(min_length=1)
    chapter_id: str = Field(min_length=1)
    source_chunk_id: str | None
    source_quote: str | None = None
    source_revision: str | None = None
    front: str = Field(min_length=1)
    back: str = Field(min_length=1)


class FlashcardCheckpoint(BaseModel):
    """Internal jobs.payload contract; not exposed by the job-status API."""

    model_config = ConfigDict(extra="forbid", strict=True)

    version: Literal[1] = 1
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    chapters: dict[str, list[FlashcardDraft]] = Field(default_factory=dict)


def _flashcard_fingerprint(doc: DocumentRecord) -> str:
    # Include the actual text and locators: keeping IDs alone misses source edits.
    data = {
        "document_id": doc.id,
        "user_id": doc.user_id,
        "chapters": [asdict(chapter) for chapter in doc.chapters],
        "chunks": [asdict(chunk) for chunk in doc.chunks],
    }
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def _flashcard_checkpoint(payload: dict[str, Any], doc: DocumentRecord) -> FlashcardCheckpoint:
    fingerprint = _flashcard_fingerprint(doc)
    saved = payload.get("flashcard_checkpoint")
    if saved is None:
        return FlashcardCheckpoint(fingerprint=fingerprint)
    try:
        draft = FlashcardCheckpoint.model_validate(saved)
    except ValidationError as exc:
        raise PermanentJobError("Saved flashcard draft is invalid; start a new generation") from exc
    if draft.fingerprint != fingerprint:
        return FlashcardCheckpoint(fingerprint=fingerprint)
    chapters = {chapter.id for chapter in doc.chapters}
    chunks = {chunk.id: chunk.chapter_id for chunk in doc.chunks}
    card_ids: set[str] = set()
    for chapter_id, cards in draft.chapters.items():
        if chapter_id not in chapters:
            raise PermanentJobError("Saved flashcard draft has an unrelated chapter")
        for card in cards:
            if (
                card.chapter_id != chapter_id
                or card.id in card_ids
                or (card.source_chunk_id is not None and chunks.get(card.source_chunk_id) != chapter_id)
            ):
                raise PermanentJobError("Saved flashcard draft has invalid card evidence")
            card_ids.add(card.id)
    return draft


def make_flashcard_handler(*, docs: Any, router: Any, job_store: JobStore | None = None) -> Handler:
    """Keep chapter drafts across quota waits. Replace the live deck only when complete.

    Production passes the job store so progress survives handler/worker restarts.
    Deck publication is fenced with the current durable job lease and preserves
    existing reviewed cards through the document store's additive merge.
    """

    def handle(payload: dict[str, Any]) -> dict[str, Any]:
        from datetime import UTC, datetime

        from app.ai.flashcards import generate_for_chapter

        document_id = payload["document_id"]
        doc = docs.get_internal(document_id)
        if doc.user_id != payload["user_id"]:
            raise PermanentJobError("job owner does not match document owner")

        today = datetime.now(UTC).date().isoformat()
        draft = _flashcard_checkpoint(payload, doc)
        for chapter in doc.chapters:
            if chapter.id in draft.chapters:
                continue
            with response_scope("flashcard-generation", doc, schema_version="flashcards-v1"):
                cards = generate_for_chapter(chapter=chapter, chunks=doc.chunks, router=router)
            draft.chapters[chapter.id] = [FlashcardDraft.model_validate(asdict(card)) for card in cards]
            serialized = draft.model_dump(mode="json")
            if job_store is not None:
                job_id = payload.get("job_id")
                if not isinstance(job_id, str) or not job_store.save_flashcard_checkpoint(
                    job_id, doc.user_id, serialized
                ):
                    raise PermanentJobError("Flashcard job is no longer available to save progress")
            payload["flashcard_checkpoint"] = serialized
        # A changed/deleted source must not publish drafts built from its old text.
        current = docs.get_for_user(document_id, doc.user_id)
        if current is None or _flashcard_fingerprint(current) != draft.fingerprint:
            raise PermanentJobError("Source changed during flashcard generation; start a new generation")
        all_cards = [card.model_dump() for chapter in doc.chapters for card in draft.chapters[chapter.id]]
        if not all_cards:
            raise PermanentJobError("No flashcards were generated; the existing deck was kept")
        with publishing():
            count = docs.merge_flashcards(all_cards, document_id=document_id, user_id=doc.user_id, due_date=today)
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

        next_payload = {
            "user_id": doc.user_id,
            "document_id": doc.id,
            "stage_key": stage_key(doc.user_id, doc.id, "embed_chunks"),
        }
        if doc.chapters and doc.chunks:
            with publishing():
                next_job_id = enqueue("embed_chunks", next_payload) if enqueue else None
            return {
                "document_id": doc.id,
                "chapter_count": len(doc.chapters),
                "chunk_count": len(doc.chunks),
                "structure_source": "committed",
                "next_job_id": next_job_id,
            }

        pages = split_pages(doc.markdown)
        with response_scope("chapter-outline", doc, schema_version="chapter-outline-v1"):
            outlines, source = outline_fn(pages, doc.page_count)

        chapters = [
            ChapterRecord(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{doc.id}:chapter:{i}")),
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
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{doc.id}:chunk:{p.ordinal}")),
                document_id=doc.id,
                user_id=doc.user_id,
                chapter_id=by_ordinal.get(p.chapter_ordinal) if p.chapter_ordinal is not None else None,
                content=p.content,
                page=p.page,
                ordinal=p.ordinal,
            )
            for p in pieces
        ]
        with publishing():
            docs.replace_structure(doc.id, chapters, chunks)
            # The job row remains locked through the handoff, so cancellation
            # or a replacement claimant cannot slip between output and enqueue.
            next_job_id = enqueue("embed_chunks", next_payload) if enqueue else None
        logger.info(
            "structured document=%s chapters=%d chunks=%d source=%s", doc.id, len(chapters), len(chunks), source
        )
        return {
            "document_id": doc.id,
            "chapter_count": len(chapters),
            "chunk_count": len(chunks),
            "structure_source": source,
            "next_job_id": next_job_id,
        }

    return handle
