"""Ingest pipeline: parse_pdf -> structure_chapters -> chunks (tasks 2.2, 2.4, 2.7).

Runs the real parser and worker; the LLM outline step is injected.
"""

import shutil
import uuid
from typing import Any

import pytest

from app.ai.outline import Outline, heuristic_outline
from app.documents.store import InMemoryDocumentStore
from app.jobs.worker import InMemoryJobStore, Job, Worker
from app.parsing.pages import Page
from app.parsing.pdf import TesseractOcrBackend
from app.pipeline import make_parse_handler, make_structure_handler
from tests.test_pdf import make_encrypted_pdf, make_scanned_text_pdf, make_text_pdf


class Harness:
    def __init__(self, outline_fn: Any = None, ocr: Any = None) -> None:
        self.jobs = InMemoryJobStore()
        self.docs = InMemoryDocumentStore()

        def default_outline(pages: list[Page], page_count: int) -> tuple[list[Outline], str]:
            return heuristic_outline(pages, page_count, 60), "heuristic"

        self.worker = Worker(
            self.jobs,
            {
                "parse_pdf": make_parse_handler(docs=self.docs, enqueue=self.enqueue, ocr=ocr, max_pages=300),
                "structure_chapters": make_structure_handler(
                    docs=self.docs,
                    outline_fn=outline_fn or default_outline,
                    chunk_max_chars=300,
                    chunk_overlap_chars=40,
                ),
            },
        )

    def enqueue(self, kind: str, payload: dict[str, Any]) -> str:
        jid = str(uuid.uuid4())
        self.jobs.add(Job(id=jid, kind=kind, payload=payload))
        return jid

    def upload(self, data: bytes, user: str = "u1") -> tuple[str, str]:
        # In-memory harness stores bytes on the document (like the Postgres
        # store does) so the handler's fallback path is exercised either way.
        doc = self.docs.create(
            user_id=user, filename="x.pdf", mime_type="application/pdf", size_bytes=len(data), source_bytes=data
        )
        return doc.id, self.enqueue("parse_pdf", {"user_id": user, "document_id": doc.id})

    def drain(self) -> None:
        while self.worker.process_one():
            pass


def test_text_pdf_full_ingest() -> None:
    h = Harness()
    doc_id, job_id = h.upload(make_text_pdf(3))
    h.drain()

    parse_job = h.jobs.jobs[job_id]
    assert parse_job.status == "done"
    assert parse_job.result is not None
    assert parse_job.result["page_count"] == 3
    structure_job = h.jobs.jobs[parse_job.result["next_job_id"]]
    assert structure_job.status == "done"
    # The handler also chains an embed job (next_job_id); compare the fields we care about.
    result = dict(structure_job.result or {})
    result.pop("next_job_id", None)
    assert result == {
        "document_id": doc_id,
        "chapter_count": 3,
        "chunk_count": structure_job.result["chunk_count"],
        "structure_source": "heuristic",
    }

    doc = h.docs.get_for_user(doc_id, "u1")
    assert doc is not None and doc.status == "parsed"
    assert [c.title for c in doc.chapters] == ["Chapter 1", "Chapter 2", "Chapter 3"]
    assert [(c.start_page, c.end_page) for c in doc.chapters] == [(1, 1), (2, 2), (3, 3)]
    chapter_by_id = {c.id: c for c in doc.chapters}
    for chunk in doc.chunks:
        assert chunk.user_id == "u1"
        owner = chapter_by_id[chunk.chapter_id or ""]
        assert owner.start_page is not None and owner.end_page is not None
        assert owner.start_page <= (chunk.page or 0) <= owner.end_page
        assert len(chunk.content) <= 300
    assert h.docs.get_for_user(doc_id, "someone-else") is None


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract binary not installed")
def test_scanned_pdf_full_ingest_with_real_ocr() -> None:
    h = Harness(ocr=TesseractOcrBackend())
    doc_id, job_id = h.upload(make_scanned_text_pdf(["Photosynthesis happens", "inside chloroplasts."]))
    h.drain()
    assert h.jobs.jobs[job_id].status == "done"
    doc = h.docs.get_internal(doc_id)
    assert "chloroplast" in (doc.markdown or "").lower()
    assert doc.chunks and doc.chunks[0].page == 1


def test_scanned_pdf_without_ocr_fails_permanently_with_reason() -> None:
    h = Harness(ocr=None)
    doc_id, job_id = h.upload(make_scanned_text_pdf(["unreadable without OCR"]))
    h.drain()
    job = h.jobs.jobs[job_id]
    assert job.status == "failed" and job.attempts == 1
    assert "No text could be extracted" in (job.error_reason or "")
    assert h.docs.get_internal(doc_id).status == "failed"


def test_encrypted_pdf_fails_permanently_without_retry() -> None:
    h = Harness()
    doc_id, job_id = h.upload(make_encrypted_pdf())
    h.drain()
    job = h.jobs.jobs[job_id]
    assert job.status == "failed"
    assert job.attempts == 1
    assert "password" in (job.error_reason or "")
    assert h.docs.get_internal(doc_id).error_reason == job.error_reason


def test_llm_outline_is_used_and_retry_is_idempotent() -> None:
    calls: list[int] = []

    def llm_outline(pages: list[Page], page_count: int) -> tuple[list[Outline], str]:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("provider outage")  # transient -> job retries
        return [Outline("Biology basics", 1, page_count, "All of it")], "llm"

    h = Harness(outline_fn=llm_outline)
    h.worker.backoff_seconds = 0
    doc_id, _ = h.upload(make_text_pdf(2))
    h.drain()
    doc = h.docs.get_internal(doc_id)
    assert len(calls) == 2
    assert [c.title for c in doc.chapters] == ["Biology basics"]
    # The outline's summary is no longer stored on the chapter row; summaries
    # are generated on demand per level and live in the `summaries` table (2.5).
    assert doc.chapters[0].start_page == 1
    first_chunk_ids = {c.id for c in doc.chunks}

    # Re-running structure replaces rather than duplicates.
    h.enqueue("structure_chapters", {"user_id": "u1", "document_id": doc_id})
    h.drain()
    assert len(doc.chapters) == 1
    assert len(doc.chunks) == len(first_chunk_ids)


def test_structure_job_rejects_owner_mismatch() -> None:
    h = Harness()
    doc_id, _ = h.upload(make_text_pdf(1), user="alice")
    h.drain()
    jid = h.enqueue("structure_chapters", {"user_id": "mallory", "document_id": doc_id})
    h.drain()
    assert h.jobs.jobs[jid].status == "failed"
    assert "owner" in (h.jobs.jobs[jid].error_reason or "")
