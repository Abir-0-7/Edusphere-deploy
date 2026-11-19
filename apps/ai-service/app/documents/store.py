"""Document / chapter / chunk storage (tasks 2.1, 2.4, 2.7).

Mirrors the `documents`, `chapters` and `chunks` tables in docs/schema.md.
In-memory until the Postgres store lands (needs task 1.7 migrations verified);
every read is scoped by user_id, matching the privacy rule.
"""

import hashlib
import json
import threading
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from app.errors import InvalidInput, NotFound

DocumentStatus = Literal["pending", "parsed", "failed"]


def _review_now(now: datetime | None) -> datetime:
    value = now or datetime.now(UTC)
    if value.tzinfo is None or value.utcoffset() is None:
        raise InvalidInput("review timestamp must include a timezone")
    return value.astimezone(UTC)


def _review_key(review_id: str | None) -> str:
    if review_id is None:
        return str(uuid.uuid4())
    try:
        return str(uuid.UUID(review_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise InvalidInput("review_id must be a UUID") from exc


def _review_schedule(card: dict, grade: int, now: datetime) -> dict:
    from app.ai.sm2 import Sm2State, due_date, review

    state = review(Sm2State(float(card["ease_factor"]), int(card["interval_days"]), int(card["repetitions"])), grade)
    return {
        "id": str(card["id"]),
        "ease_factor": state.ease_factor,
        "interval_days": state.interval_days,
        "repetitions": state.repetitions,
        "due_date": due_date(now.date(), state.interval_days),
        "replayed": False,
    }


def _source_revision(document_id: str, chapter_id: str, chunk_id: str, source_text: str, quote: str) -> str:
    payload = json.dumps(
        [document_id, chapter_id, chunk_id, source_text, quote], ensure_ascii=False, separators=(",", ":")
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _bounded_page(limit: int, offset: int, max_page_size: int) -> tuple[int, int]:
    if type(limit) is not int or limit < 1:
        raise InvalidInput("page limit must be a positive integer")
    if type(offset) is not int or offset < 0:
        raise InvalidInput("page offset must be a non-negative integer")
    return min(limit, max_page_size), offset


def _validated_cards(cards: list[dict], document: "DocumentRecord") -> list[dict]:
    chapters = {
        chapter.id
        for chapter in document.chapters
        if chapter.document_id == document.id and chapter.user_id == document.user_id
    }
    chunks = {
        chunk.id: chunk
        for chunk in document.chunks
        if chunk.document_id == document.id and chunk.user_id == document.user_id
    }
    result: list[dict] = []
    seen: set[tuple[str, str, str, str]] = set()
    for card in cards:
        if not isinstance(card, dict) or not isinstance(card.get("id"), str) or not card["id"]:
            raise InvalidInput("generated card requires a stable id")
        chapter_id, chunk_id = card.get("chapter_id"), card.get("source_chunk_id")
        chunk = chunks.get(chunk_id) if isinstance(chunk_id, str) else None
        if (
            not isinstance(chapter_id, str)
            or chapter_id not in chapters
            or chunk is None
            or chunk.chapter_id != chapter_id
            or not chunk.content.strip()
        ):
            raise InvalidInput("generated card source does not belong to this document and chapter")
        front, back = card.get("front"), card.get("back")
        if not isinstance(front, str) or not front.strip() or not isinstance(back, str) or not back.strip():
            raise InvalidInput("generated card question and answer cannot be empty")
        quote = card.get("source_quote")
        if quote is None:
            quote = chunk.content[:1600]
        if not isinstance(quote, str) or not quote.strip() or quote not in chunk.content:
            raise InvalidInput("generated card quote is not present in its source")
        revision = _source_revision(document.id, chapter_id, chunk_id, chunk.content, quote)
        provided_revision = card.get("source_revision")
        if provided_revision is not None and provided_revision != revision:
            raise InvalidInput("generated card source revision does not match its evidence")
        tags = card.get("tags", [])
        if not isinstance(tags, list) or len(tags) > 20 or any(
            not isinstance(tag, str) or not tag.strip() or len(tag) > 40 for tag in tags
        ):
            raise InvalidInput("card tags must be at most 20 short text labels")
        fingerprint = (chapter_id, chunk_id, " ".join(front.split()), " ".join(back.split()))
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        result.append(
            {
                "id": card["id"],
                "chapter_id": chapter_id,
                "source_chunk_id": chunk_id,
                "source_quote": quote,
                "source_revision": revision,
                "front": front.strip(),
                "back": back.strip(),
                "tags": list(tags),
            }
        )
    return result


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
    def __init__(
        self,
        *,
        max_documents_per_user: int = 100,
        max_chunks_per_document: int = 5000,
        max_flashcards_per_deck: int = 2000,
        max_embedding_batch: int = 500,
        max_page_size: int = 100,
    ) -> None:
        limits = (
            max_documents_per_user,
            max_chunks_per_document,
            max_flashcards_per_deck,
            max_embedding_batch,
            max_page_size,
        )
        if any(type(limit) is not int or limit <= 0 for limit in limits):
            raise ValueError("document, batch, and page limits must be positive integers")
        self._docs: dict[str, DocumentRecord] = {}
        self._max_documents_per_user = max_documents_per_user
        self._max_chunks_per_document = max_chunks_per_document
        self._max_flashcards_per_deck = max_flashcards_per_deck
        self._max_embedding_batch = max_embedding_batch
        self._max_page_size = max_page_size
        self._lock = threading.Lock()
        self._summaries: dict[tuple[str, str], dict[str, object]] = {}
        self._embedded: dict[str, list[float]] = {}
        self._flashcards: dict[tuple[str, str], list[dict]] = {}
        self._reviews: list[dict] = []
        self._flashcard_versions: dict[str, list[dict[str, object]]] = {}
        self._quality_reports: list[dict[str, object]] = []
        self._review_ids: set[str] = set()
        self._review_results: dict[tuple[str, str], tuple[str, int, dict]] = {}
        self._source_bytes: dict[str, bytes] = {}
        self._plans: dict[str, dict] = {}

    def create(
        self, *, user_id: str, filename: str, mime_type: str, size_bytes: int, source_bytes: bytes | None = None
    ) -> DocumentRecord:
        doc = DocumentRecord(
            id=str(uuid.uuid4()), user_id=user_id, filename=filename, mime_type=mime_type, size_bytes=size_bytes
        )
        with self._lock:
            if sum(item.user_id == user_id for item in self._docs.values()) >= self._max_documents_per_user:
                raise InvalidInput("document limit reached for this account")
            self._docs[doc.id] = doc
            if source_bytes is not None:
                self._source_bytes[doc.id] = source_bytes
        return doc

    def take_source_bytes(self, document_id: str) -> bytes | None:
        with self._lock:
            return self._source_bytes.pop(document_id, None)

    def read_source_bytes(self, document_id: str, user_id: str) -> bytes | None:
        """Keep original bytes until parsed text has committed successfully."""
        with self._lock:
            doc = self._docs.get(document_id)
            return self._source_bytes.get(document_id) if doc is not None and doc.user_id == user_id else None

    def get_for_user(self, document_id: str, user_id: str) -> DocumentRecord | None:
        doc = self._docs.get(document_id)
        return doc if doc is not None and doc.user_id == user_id else None

    def owns_document(self, document_id: str, user_id: str) -> bool:
        with self._lock:
            doc = self._docs.get(document_id)
            return doc is not None and doc.user_id == user_id

    def list_library_documents(self, user_id: str, *, limit: int, offset: int) -> tuple[list[dict[str, str]], int]:
        with self._lock:
            rows = [doc for doc in self._docs.values() if doc.user_id == user_id]
            rows.sort(key=lambda doc: doc.id, reverse=True)
            documents = [{"id": doc.id, "title": doc.filename[:500]} for doc in rows[offset : offset + limit]]
            return documents, len(rows)

    def get_internal(self, document_id: str) -> DocumentRecord:
        """Worker-side lookup by id (job payload already carries the owner)."""
        return self._docs[document_id]

    def mark_parsed(self, document_id: str, *, markdown: str, page_count: int) -> None:
        with self._lock:
            doc = self._docs[document_id]
            doc.markdown, doc.page_count, doc.status, doc.error_reason = markdown, page_count, "parsed", None
            self._source_bytes.pop(document_id, None)

    def mark_failed(self, document_id: str, reason: str) -> None:
        with self._lock:
            doc = self._docs[document_id]
            doc.status, doc.error_reason = "failed", reason

    def replace_structure(self, document_id: str, chapters: list[ChapterRecord], chunks: list[ChunkRecord]) -> None:
        """Idempotent: a retried structure job overwrites, never duplicates."""
        if len(chunks) > self._max_chunks_per_document:
            raise InvalidInput("document chunk limit reached")
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
        if type(limit) is not int or limit < 1:
            raise InvalidInput("embedding batch size must be a positive integer")
        doc = self._docs[document_id]
        return [c for c in doc.chunks if c.id not in self._embedded][: min(limit, self._max_embedding_batch)]

    def set_embedding(self, chunk_id: str, embedding: list[float]) -> None:
        self._embedded[chunk_id] = embedding

    def _snapshot_card(self, card: dict) -> None:
        versions = self._flashcard_versions.setdefault(card["id"], [])
        if not versions:
            versions.append({
                "version": 1,
                "front": card["front"],
                "back": card["back"],
                "chapter_id": card.get("chapter_id"),
                "source_chunk_id": card.get("source_chunk_id"),
                "source_quote": card.get("source_quote"),
                "source_revision": card.get("source_revision"),
                "tags": list(card.get("tags", [])),
            })


    def edit_flashcard(
        self, card_id: str, user_id: str, *, front: str | None = None, back: str | None = None,
        tags: list[str] | None = None,
    ) -> dict:
        with self._lock:
            card = self.get_flashcard_for_user(card_id, user_id)
            if card is None:
                raise NotFound("flashcard not found")
            self._snapshot_card(card)
            changed_content = (front is not None and front != card["front"]) or (
                back is not None and back != card["back"]
            )
            if front is not None:
                card["front"] = front
            if back is not None:
                card["back"] = back
            if tags is not None:
                card["tags"] = list(tags)
            if changed_content:
                versions = self._flashcard_versions.setdefault(card_id, [])
                versions.append({
                    "version": len(versions) + 1, "front": card["front"], "back": card["back"],
                    "chapter_id": card.get("chapter_id"), "source_chunk_id": card.get("source_chunk_id"),
                    "source_quote": card.get("source_quote"), "source_revision": card.get("source_revision"),
                    "tags": list(card.get("tags", [])),
                })
                card["needs_review"] = True
                card["due_date"] = datetime.now(UTC).date().isoformat()
            return card


    def retire_flashcard(self, card_id: str, user_id: str) -> dict:
        with self._lock:
            card = next(
                (row for (_doc_id, owner), rows in self._flashcards.items() if owner == user_id for row in rows
                 if row["id"] == card_id),
                None,
            )
            if card is None:
                raise NotFound("flashcard not found")
            card["status"] = "retired"
            return card


    def delete_flashcard(self, card_id: str, user_id: str) -> bool:
        with self._lock:
            for key, rows in self._flashcards.items():
                if key[1] != user_id:
                    continue
                before = len(rows)
                rows[:] = [row for row in rows if row["id"] != card_id]
                if len(rows) != before:
                    removed_reviews = [
                        row for row in self._reviews
                        if row.get("flashcard_id") == card_id and row.get("user_id") == user_id
                    ]
                    self._reviews[:] = [row for row in self._reviews if row not in removed_reviews]
                    for review in removed_reviews:
                        review_id = review.get("client_review_id")
                        if review_id is not None:
                            self._review_ids.discard(review_id)
                            self._review_results.pop((user_id, review_id), None)
                    self._flashcard_versions.pop(card_id, None)
                    self._quality_reports[:] = [row for row in self._quality_reports if row.get("card_id") != card_id]
                    return True
        return False


    def report_flashcard(self, card_id: str, user_id: str, reason: str) -> dict[str, object]:
        if self.get_flashcard_for_user(card_id, user_id) is None:
            raise NotFound("flashcard not found")
        report = {"card_id": card_id, "report_id": str(uuid.uuid4()), "reason": reason, "status": "received"}
        with self._lock:
            self._quality_reports.append(report)
        return report


    def due_review_count(self, user_id: str, today: str) -> int:
        return sum(
            card["due_date"] <= today and card.get("status", "active") == "active"
            for (_, owner), cards in self._flashcards.items()
            if owner == user_id
            for card in cards
        )


    # --- Flashcards (tasks 2.11, 2.12) — same surface as PgDocumentStore ----
    def delete_flashcards(self, document_id: str, user_id: str) -> None:
        self._flashcards.pop((document_id, user_id), None)

    def add_flashcards(self, cards: list[dict], *, document_id: str, user_id: str, due_date: str) -> int:
        with self._lock:
            doc = self._docs.get(document_id)
            if doc is None or doc.user_id != user_id:
                raise NotFound("document not found")
            drafts = _validated_cards(cards, doc)
            existing = self._flashcards.get((document_id, user_id), [])
            by_id = {card["id"]: card for values in self._flashcards.values() for card in values}
            by_fingerprint = {
                (
                    card["chapter_id"],
                    card["source_chunk_id"],
                    " ".join(card["front"].split()),
                    " ".join(card["back"].split()),
                )
                for card in existing
            }
            rows = []
            for draft in drafts:
                identity = (
                    draft["chapter_id"],
                    draft["source_chunk_id"],
                    " ".join(draft["front"].split()),
                    " ".join(draft["back"].split()),
                )
                existing_by_id = by_id.get(draft["id"])
                if existing_by_id is not None:
                    if existing_by_id.get("source_revision") == draft["source_revision"] and identity in by_fingerprint:
                        continue
                    raise InvalidInput("generated card id is already in use")
                if identity in by_fingerprint:
                    continue
                rows.append(
                    {
                        "ease_factor": 2.5,
                        "interval_days": 0,
                        "repetitions": 0,
                        **draft,
                        "due_date": due_date,
                        "document_id": document_id,
                        "user_id": user_id,
                    }
                )
                by_fingerprint.add(identity)
                by_id[draft["id"]] = rows[-1]
            if len(existing) + len(rows) > self._max_flashcards_per_deck:
                raise InvalidInput("flashcard deck limit reached for this account and document")
            default_deck_id = str(uuid.uuid5(
                uuid.NAMESPACE_URL, f"studyvault:deck:{user_id}:{document_id}:True:Default"
            ))
            for row in rows:
                row.update(deck_id=default_deck_id, status="active", needs_review=False)
                self._snapshot_card(row)
            self._flashcards.setdefault((document_id, user_id), []).extend(rows)
            return len(rows)

    def list_flashcards(
        self, document_id: str, user_id: str, *, limit: int = 100, offset: int = 0,
        deck_id: str | None = None, include_retired: bool = False,
    ) -> list[dict]:
        limit, offset = _bounded_page(limit, offset, self._max_page_size)
        cards = [
            card for card in self._flashcards.get((document_id, user_id), [])
            if (deck_id is None or card.get("deck_id") == deck_id)
            and (include_retired or card.get("status", "active") == "active")
        ]
        for card in cards:
            self._snapshot_card(card)
        return sorted(cards, key=lambda card: (card["due_date"], card["id"]))[offset : offset + limit]

    def merge_flashcards(self, cards: list[dict], *, document_id: str, user_id: str, due_date: str) -> int:
        """Additive, idempotent publication preserves every old card and review schedule."""
        self.add_flashcards(cards, document_id=document_id, user_id=user_id, due_date=due_date)
        return len(self._flashcards.get((document_id, user_id), []))

    def due_flashcards(self, user_id: str, today: str, *, limit: int = 100, offset: int = 0) -> list[dict]:
        limit, offset = _bounded_page(limit, offset, self._max_page_size)
        out = [
            c
            for (_doc_id, uid), cards in self._flashcards.items()
            if uid == user_id
            for c in cards
            if c["due_date"] <= today and c.get("status", "active") == "active"
        ]
        return sorted(out, key=lambda c: (c["due_date"], c["id"]))[offset : offset + limit]

    def get_flashcard_for_user(self, card_id: str, user_id: str) -> dict | None:
        for (_doc_id, uid), cards in self._flashcards.items():
            if uid != user_id:
                continue
            for c in cards:
                if c["id"] == card_id and c.get("status", "active") == "active":
                    return c
        return None

    def update_flashcard_sm2(self, card_id: str, *, ease: float, interval_days: int, reps: int, due: str) -> None:
        for (_doc_id, _uid), cards in self._flashcards.items():
            for c in cards:
                if c["id"] == card_id:
                    c.update(ease_factor=ease, interval_days=interval_days, repetitions=reps, due_date=due)

    def add_review(self, *, card_id: str, user_id: str, grade: int, client_review_id: str | None = None) -> bool:
        if client_review_id is not None:
            key = _review_key(client_review_id)
            if key in self._review_ids:
                return False
            self._review_ids.add(key)
        else:
            key = None
        self._reviews.append({"flashcard_id": card_id, "user_id": user_id, "grade": grade, "client_review_id": key})
        return True

    def atomic_review(
        self, *, card_id: str, user_id: str, grade: int, review_id: str | None = None, now: datetime | None = None
    ) -> dict:
        if type(grade) is not int or not 0 <= grade <= 5:
            raise InvalidInput("grade must be an integer from 0 to 5")
        key, timestamp = _review_key(review_id), _review_now(now)
        with self._lock:
            card = self.get_flashcard_for_user(card_id, user_id)
            if card is None:
                raise NotFound("flashcard not found")
            saved = self._review_results.get((user_id, key))
            if saved is not None:
                saved_card, saved_grade, result = saved
                if saved_card != card_id or saved_grade != grade:
                    raise InvalidInput("review_id was already used for another review")
                return {**result, "replayed": True}
            if key in self._review_ids:
                prior = next(
                    (row for row in self._reviews if row.get("client_review_id") == key and row["user_id"] == user_id),
                    None,
                )
                if prior is None or prior["flashcard_id"] != card_id or prior["grade"] != grade:
                    raise InvalidInput("review_id is already in use; refresh the review queue")
                result = {
                    "id": card_id,
                    "ease_factor": card["ease_factor"],
                    "interval_days": card["interval_days"],
                    "repetitions": card["repetitions"],
                    "due_date": card["due_date"],
                    "replayed": False,
                }
                self._review_results[(user_id, key)] = (card_id, grade, result)
                prior["result"] = result
                return {**result, "replayed": True}
            result = _review_schedule(card, grade, timestamp)
            card.update({name: result[name] for name in ("ease_factor", "interval_days", "repetitions", "due_date")})
            card["needs_review"] = False
            self._review_ids.add(key)
            self._reviews.append(
                {
                    "flashcard_id": card_id,
                    "user_id": user_id,
                    "grade": grade,
                    "client_review_id": key,
                    "result": dict(result),
                }
            )
            self._review_results[(user_id, key)] = (card_id, grade, dict(result))
            return result

    def get_flashcard_source_for_user(self, card_id: str, user_id: str) -> dict | None:
        card = self.get_flashcard_for_user(card_id, user_id)
        if card is None:
            return None
        document = self.get_for_user(str(card.get("document_id", "")), user_id)
        if document is None:
            return None
        chunk = next(
            (
                item
                for item in document.chunks
                if item.id == card.get("source_chunk_id")
                and item.chapter_id == card.get("chapter_id")
                and item.user_id == user_id
            ),
            None,
        )
        quote = card.get("source_quote")
        if (
            chunk is None
            or not isinstance(quote, str)
            or not quote.strip()
            or quote not in chunk.content
            or card.get("source_revision")
            != _source_revision(
                document.id, str(card["chapter_id"]), str(card["source_chunk_id"]), chunk.content, quote
            )
        ):
            return None
        return {
            "card_id": card_id,
            "document_id": document.id,
            "chapter_id": chunk.chapter_id,
            "source_chunk_id": chunk.id,
            "front": card["front"],
            "back": card["back"],
            "source_text": chunk.content[:4000],
            "source_quote": quote,
            "page": chunk.page,
        }

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
