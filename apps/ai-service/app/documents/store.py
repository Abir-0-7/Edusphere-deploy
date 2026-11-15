"""Document / chapter / chunk storage (tasks 2.1, 2.4, 2.7).

Mirrors the `documents`, `chapters` and `chunks` tables in docs/schema.md.
In-memory until the Postgres store lands (needs task 1.7 migrations verified);
every read is scoped by user_id, matching the privacy rule.
"""

import threading
import uuid
from dataclasses import dataclass, field
from typing import Literal

DocumentStatus = Literal["pending", "parsed", "failed"]


@dataclass
class ChapterRecord:
    id: str
    document_id: str
    user_id: str
    title: str
    ordinal: int
    start_page: int | None
    end_page: int | None


@dataclass
class ChunkRecord:
    id: str
    document_id: str
    user_id: str
    chapter_id: str | None
    content: str
    page: int | None
    ordinal: int


@dataclass
class DocumentRecord:
    id: str
    user_id: str
    filename: str
    mime_type: str
    size_bytes: int
    page_count: int | None = None
    status: DocumentStatus = "pending"
    markdown: str | None = None
    error_reason: str | None = None
    chapters: list[ChapterRecord] = field(default_factory=list)
    chunks: list[ChunkRecord] = field(default_factory=list)


class InMemoryDocumentStore:
    def __init__(self) -> None:
        self._docs: dict[str, DocumentRecord] = {}
        self._lock = threading.Lock()
        self._summaries: dict[tuple[str, str], dict[str, object]] = {}
        self._embedded: dict[str, list[float]] = {}
        self._flashcards: dict[tuple[str, str], list[dict]] = {}
        self._reviews: list[dict] = []
        self._review_ids: set[str] = set()
        self._source_bytes: dict[str, bytes] = {}
        self._plans: dict[str, dict] = {}

    def create(
        self, *, user_id: str, filename: str, mime_type: str, size_bytes: int, source_bytes: bytes | None = None
    ) -> DocumentRecord:
        doc = DocumentRecord(
            id=str(uuid.uuid4()), user_id=user_id, filename=filename, mime_type=mime_type, size_bytes=size_bytes
        )
        with self._lock:
            self._docs[doc.id] = doc
            if source_bytes is not None:
                self._source_bytes[doc.id] = source_bytes
        return doc

    def take_source_bytes(self, document_id: str) -> bytes | None:
        with self._lock:
            return self._source_bytes.pop(document_id, None)

    def get_for_user(self, document_id: str, user_id: str) -> DocumentRecord | None:
        doc = self._docs.get(document_id)
        return doc if doc is not None and doc.user_id == user_id else None

    def get_internal(self, document_id: str) -> DocumentRecord:
        """Worker-side lookup by id (job payload already carries the owner)."""
        return self._docs[document_id]

    def mark_parsed(self, document_id: str, *, markdown: str, page_count: int) -> None:
        with self._lock:
            doc = self._docs[document_id]
            doc.markdown, doc.page_count, doc.status, doc.error_reason = markdown, page_count, "parsed", None

    def mark_failed(self, document_id: str, reason: str) -> None:
        with self._lock:
            doc = self._docs[document_id]
            doc.status, doc.error_reason = "failed", reason

    def replace_structure(
        self, document_id: str, chapters: list[ChapterRecord], chunks: list[ChunkRecord]
    ) -> None:
        """Idempotent: a retried structure job overwrites, never duplicates."""
        with self._lock:
            doc = self._docs[document_id]
            doc.chapters, doc.chunks = chapters, chunks

    # --- Summaries (task 2.5) — same surface as PgDocumentStore --------------
    def get_summary(self, chapter_id: str, level: str, user_id: str | None = None) -> dict[str, object] | None:
        key = (chapter_id, level)
        return self._summaries.get(key)

    def upsert_summary(
        self, *, chapter_id: str, user_id: str, level: str, content: str, model: str | None
    ) -> dict[str, object]:
        row: dict[str, object] = {
            "id": str(uuid.uuid4()),
            "chapter_id": chapter_id,
            "level": level,
            "content": content,
            "model": model,
        }
        self._summaries[(chapter_id, level)] = row
        return row

    def get_chapter_for_user(self, chapter_id: str, user_id: str) -> tuple[ChapterRecord, DocumentRecord] | None:
        for doc in self._docs.values():
            if doc.user_id != user_id:
                continue
            for chapter in doc.chapters:
                if chapter.id == chapter_id:
                    return chapter, doc
        return None

    def chunks_missing_embeddings(self, document_id: str, limit: int = 500) -> list[ChunkRecord]:
        doc = self._docs[document_id]
        return [c for c in doc.chunks if c.id not in self._embedded][:limit]

    def set_embedding(self, chunk_id: str, embedding: list[float]) -> None:
        self._embedded[chunk_id] = embedding

    # --- Flashcards (tasks 2.11, 2.12) — same surface as PgDocumentStore ----
    def delete_flashcards(self, document_id: str, user_id: str) -> None:
        self._flashcards.pop((document_id, user_id), None)

    def add_flashcards(self, cards: list[dict], *, document_id: str, user_id: str, due_date: str) -> int:
        rows = [
            {
                "ease_factor": 2.5,
                "interval_days": 0,
                "repetitions": 0,
                **c,
                "due_date": due_date,
                "document_id": document_id,
                "user_id": user_id,
            }
            for c in cards
        ]
        self._flashcards.setdefault((document_id, user_id), []).extend(rows)
        return len(rows)

    def list_flashcards(self, document_id: str, user_id: str) -> list[dict]:
        return self._flashcards.get((document_id, user_id), [])

    def due_flashcards(self, user_id: str, today: str) -> list[dict]:
        out = [
            c
            for (_doc_id, uid), cards in self._flashcards.items()
            if uid == user_id
            for c in cards
            if c["due_date"] <= today
        ]
        return sorted(out, key=lambda c: c["due_date"])

    def get_flashcard_for_user(self, card_id: str, user_id: str) -> dict | None:
        for (_doc_id, uid), cards in self._flashcards.items():
            if uid != user_id:
                continue
            for c in cards:
                if c["id"] == card_id:
                    return c
        return None

    def update_flashcard_sm2(self, card_id: str, *, ease: float, interval_days: int, reps: int, due: str) -> None:
        for (_doc_id, _uid), cards in self._flashcards.items():
            for c in cards:
                if c["id"] == card_id:
                    c.update(ease_factor=ease, interval_days=interval_days, repetitions=reps, due_date=due)

    def add_review(self, *, card_id: str, user_id: str, grade: int, client_review_id: str | None = None) -> bool:
        if client_review_id is not None:
            if client_review_id in self._review_ids:
                return False
            self._review_ids.add(client_review_id)
        self._reviews.append({"flashcard_id": card_id, "user_id": user_id, "grade": grade})
        return True

    def get_chapter(self, chapter_id: str) -> ChapterRecord | None:
        for doc in self._docs.values():
            for chapter in doc.chapters:
                if chapter.id == chapter_id:
                    return chapter
        return None

    # --- Study plans (task 3.5) --------------------------------------------
    def save_study_plan(self, *, user_id: str, document_id: str, exam_date: str, plan: dict) -> None:
        self._plans[document_id] = {"exam_date": exam_date, "plan": plan, "user_id": user_id}

    def get_study_plan(self, document_id: str, user_id: str) -> dict | None:
        row = self._plans.get(document_id)
        if row is None or row["user_id"] != user_id:
            return None
        return {"exam_date": row["exam_date"], "plan": row["plan"]}
