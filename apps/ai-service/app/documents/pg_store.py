"""Postgres-backed document/chapter/chunk store (tasks 2.1, 2.4, 2.7).

Mirrors the Drizzle schema in packages/db so web and ai-service share one
source of truth. Every read is scoped by user_id (privacy hard rule).
"""

import logging
from typing import Any, Literal

from app.documents.store import ChapterRecord, ChunkRecord, DocumentRecord

logger = logging.getLogger("studyvault.documents")

DocumentStatus = Literal["pending", "parsed", "failed"]


def _doc(row: tuple) -> DocumentRecord:
    (rid, user_id, filename, mime, size, page_count, status, markdown, err) = row
    d = DocumentRecord(
        id=str(rid), user_id=str(user_id), filename=filename, mime_type=mime,
        size_bytes=size, page_count=page_count, status=status,
        markdown=markdown, error_reason=err,
    )
    return d


def _chapter(row: tuple) -> ChapterRecord:
    rid, doc_id, user_id, title, ordinal, sp, ep = row
    return ChapterRecord(
        id=str(rid), document_id=str(doc_id), user_id=str(user_id), title=title,
        ordinal=ordinal, start_page=sp, end_page=ep,
    )


def _chunk(row: tuple) -> ChunkRecord:
    rid, doc_id, user_id, chapter_id, content, page, ordinal = row
    return ChunkRecord(
        id=str(rid), document_id=str(doc_id), user_id=str(user_id),
        chapter_id=str(chapter_id) if chapter_id else None,
        content=content, page=page, ordinal=ordinal,
    )


class PgDocumentStore:
    """Drop-in for InMemoryDocumentStore; same method surface."""

    def __init__(self, database_url: str) -> None:
        import psycopg

        self._conn = psycopg.connect(database_url, autocommit=True)

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
        with self._conn.cursor() as cur:
            cur.execute(
                "INSERT INTO documents (user_id, filename, mime_type, size_bytes, status, source_bytes)"
                " VALUES (%s, %s, %s, %s, 'pending', %s)"
                " RETURNING id, user_id, filename, mime_type, size_bytes, page_count, status, markdown, error_reason",
                (user_id, filename, mime_type, size_bytes, source_bytes),
            )
            return _doc(cur.fetchone())

    def take_source_bytes(self, document_id: str) -> bytes | None:
        """Fetch and clear the temporary upload bytes (originals are not retained)."""
        with self._conn.cursor() as cur:
            cur.execute("SELECT source_bytes FROM documents WHERE id=%s", (document_id,))
            row = cur.fetchone()
            if row is None or row[0] is None:
                return None
            cur.execute("UPDATE documents SET source_bytes=NULL WHERE id=%s", (document_id,))
            return bytes(row[0])

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
        doc = self.get_internal(document_id)
        return doc if doc.user_id == user_id else None

    def mark_parsed(self, document_id: str, *, markdown: str, page_count: int) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                "UPDATE documents SET markdown=%s, page_count=%s, status='parsed',"
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
        with self._conn.transaction():
            with self._conn.cursor() as cur:
                cur.execute("DELETE FROM chunks WHERE document_id=%s", (document_id,))
                cur.execute("DELETE FROM chapters WHERE document_id=%s", (document_id,))
                for c in chapters:
                    cur.execute(
                        "INSERT INTO chapters (id, document_id, user_id, title, ordinal, start_page, end_page)"
                        " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                        (c.id, c.document_id, c.user_id, c.title, c.ordinal, c.start_page, c.end_page),
                    )
                for ch in chunks:
                    cur.execute(
                        "INSERT INTO chunks (id, document_id, user_id, chapter_id, content, page, ordinal)"
                        " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                        (ch.id, ch.document_id, ch.user_id, ch.chapter_id, ch.content, ch.page, ch.ordinal),
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
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, document_id, user_id, chapter_id, content, page, ordinal"
                " FROM chunks WHERE document_id=%s AND embedding IS NULL ORDER BY ordinal LIMIT %s",
                (document_id, limit),
            )
            return [_chunk(r) for r in cur.fetchall()]

    def set_embedding(self, chunk_id: str, embedding: list[float]) -> None:
        lit = "[" + ",".join(f"{x:.6f}" for x in embedding) + "]"
        with self._conn.cursor() as cur:
            cur.execute(
                "UPDATE chunks SET embedding=%s::vector, updated_at=now() WHERE id=%s", (lit, chunk_id)
            )

    # --- Summaries (task 2.5) -----------------------------------------------
    def get_summary(self, chapter_id: str, level: str, user_id: str | None = None) -> dict[str, Any] | None:
        with self._conn.cursor() as cur:
            if user_id is None:
                cur.execute(
                    "SELECT id, chapter_id, level, content, model FROM summaries"
                    " WHERE chapter_id=%s AND level=%s",
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
                for c in cards:
                    cur.execute(
                        "INSERT INTO flashcards (id, document_id, chapter_id, source_chunk_id, user_id,"
                        " front, back, due_date) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                        (c["id"], document_id, c["chapter_id"], c.get("source_chunk_id"), user_id,
                         c["front"], c["back"], due_date),
                    )
        return len(cards)

    def list_flashcards(self, document_id: str, user_id: str) -> list[dict[str, Any]]:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, front, back, ease_factor, interval_days, repetitions, due_date,"
                " chapter_id, source_chunk_id FROM flashcards"
                " WHERE document_id=%s AND user_id=%s ORDER BY due_date, created_at",
                (document_id, user_id),
            )
            return [
                {
                    "id": str(r[0]), "front": r[1], "back": r[2], "ease_factor": r[3],
                    "interval_days": r[4], "repetitions": r[5], "due_date": r[6],
                    "chapter_id": str(r[7]) if r[7] else None,
                    "source_chunk_id": str(r[8]) if r[8] else None,
                }
                for r in cur.fetchall()
            ]

    def due_flashcards(self, user_id: str, today: str) -> list[dict[str, Any]]:
        """SM-2 review queue: cards due on or before `today` (YYYY-MM-DD)."""
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, front, back, ease_factor, interval_days, repetitions, due_date, document_id"
                " FROM flashcards WHERE user_id=%s AND due_date <= %s ORDER BY due_date",
                (user_id, today),
            )
            return [
                {
                    "id": str(r[0]), "front": r[1], "back": r[2], "ease_factor": r[3],
                    "interval_days": r[4], "repetitions": r[5], "due_date": r[6],
                    "document_id": str(r[7]),
                }
                for r in cur.fetchall()
            ]

    def get_flashcard_for_user(self, card_id: str, user_id: str) -> dict[str, Any] | None:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, front, back, ease_factor, interval_days, repetitions, due_date"
                " FROM flashcards WHERE id=%s AND user_id=%s",
                (card_id, user_id),
            )
            r = cur.fetchone()
        if r is None:
            return None
        return {
            "id": str(r[0]), "front": r[1], "back": r[2], "ease_factor": r[3],
            "interval_days": r[4], "repetitions": r[5], "due_date": r[6],
        }

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

    def get_chapter(self, chapter_id: str) -> ChapterRecord | None:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, document_id, user_id, title, ordinal, start_page, end_page"
                " FROM chapters WHERE id=%s",
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
