"""Postgres-backed document/chapter/chunk store (tasks 2.1, 2.4, 2.7).

Mirrors the Drizzle schema in packages/db so web and ai-service share one
source of truth. Every read is scoped by user_id (privacy hard rule).
"""

import json
import logging
from datetime import datetime
from typing import Any, Literal

from app.documents.store import (
    ChapterRecord,
    ChunkRecord,
    DocumentRecord,
    _bounded_page,
    _review_key,
    _review_now,
    _review_schedule,
    _source_revision,
    _validated_cards,
)
from app.errors import InvalidInput, NotFound

logger = logging.getLogger("studyvault.documents")

DocumentStatus = Literal["pending", "parsed", "failed"]


def _doc(row: tuple) -> DocumentRecord:
    (rid, user_id, filename, mime, size, page_count, status, markdown, err) = row
    d = DocumentRecord(
        id=str(rid),
        user_id=str(user_id),
        filename=filename,
        mime_type=mime,
        size_bytes=size,
        page_count=page_count,
        status=status,
        markdown=markdown,
        error_reason=err,
    )
    return d


def _chapter(row: tuple) -> ChapterRecord:
    rid, doc_id, user_id, title, ordinal, sp, ep = row
    return ChapterRecord(
        id=str(rid),
        document_id=str(doc_id),
        user_id=str(user_id),
        title=title,
        ordinal=ordinal,
        start_page=sp,
        end_page=ep,
    )


def _chunk(row: tuple) -> ChunkRecord:
    rid, doc_id, user_id, chapter_id, content, page, ordinal = row
    return ChunkRecord(
        id=str(rid),
        document_id=str(doc_id),
        user_id=str(user_id),
        chapter_id=str(chapter_id) if chapter_id else None,
        content=content,
        page=page,
        ordinal=ordinal,
    )


def _document_in_transaction(cur: Any, document_id: str, user_id: str) -> DocumentRecord:
    """Load only an owner's source graph inside the publication transaction."""
    cur.execute(
        "SELECT id,user_id,filename,mime_type,size_bytes,page_count,status,markdown,error_reason "
        "FROM documents WHERE id=%s AND user_id=%s FOR UPDATE",
        (document_id, user_id),
    )
    row = cur.fetchone()
    if row is None:
        raise NotFound("document not found")
    document = _doc(row)
    cur.execute(
        "SELECT id,document_id,user_id,title,ordinal,start_page,end_page FROM chapters "
        "WHERE document_id=%s AND user_id=%s ORDER BY ordinal FOR SHARE",
        (document_id, user_id),
    )
    document.chapters = [_chapter(item) for item in cur.fetchall()]
    cur.execute(
        "SELECT id,document_id,user_id,chapter_id,content,page,ordinal FROM chunks "
        "WHERE document_id=%s AND user_id=%s ORDER BY ordinal FOR SHARE",
        (document_id, user_id),
    )
    document.chunks = [_chunk(item) for item in cur.fetchall()]
    return document


class PgDocumentStore:
    """Drop-in for InMemoryDocumentStore; same method surface."""

    def __init__(
        self,
        database_url: str,
        *,
        max_documents_per_user: int = 100,
        max_chunks_per_document: int = 5000,
        max_flashcards_per_deck: int = 2000,
        max_embedding_batch: int = 500,
        max_page_size: int = 100,
    ) -> None:
        import psycopg

        limits = (
            max_documents_per_user,
            max_chunks_per_document,
            max_flashcards_per_deck,
            max_embedding_batch,
            max_page_size,
        )
        if any(type(limit) is not int or limit <= 0 for limit in limits):
            raise ValueError("document, batch, and page limits must be positive integers")
        self._max_documents_per_user = max_documents_per_user
        self._max_chunks_per_document = max_chunks_per_document
        self._max_flashcards_per_deck = max_flashcards_per_deck
        self._max_embedding_batch = max_embedding_batch
        self._max_page_size = max_page_size
        self._database_url = database_url
        self._conn = psycopg.connect(database_url, autocommit=True)

    def _connect_for_atomic(self):
        """Do not interleave transaction state on the legacy shared connection."""
        import psycopg

        return psycopg.connect(self._database_url, autocommit=True, connect_timeout=5)


    def healthcheck(self) -> None:
        with self._conn.cursor() as cur:
            cur.execute("SELECT 1")
            if cur.fetchone() != (1,):
                raise RuntimeError("document database health check returned an invalid result")

    def resolve_user(self, clerk_id: str, email: str | None = None) -> str:
        """Map a Clerk subject to the internal `users.id` (uuid).

        The webhook writes the full row; this covers the window before it lands
        (and any request that arrives first) with a placeholder email the
        webhook later overwrites.
        """
        with self._conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE clerk_id=%s", (clerk_id,))
            row = cur.fetchone()
            if row is not None:
                return str(row[0])
            cur.execute(
                "INSERT INTO users (clerk_id, email) VALUES (%s, %s)"
                " ON CONFLICT (clerk_id) DO UPDATE SET email=EXCLUDED.email"
                " RETURNING id",
                (clerk_id, email or f"{clerk_id}@clerk-pending.invalid"),
            )
            return str(cur.fetchone()[0])

    def create(
        self, *, user_id: str, filename: str, mime_type: str, size_bytes: int, source_bytes: bytes | None = None
    ) -> DocumentRecord:
        with self._conn.transaction(), self._conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (user_id,))
            if cur.fetchone() is None:
                raise NotFound("document owner not found")
            cur.execute("SELECT count(*) FROM documents WHERE user_id=%s", (user_id,))
            if int(cur.fetchone()[0]) >= self._max_documents_per_user:
                raise InvalidInput("document limit reached for this account")
            cur.execute(
                "INSERT INTO documents (user_id, filename, mime_type, size_bytes, status, source_bytes)"
                " VALUES (%s, %s, %s, %s, 'pending', %s)"
                " RETURNING id, user_id, filename, mime_type, size_bytes, page_count, status, markdown, error_reason",
                (user_id, filename, mime_type, size_bytes, source_bytes),
            )
            return _doc(cur.fetchone())

    def take_source_bytes(self, document_id: str) -> bytes | None:
        """Read upload bytes; mark_parsed clears them only after text commit."""
        with self._conn.cursor() as cur:
            cur.execute("SELECT source_bytes FROM documents WHERE id=%s", (document_id,))
            row = cur.fetchone()
            if row is None or row[0] is None:
                return None
            return bytes(row[0])

    def read_source_bytes(self, document_id: str, user_id: str) -> bytes | None:
        with self._conn.cursor() as cur:
            cur.execute("SELECT source_bytes FROM documents WHERE id=%s AND user_id=%s", (document_id, user_id))
            row = cur.fetchone()
        return bytes(row[0]) if row and row[0] is not None else None

    def get_internal(self, document_id: str) -> DocumentRecord:
        """Worker-side lookup by id (owner is in the job payload). Loads
        chapters + chunks so callers have the same shape as the in-memory store."""
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, user_id, filename, mime_type, size_bytes, page_count, status, markdown, error_reason"
                " FROM documents WHERE id=%s",
                (document_id,),
            )
            row = cur.fetchone()
            if row is None:
                raise KeyError(document_id)
            doc = _doc(row)
            doc.chapters = self._chapters_for(document_id)
            doc.chunks = self._chunks_for(document_id)
            return doc

    def get_for_user(self, document_id: str, user_id: str) -> DocumentRecord | None:
        try:
            doc = self.get_internal(document_id)
        except KeyError:
            return None
        return doc if doc.user_id == user_id else None

    def owns_document(self, document_id: str, user_id: str) -> bool:
        with self._connect_for_atomic() as conn:
            row = conn.execute(
                "SELECT EXISTS(SELECT 1 FROM documents WHERE id=%s AND user_id=%s)",
                (document_id, user_id),
            ).fetchone()
        return bool(row[0]) if row else False

    def list_chapters_for_user(self, document_id: str, user_id: str) -> list[ChapterRecord] | None:
        # The left join keeps the distinction between an owned document without
        # chapters yet and a document the caller cannot access. An independent
        # connection cannot observe the worker's incomplete publication transaction.
        with self._connect_for_atomic() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT c.id, c.document_id, c.user_id, c.title, c.ordinal, c.start_page, c.end_page "
                "FROM documents d LEFT JOIN chapters c ON c.document_id=d.id AND c.user_id=d.user_id "
                "WHERE d.id=%s AND d.user_id=%s ORDER BY c.ordinal",
                (document_id, user_id),
            )
            rows = cur.fetchall()
            return [_chapter(row) for row in rows if row[0] is not None] if rows else None

    def list_library_documents(self, user_id: str, *, limit: int, offset: int) -> tuple[list[dict[str, str]], int]:
        with self._connect_for_atomic() as conn:
            rows = conn.execute(
                "SELECT id, filename FROM documents WHERE user_id=%s "
                "ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s",
                (user_id, limit, offset),
            ).fetchall()
            count = conn.execute("SELECT count(*) FROM documents WHERE user_id=%s", (user_id,)).fetchone()
        return [{"id": str(row[0]), "title": str(row[1])[:500]} for row in rows], int(count[0]) if count else 0

    def mark_parsed(self, document_id: str, *, markdown: str, page_count: int) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                "UPDATE documents SET markdown=%s, page_count=%s, status='parsed', source_bytes=NULL,"
                " error_reason=NULL, updated_at=now() WHERE id=%s",
                (markdown, page_count, document_id),
            )

    def mark_failed(self, document_id: str, reason: str) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                "UPDATE documents SET status='failed', error_reason=%s, updated_at=now() WHERE id=%s",
                (reason, document_id),
            )

    def replace_structure(self, document_id: str, chapters: list[ChapterRecord], chunks: list[ChunkRecord]) -> None:
        """Idempotent: a retried structure job overwrites, never duplicates."""
        if len(chunks) > self._max_chunks_per_document:
            raise InvalidInput("document chunk limit reached")
        with self._conn.transaction():
            with self._conn.cursor() as cur:
                cur.execute("SELECT user_id FROM documents WHERE id=%s", (document_id,))
                owner = cur.fetchone()
                if owner is None:
                    raise NotFound("document not found")
                user_id = str(owner[0])
                cur.execute("SELECT id FROM users WHERE id=%s FOR KEY SHARE", (user_id,))
                if cur.fetchone() is None:
                    raise NotFound("document owner not found")
                # Flashcard generation and merge lock this row while reading its
                # chapters/chunks, so publication sees one complete source revision.
                cur.execute(
                    "SELECT id FROM documents WHERE id=%s AND user_id=%s FOR UPDATE",
                    (document_id, user_id),
                )
                if cur.fetchone() is None:
                    raise NotFound("document not found")
                cur.execute("DELETE FROM chunks WHERE document_id=%s", (document_id,))
                cur.execute("DELETE FROM chapters WHERE document_id=%s", (document_id,))
                cur.executemany(
                    "INSERT INTO chapters (id, document_id, user_id, title, ordinal, start_page, end_page)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (
                        (c.id, c.document_id, c.user_id, c.title, c.ordinal, c.start_page, c.end_page)
                        for c in chapters
                    ),
                )
                cur.executemany(
                    "INSERT INTO chunks (id, document_id, user_id, chapter_id, content, page, ordinal)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    ((c.id, c.document_id, c.user_id, c.chapter_id, c.content, c.page, c.ordinal) for c in chunks),
                )

    def _chapters_for(self, document_id: str) -> list[ChapterRecord]:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, document_id, user_id, title, ordinal, start_page, end_page"
                " FROM chapters WHERE document_id=%s ORDER BY ordinal",
                (document_id,),
            )
            return [_chapter(r) for r in cur.fetchall()]

    def _chunks_for(self, document_id: str) -> list[ChunkRecord]:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, document_id, user_id, chapter_id, content, page, ordinal"
                " FROM chunks WHERE document_id=%s ORDER BY ordinal",
                (document_id,),
            )
            return [_chunk(r) for r in cur.fetchall()]

    # --- Embeddings (task 2.8) ----------------------------------------------
    def chunks_missing_embeddings(self, document_id: str, limit: int = 500) -> list[ChunkRecord]:
        if type(limit) is not int or limit < 1:
            raise InvalidInput("embedding batch size must be a positive integer")
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, document_id, user_id, chapter_id, content, page, ordinal"
                " FROM chunks WHERE document_id=%s AND embedding IS NULL ORDER BY ordinal LIMIT %s",
                (document_id, min(limit, self._max_embedding_batch)),
            )
            return [_chunk(r) for r in cur.fetchall()]

    def set_embedding(self, chunk_id: str, embedding: list[float]) -> None:
        lit = "[" + ",".join(f"{x:.6f}" for x in embedding) + "]"
        with self._conn.cursor() as cur:
            cur.execute("UPDATE chunks SET embedding=%s::vector, updated_at=now() WHERE id=%s", (lit, chunk_id))

    # --- Summaries (task 2.5) -----------------------------------------------
    def get_summary(self, chapter_id: str, level: str, user_id: str | None = None) -> dict[str, Any] | None:
        with self._conn.cursor() as cur:
            if user_id is None:
                cur.execute(
                    "SELECT id, chapter_id, level, content, model FROM summaries WHERE chapter_id=%s AND level=%s",
                    (chapter_id, level),
                )
            else:
                cur.execute(
                    "SELECT id, chapter_id, level, content, model FROM summaries"
                    " WHERE chapter_id=%s AND level=%s AND user_id=%s",
                    (chapter_id, level, user_id),
                )
            row = cur.fetchone()
        if row is None:
            return None
        return {"id": str(row[0]), "chapter_id": str(row[1]), "level": row[2], "content": row[3], "model": row[4]}

    def upsert_summary(
        self, *, chapter_id: str, user_id: str, level: str, content: str, model: str | None
    ) -> dict[str, Any]:
        with self._conn.cursor() as cur:
            cur.execute(
                "INSERT INTO summaries (chapter_id, user_id, level, content, model)"
                " VALUES (%s, %s, %s, %s, %s)"
                " ON CONFLICT (chapter_id, level) DO UPDATE"
                " SET content=EXCLUDED.content, model=EXCLUDED.model, updated_at=now()"
                " RETURNING id, chapter_id, level, content, model",
                (chapter_id, user_id, level, content, model),
            )
            row = cur.fetchone()
        return {"id": str(row[0]), "chapter_id": str(row[1]), "level": row[2], "content": row[3], "model": row[4]}

    def get_chapter_for_user(self, chapter_id: str, user_id: str) -> tuple[ChapterRecord, DocumentRecord] | None:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, document_id, user_id, title, ordinal, start_page, end_page"
                " FROM chapters WHERE id=%s AND user_id=%s",
                (chapter_id, user_id),
            )
            row = cur.fetchone()
        if row is None:
            return None
        chapter = _chapter(row)
        doc = self.get_for_user(chapter.document_id, user_id)
        return (chapter, doc) if doc is not None else None

    # --- Retrieval (task 2.9) ------------------------------------------------
    def hybrid_search(
        self,
        *,
        document_id: str,
        user_id: str,
        query_text: str,
        embedding: list[float] | None = None,
        limit: int = 8,
    ) -> list[tuple[ChunkRecord, float]]:
        """pgvector semantic + Postgres FTS fused with Reciprocal Rank Fusion.

        Returns (chunk, fused_score) ordered best-first. A chunk with no
        embedding still matches via FTS.
        """
        from app.rag.rrf import reciprocal_rank_fusion

        with self._conn.cursor() as cur:
            # Full-text ranking (ts_rank; English stemmer).
            cur.execute(
                "SELECT id FROM chunks"
                " WHERE document_id=%s AND user_id=%s"
                "   AND to_tsvector('english', content) @@ plainto_tsquery('english', %s)"
                " ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', %s)) DESC"
                " LIMIT %s",
                (document_id, user_id, query_text, query_text, limit * 4),
            )
            fts_ids = [str(r[0]) for r in cur.fetchall()]

            vec_ids: list[str] = []
            if embedding is not None:
                lit = "[" + ",".join(f"{x:.6f}" for x in embedding) + "]"
                cur.execute(
                    "SELECT id FROM chunks WHERE document_id=%s AND user_id=%s AND embedding IS NOT NULL"
                    " ORDER BY embedding <=> %s::vector LIMIT %s",
                    (document_id, user_id, lit, limit * 4),
                )
                vec_ids = [str(r[0]) for r in cur.fetchall()]

        fused = reciprocal_rank_fusion([vec_ids, fts_ids])[: limit * 2]
        if not fused:
            return []
        ids = [cid for cid, _ in fused]
        score_by_id = dict(fused)
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, document_id, user_id, chapter_id, content, page, ordinal"
                " FROM chunks WHERE id = ANY(%s::uuid[])",
                (ids,),
            )
            chunks = [_chunk(r) for r in cur.fetchall()]
        out = [(c, score_by_id[c.id]) for c in chunks]
        out.sort(key=lambda t: -t[1])
        return out[:limit]

    # --- Flashcards (tasks 2.11, 2.12) --------------------------------------
    def delete_flashcards(self, document_id: str, user_id: str) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                "DELETE FROM flashcards WHERE document_id=%s AND user_id=%s",
                (document_id, user_id),
            )

    def add_flashcards(
        self,
        cards: list[dict[str, Any]],
        *,
        document_id: str,
        user_id: str,
        due_date: str,
    ) -> int:
        """Insert generated cards; returns count written."""
        with self._conn.transaction():
            with self._conn.cursor() as cur:
                doc = _document_in_transaction(cur, document_id, user_id)
                drafts = _validated_cards(cards, doc)
                cur.execute(
                    "SELECT id,chapter_id,source_chunk_id,front,back FROM flashcards "
                    "WHERE document_id=%s AND user_id=%s FOR UPDATE",
                    (document_id, user_id),
                )
                existing = cur.fetchall()
                known_ids = {str(row[0]) for row in existing}
                fingerprints = {
                    (
                        str(row[1]),
                        str(row[2]) if row[2] else None,
                        " ".join(str(row[3]).split()),
                        " ".join(str(row[4]).split()),
                    )
                    for row in existing
                }
                additions: list[dict[str, Any]] = []
                for draft in drafts:
                    fingerprint = (
                        draft["chapter_id"],
                        draft["source_chunk_id"],
                        " ".join(draft["front"].split()),
                        " ".join(draft["back"].split()),
                    )
                    if fingerprint in fingerprints:
                        continue
                    if draft["id"] in known_ids:
                        raise InvalidInput("generated card id is already in use")
                    additions.append(draft)
                    known_ids.add(draft["id"])
                    fingerprints.add(fingerprint)
                cur.execute(
                    "SELECT count(*) FROM flashcards WHERE document_id=%s AND user_id=%s", (document_id, user_id)
                )
                if int(cur.fetchone()[0]) + len(additions) > self._max_flashcards_per_deck:
                    raise InvalidInput("flashcard deck limit reached for this document")
                for c in additions:
                    cur.execute(
                        "INSERT INTO flashcards (id, document_id, chapter_id, source_chunk_id, user_id,"
                        " front, back, source_quote, source_revision, due_date, tags)"
                        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)",
                        (
                            c["id"],
                            document_id,
                            c["chapter_id"],
                            c["source_chunk_id"],
                            user_id,
                            c["front"],
                            c["back"],
                            c["source_quote"],
                            c["source_revision"],
                            due_date,
                            json.dumps(c["tags"]),
                        ),
                    )
        return len(additions)

    def merge_flashcards(self, cards: list[dict[str, Any]], *, document_id: str, user_id: str, due_date: str) -> int:
        """Add validated cards without replacing stable IDs or reviewed schedules."""
        with self._connect_for_atomic() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (user_id,))
            if cur.fetchone() is None:
                raise NotFound("document owner not found")
            doc = _document_in_transaction(cur, document_id, user_id)
            drafts = _validated_cards(cards, doc)
            cur.execute(
                "SELECT id,chapter_id,source_chunk_id,front,back FROM flashcards "
                "WHERE document_id=%s AND user_id=%s FOR UPDATE",
                (document_id, user_id),
            )
            existing = cur.fetchall()
            known_ids = {str(row[0]) for row in existing}
            fingerprints = {
                (
                    str(row[1]),
                    str(row[2]) if row[2] else None,
                    " ".join(str(row[3]).split()),
                    " ".join(str(row[4]).split()),
                )
                for row in existing
            }
            additions: list[dict[str, Any]] = []
            for draft in drafts:
                fingerprint = (
                    draft["chapter_id"],
                    draft["source_chunk_id"],
                    " ".join(draft["front"].split()),
                    " ".join(draft["back"].split()),
                )
                if fingerprint in fingerprints:
                    continue
                if draft["id"] in known_ids:
                    raise InvalidInput("generated card id is already in use")
                additions.append(draft)
                known_ids.add(draft["id"])
                fingerprints.add(fingerprint)
            cur.execute("SELECT count(*) FROM flashcards WHERE document_id=%s AND user_id=%s", (document_id, user_id))
            if int(cur.fetchone()[0]) + len(additions) > self._max_flashcards_per_deck:
                raise InvalidInput("flashcard limit reached for this document")
            for card in additions:
                cur.execute(
                    "INSERT INTO flashcards (id,document_id,chapter_id,source_chunk_id,user_id,front,back,"
                    "source_quote,source_revision,due_date,tags) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)",
                    (
                        card["id"],
                        document_id,
                        card["chapter_id"],
                        card["source_chunk_id"],
                        user_id,
                        card["front"],
                        card["back"],
                        card["source_quote"],
                        card["source_revision"],
                        due_date,
                        json.dumps(card["tags"]),
                    ),
                )
            cur.execute("SELECT count(*) FROM flashcards WHERE document_id=%s AND user_id=%s", (document_id, user_id))
            return int(cur.fetchone()[0])

    def list_flashcards(
        self, document_id: str, user_id: str, *, deck_id: str | None = None,
        include_retired: bool = False, limit: int = 100, offset: int = 0,
    ) -> list[dict[str, Any]]:
        limit, offset = _bounded_page(limit, offset, self._max_page_size)
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id,front,back,ease_factor,interval_days,repetitions,due_date,"
                "chapter_id,source_chunk_id,source_quote,source_revision,deck_id,tags,status,needs_review "
                "FROM flashcards WHERE document_id=%s AND user_id=%s "
                "AND (%s::uuid IS NULL OR deck_id=%s) AND (%s OR status='active') "
                "ORDER BY due_date,created_at,id LIMIT %s OFFSET %s",
                (document_id, user_id, deck_id, deck_id, include_retired, limit, offset),
            )
            return [
                {
                    "id": str(row[0]), "front": row[1], "back": row[2], "ease_factor": row[3],
                    "interval_days": row[4], "repetitions": row[5], "due_date": row[6],
                    "chapter_id": str(row[7]) if row[7] else None,
                    "source_chunk_id": str(row[8]) if row[8] else None,
                    "source_quote": row[9], "source_revision": row[10], "deck_id": str(row[11]),
                    "tags": row[12] or [], "status": row[13], "needs_review": row[14],
                }
                for row in cur.fetchall()
            ]

    def due_flashcards(self, user_id: str, today: str, *, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        """SM-2 review queue: cards due on or before `today` (YYYY-MM-DD)."""
        limit, offset = _bounded_page(limit, offset, self._max_page_size)
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, front, back, ease_factor, interval_days, repetitions, due_date, document_id"
                ", source_quote, source_revision FROM flashcards "
                "WHERE user_id=%s AND due_date <= %s AND status='active' "
                "ORDER BY due_date,id LIMIT %s OFFSET %s",
                (user_id, today, limit, offset),
            )
            return [
                {
                    "id": str(r[0]),
                    "front": r[1],
                    "back": r[2],
                    "ease_factor": r[3],
                    "interval_days": r[4],
                    "repetitions": r[5],
                    "due_date": r[6],
                    "document_id": str(r[7]),
                    "source_quote": r[8],
                    "source_revision": r[9],
                }
                for r in cur.fetchall()
            ]

    def get_flashcard_for_user(self, card_id: str, user_id: str) -> dict[str, Any] | None:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id,front,back,ease_factor,interval_days,repetitions,due_date,document_id,chapter_id,"
                "source_chunk_id,source_quote,source_revision,deck_id,tags,status,needs_review"
                " FROM flashcards WHERE id=%s AND user_id=%s AND status='active'",
                (card_id, user_id),
            )
            r = cur.fetchone()
        if r is None:
            return None
        return {
            "id": str(r[0]),
            "front": r[1],
            "back": r[2],
            "ease_factor": r[3],
            "interval_days": r[4],
            "repetitions": r[5],
            "due_date": r[6],
            "document_id": str(r[7]),
            "chapter_id": str(r[8]) if r[8] else None,
            "source_chunk_id": str(r[9]) if r[9] else None,
            "source_quote": r[10],
            "source_revision": r[11],
            "deck_id": str(r[12]),
            "tags": r[13] or [],
            "status": r[14],
            "needs_review": r[15],
        }

    def edit_flashcard(
        self, card_id: str, user_id: str, *, front: str | None = None, back: str | None = None,
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        with self._connect_for_atomic() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute(
                "SELECT id,document_id,chapter_id,source_chunk_id,source_quote,source_revision,front,back,tags "
                "FROM flashcards WHERE id=%s AND user_id=%s AND status='active' FOR UPDATE",
                (card_id, user_id),
            )
            row = cur.fetchone()
            if row is None:
                raise NotFound("flashcard not found")
            next_front, next_back = front or row[6], back or row[7]
            changed_content = next_front != row[6] or next_back != row[7]
            next_tags = tags if tags is not None else (row[8] or [])
            cur.execute(
                "UPDATE flashcards SET front=%s,back=%s,tags=%s::jsonb,needs_review=(needs_review OR %s),"
                "due_date=CASE WHEN %s THEN CURRENT_DATE::text ELSE due_date END,updated_at=now() "
                "WHERE id=%s AND user_id=%s RETURNING id,front,back,ease_factor,interval_days,repetitions,due_date,"
                "tags,status,needs_review",
                (next_front, next_back, json.dumps(next_tags), changed_content, changed_content, card_id, user_id),
            )
            result = cur.fetchone()
        return {
            "id": str(result[0]), "front": result[1], "back": result[2], "ease_factor": result[3],
            "interval_days": result[4], "repetitions": result[5], "due_date": result[6],
            "tags": result[7] or [], "status": result[8], "needs_review": result[9],
        }


    def retire_flashcard(self, card_id: str, user_id: str) -> dict[str, Any]:
        with self._conn.cursor() as cur:
            cur.execute(
                "UPDATE flashcards SET status='retired',updated_at=now() WHERE id=%s AND user_id=%s "
                "AND status='active' RETURNING id,front,back,ease_factor,interval_days,repetitions,due_date,"
                "tags,status,needs_review",
                (card_id, user_id),
            )
            row = cur.fetchone()
        if row is None:
            raise NotFound("flashcard not found")
        return {
            "id": str(row[0]), "front": row[1], "back": row[2], "ease_factor": row[3],
            "interval_days": row[4], "repetitions": row[5], "due_date": row[6], "tags": row[7] or [],
            "status": row[8], "needs_review": row[9],
        }


    def delete_flashcard(self, card_id: str, user_id: str) -> bool:
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM flashcards WHERE id=%s AND user_id=%s RETURNING id", (card_id, user_id))
            return cur.fetchone() is not None


    def report_flashcard(self, card_id: str, user_id: str, reason: str) -> dict[str, object]:
        with self._conn.cursor() as cur:
            cur.execute("SELECT id FROM flashcards WHERE id=%s AND user_id=%s", (card_id, user_id))
            if cur.fetchone() is None:
                raise NotFound("flashcard not found")
            cur.execute(
                "INSERT INTO flashcard_quality_reports(card_id,user_id,reason) VALUES (%s,%s,%s) RETURNING id",
                (card_id, user_id, reason),
            )
            report_id = cur.fetchone()[0]
        return {"card_id": card_id, "report_id": str(report_id), "status": "received"}


    def due_review_count(self, user_id: str, today: str) -> int:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM flashcards WHERE user_id=%s AND due_date <= %s AND status='active'",
                (user_id, today),
            )
            return cur.fetchone()[0]


    def update_flashcard_sm2(self, card_id: str, *, ease: float, interval_days: int, reps: int, due: str) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                "UPDATE flashcards SET ease_factor=%s, interval_days=%s, repetitions=%s,"
                " due_date=%s, updated_at=now() WHERE id=%s",
                (ease, interval_days, reps, due, card_id),
            )

    def add_review(self, *, card_id: str, user_id: str, grade: int, client_review_id: str | None = None) -> bool:
        """Append a review. Returns False when the client id was already recorded,
        so a replayed offline review is not applied twice (task 3.4)."""
        with self._conn.cursor() as cur:
            cur.execute(
                "INSERT INTO reviews (flashcard_id, user_id, grade, client_review_id)"
                " VALUES (%s, %s, %s, %s)"
                " ON CONFLICT (client_review_id) DO NOTHING"
                " RETURNING id",
                (card_id, user_id, grade, client_review_id),
            )
            return cur.fetchone() is not None

    def atomic_review(
        self, *, card_id: str, user_id: str, grade: int, review_id: str | None = None, now: datetime | None = None
    ) -> dict[str, Any]:
        """Commit the review, SM-2 schedule, and replay result in one transaction."""
        if type(grade) is not int or not 0 <= grade <= 5:
            raise InvalidInput("grade must be an integer from 0 to 5")
        key, timestamp = _review_key(review_id), _review_now(now)
        with self._connect_for_atomic() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (user_id,))
            if cur.fetchone() is None:
                raise NotFound("flashcard owner not found")
            cur.execute(
                "SELECT id,ease_factor,interval_days,repetitions,due_date FROM flashcards "
                "WHERE id=%s AND user_id=%s AND status='active' FOR UPDATE",
                (card_id, user_id),
            )
            row = cur.fetchone()
            if row is None:
                raise NotFound("flashcard not found")
            card = {
                "id": str(row[0]),
                "ease_factor": row[1],
                "interval_days": row[2],
                "repetitions": row[3],
                "due_date": str(row[4]),
            }
            cur.execute(
                "SELECT flashcard_id,grade,result FROM reviews WHERE user_id=%s AND client_review_id=%s", (user_id, key)
            )
            saved = cur.fetchone()
            if saved:
                return self._replay_review(cur, saved, card, user_id, key, grade)
            result = _review_schedule(card, grade, timestamp)
            cur.execute(
                "INSERT INTO reviews (flashcard_id,user_id,grade,client_review_id,result,reviewed_at) "
                "VALUES (%s,%s,%s,%s,%s::jsonb,%s) ON CONFLICT (client_review_id) DO NOTHING RETURNING id",
                (card_id, user_id, grade, key, json.dumps(result), timestamp),
            )
            if cur.fetchone() is None:
                cur.execute(
                    "SELECT flashcard_id,grade,result FROM reviews WHERE user_id=%s AND client_review_id=%s",
                    (user_id, key),
                )
                saved = cur.fetchone()
                if saved is None:
                    raise InvalidInput("review_id is already in use; refresh the review queue")
                return self._replay_review(cur, saved, card, user_id, key, grade)
            cur.execute(
                "UPDATE flashcards SET ease_factor=%s,interval_days=%s,repetitions=%s,"
                "due_date=%s,needs_review=false,updated_at=%s "
                "WHERE id=%s AND user_id=%s",
                (
                    result["ease_factor"],
                    result["interval_days"],
                    result["repetitions"],
                    result["due_date"],
                    timestamp,
                    card_id,
                    user_id,
                ),
            )
            return result

    @staticmethod
    def _replay_review(cur, saved: tuple, card: dict[str, Any], user_id: str, key: str, grade: int) -> dict[str, Any]:
        saved_card, saved_grade, result = saved
        if str(saved_card) != card["id"] or saved_grade != grade:
            raise InvalidInput("review_id was already used for another review")
        if result is None:
            result = {**card, "replayed": False}
            cur.execute(
                "UPDATE reviews SET result=%s::jsonb WHERE user_id=%s AND client_review_id=%s AND result IS NULL",
                (json.dumps(result), user_id, key),
            )
        return {**result, "replayed": True}

    def get_flashcard_source_for_user(self, card_id: str, user_id: str) -> dict[str, Any] | None:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT f.id,f.document_id,f.chapter_id,f.front,f.back,f.source_quote,f.source_revision,"
                "c.id,c.content,c.page FROM flashcards f "
                "JOIN chunks c ON c.id=f.source_chunk_id AND c.document_id=f.document_id "
                "AND c.user_id=f.user_id AND c.chapter_id=f.chapter_id "
                "JOIN chapters h ON h.id=c.chapter_id AND h.document_id=c.document_id AND h.user_id=c.user_id "
                "WHERE f.id=%s AND f.user_id=%s AND f.status='active'",
                (card_id, user_id),
            )
            row = cur.fetchone()
        if row is None:
            return None
        quote = row[5]
        if (
            not isinstance(quote, str)
            or not quote.strip()
            or quote not in row[8]
            or row[6] != _source_revision(str(row[1]), str(row[2]), str(row[7]), str(row[8]), quote)
        ):
            return None
        return {
            "card_id": str(row[0]),
            "document_id": str(row[1]),
            "chapter_id": str(row[2]) if row[2] else None,
            "front": str(row[3])[:300],
            "back": str(row[4])[:600],
            "source_quote": quote,
            "source_revision": row[6],
            "source_chunk_id": str(row[7]),
            "source_text": str(row[8])[:4000],
            "page": row[9],
        }

    def get_chapter(self, chapter_id: str) -> ChapterRecord | None:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, document_id, user_id, title, ordinal, start_page, end_page FROM chapters WHERE id=%s",
                (chapter_id,),
            )
            row = cur.fetchone()
        return _chapter(row) if row else None

    # --- Study plans (task 3.5) --------------------------------------------
    def save_study_plan(self, *, user_id: str, document_id: str, exam_date: str, plan: dict) -> None:
        import json as _json

        with self._conn.cursor() as cur:
            cur.execute(
                "INSERT INTO study_plans (user_id, document_id, exam_date, plan) VALUES (%s, %s, %s, %s)"
                " ON CONFLICT (document_id) DO UPDATE SET exam_date=EXCLUDED.exam_date,"
                " plan=EXCLUDED.plan, created_at=now()",
                (user_id, document_id, exam_date, _json.dumps(plan)),
            )

    def get_study_plan(self, document_id: str, user_id: str) -> dict | None:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT exam_date, plan FROM study_plans WHERE document_id=%s AND user_id=%s",
                (document_id, user_id),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return {"exam_date": row[0], "plan": row[1]}
