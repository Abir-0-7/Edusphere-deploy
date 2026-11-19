"""Private immutable source snapshots with owner-serialized, idempotent writes."""

import threading
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid4

from app.documents.store import ChapterRecord, ChunkRecord, DocumentRecord
from app.errors import ApiError, Conflict, InvalidInput, NotFound
from app.source_versions.contracts import EvidencePin, PdfOrigin, PdfSnapshotRequest, SourceSnapshot, SourceVersion
from app.source_versions.service import pdf_snapshot, resolve_version


class OwnedDocuments(Protocol):
    def get_for_user(self, document_id: str, user_id: str) -> DocumentRecord | None: ...


@contextmanager
def _write_connection(database_url: str, timeout_seconds: float | None):
    import psycopg
    from psycopg.rows import dict_row

    try:
        with psycopg.connect(database_url, row_factory=dict_row, connect_timeout=5) as conn:
            if timeout_seconds is not None:
                milliseconds = max(1, int(timeout_seconds * 1000))
                conn.execute(
                    "SELECT set_config('statement_timeout',%s,true),set_config('lock_timeout',%s,true)",
                    (f"{milliseconds}ms", f"{milliseconds}ms"),
                )
            yield conn
    except (psycopg.OperationalError, psycopg.errors.QueryCanceled, psycopg.errors.LockNotAvailable) as exc:
        if timeout_seconds is None:
            raise
        raise ApiError("Source storage is temporarily unavailable", status_code=503) from exc


def _request(snapshot: SourceSnapshot) -> PdfSnapshotRequest:
    origin = snapshot.origin
    if not isinstance(origin, PdfOrigin):
        raise InvalidInput("Expected a PDF snapshot")
    return PdfSnapshotRequest(
        book_title=origin.book_title, edition=origin.edition,
        printed_page_labels={str(item.locator.pdf_page_index): item.locator.printed_page_label
                             for item in snapshot.segments if item.locator.printed_page_label is not None},
        rights_statement=snapshot.provenance.rights.statement,
    )


def _check_pdf(snapshot: SourceSnapshot, document: DocumentRecord | None):
    if document is None:
        raise NotFound("Source document not found")
    if pdf_snapshot(document, _request(snapshot)).content_hash() != snapshot.content_hash():
        raise Conflict("The source changed while creating this version; reload and retry")


class MemorySourceVersionStore:
    def __init__(self, documents: OwnedDocuments, *, max_versions_per_user: int = 100):
        if max_versions_per_user < 1:
            raise ValueError("max_versions_per_user must be positive")
        self.documents, self.max_versions_per_user = documents, max_versions_per_user
        self._rows: dict[tuple[str, str], SourceVersion] = {}
        self._lock = threading.RLock()

    def save(self, user_id: str, snapshot: SourceSnapshot, *, timeout_seconds: float | None = None) -> SourceVersion:
        snapshot = SourceSnapshot.model_validate(snapshot.model_dump(mode="json"))
        with self._lock:
            if isinstance(snapshot.origin, PdfOrigin):
                _check_pdf(snapshot, self.documents.get_for_user(str(snapshot.origin.document_id), user_id))
            digest = snapshot.content_hash()
            for (owner, _), row in self._rows.items():
                if owner == user_id and row.content_hash == digest:
                    return row.model_copy(deep=True)
            if sum(owner == user_id for owner, _ in self._rows) >= self.max_versions_per_user:
                raise InvalidInput("Source version limit reached for this account")
            row = SourceVersion(
                id=uuid4(), content_hash=digest, snapshot=snapshot, created_at=datetime.now(UTC).isoformat(),
            )
            self._rows[(user_id, str(row.id))] = row
            return row.model_copy(deep=True)

    def get(self, user_id: str, version_id: str) -> SourceVersion | None:
        with self._lock:
            row = self._rows.get((user_id, version_id))
            if row and isinstance(row.snapshot.origin, PdfOrigin):
                if self.documents.get_for_user(str(row.snapshot.origin.document_id), user_id) is None:
                    return None
            return row.model_copy(deep=True) if row else None

    def resolve(self, user_id: str, pin: EvidencePin):
        row = self.get(user_id, str(pin.version_id))
        if row is None:
            raise NotFound("Source version not found")
        return resolve_version(row, pin)

    def list_summaries(self, user_id: str, *, limit: int, offset: int):
        with self._lock:
            rows = [row for (owner, _), row in self._rows.items() if owner == user_id and (
                not isinstance(row.snapshot.origin, PdfOrigin)
                or self.documents.get_for_user(str(row.snapshot.origin.document_id), user_id) is not None
            )]
            rows.sort(key=lambda row: (row.created_at, str(row.id)), reverse=True)
            return [{
                "id": row.id, "content_hash": row.content_hash, "title": row.snapshot.title,
                "kind": row.snapshot.origin.kind, "segment_count": len(row.snapshot.segments),
                "created_at": row.created_at,
            } for row in rows[offset:offset + limit]], len(rows)


class PgSourceVersionStore:
    def __init__(self, database_url: str, *, max_versions_per_user: int = 100):
        if max_versions_per_user < 1:
            raise ValueError("max_versions_per_user must be positive")
        self.database_url, self.max_versions_per_user = database_url, max_versions_per_user

    @staticmethod
    def _record(row) -> SourceVersion:
        return SourceVersion(
            id=row["id"], content_hash=row["content_hash"], snapshot=row["snapshot"],
            created_at=row["created_at"].isoformat(),
        )

    def save(self, user_id: str, snapshot: SourceSnapshot, *, timeout_seconds: float | None = None) -> SourceVersion:
        from psycopg.types.json import Jsonb

        snapshot = SourceSnapshot.model_validate(snapshot.model_dump(mode="json"))
        document_id = str(snapshot.origin.document_id) if isinstance(snapshot.origin, PdfOrigin) else None
        with _write_connection(self.database_url, timeout_seconds) as conn:
            # Serializes quotas/dedup with owner deletion and other snapshot writes.
            if conn.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (user_id,)).fetchone() is None:
                raise NotFound("Source owner not found")
            if document_id:
                row = conn.execute(
                    "SELECT id,user_id,filename,mime_type,size_bytes,page_count,status FROM documents "
                    "WHERE id=%s AND user_id=%s FOR UPDATE", (document_id, user_id),
                ).fetchone()
                if row is None:
                    raise NotFound("Source document not found")
                document = DocumentRecord(
                    document_id, user_id, row["filename"], row["mime_type"], row["size_bytes"],
                    page_count=row["page_count"], status=row["status"],
                )
                document.chapters = [ChapterRecord(
                    str(r["id"]), document_id, user_id, r["title"], r["ordinal"], r["start_page"], r["end_page"],
                ) for r in conn.execute(
                    "SELECT id,title,ordinal,start_page,end_page FROM chapters "
                    "WHERE document_id=%s AND user_id=%s FOR SHARE", (document_id, user_id),
                ).fetchall()]
                document.chunks = [ChunkRecord(
                    str(r["id"]), document_id, user_id, str(r["chapter_id"]) if r["chapter_id"] else None,
                    r["content"], r["page"], r["ordinal"],
                ) for r in conn.execute(
                    "SELECT id,chapter_id,content,page,ordinal FROM chunks "
                    "WHERE document_id=%s AND user_id=%s ORDER BY ordinal,id FOR SHARE", (document_id, user_id),
                ).fetchall()]
                _check_pdf(snapshot, document)
            digest = snapshot.content_hash()
            row = conn.execute(
                "SELECT id,content_hash,snapshot,created_at FROM source_versions WHERE user_id=%s AND content_hash=%s",
                (user_id, digest),
            ).fetchone()
            if row is not None:
                return self._record(row)
            count = conn.execute(
                "SELECT count(*) AS count FROM source_versions WHERE user_id=%s", (user_id,),
            ).fetchone()
            if count["count"] >= self.max_versions_per_user:
                raise InvalidInput("Source version limit reached for this account")
            row = conn.execute(
                "INSERT INTO source_versions (user_id,document_id,content_hash,snapshot) VALUES (%s,%s,%s,%s) "
                "RETURNING id,content_hash,snapshot,created_at",
                (user_id, document_id, digest, Jsonb(snapshot.model_dump(mode="json"))),
            ).fetchone()
            return self._record(row)

    def get(self, user_id: str, version_id: str) -> SourceVersion | None:
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(self.database_url, row_factory=dict_row, connect_timeout=5) as conn:
            row = conn.execute(
                "SELECT v.id,v.content_hash,v.snapshot,v.created_at FROM source_versions v "
                "WHERE v.id=%s AND v.user_id=%s AND (v.document_id IS NULL OR EXISTS ("
                "SELECT 1 FROM documents d WHERE d.id=v.document_id AND d.user_id=v.user_id))",
                (version_id, user_id),
            ).fetchone()
        return self._record(row) if row else None

    def get_locked(self, user_id: str, version_id: str, conn) -> SourceVersion | None:
        """Load once per selected source and retain parent/version locks for a write."""
        from psycopg.rows import dict_row

        with conn.cursor(row_factory=dict_row) as cursor:
            row = cursor.execute(
                "SELECT id,document_id,content_hash,snapshot,created_at FROM source_versions "
                "WHERE id=%s AND user_id=%s", (version_id, user_id),
            ).fetchone()
            if row is None:
                return None
            if row["document_id"] is not None and cursor.execute(
                "SELECT id FROM documents WHERE id=%s AND user_id=%s FOR SHARE",
                (row["document_id"], user_id),
            ).fetchone() is None:
                return None
            # Match source save/cascade order: document before version. Re-read
            # after locking the parent because deletion may have won the race.
            row = cursor.execute(
                "SELECT id,document_id,content_hash,snapshot,created_at FROM source_versions "
                "WHERE id=%s AND user_id=%s FOR SHARE", (version_id, user_id),
            ).fetchone()
            if row is None:
                return None
            return self._record(row)

    def resolve(self, user_id: str, pin: EvidencePin, *, conn=None):
        row = (self.get(user_id, str(pin.version_id)) if conn is None
               else self.get_locked(user_id, str(pin.version_id), conn))
        if row is None:
            raise NotFound("Source version not found")
        return resolve_version(row, pin)

    def list_summaries(self, user_id: str, *, limit: int, offset: int):
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(self.database_url, row_factory=dict_row, connect_timeout=5) as conn:
            rows = conn.execute(
                "SELECT id,content_hash,snapshot->>'title' AS title,snapshot->'origin'->>'kind' AS kind,"
                "jsonb_array_length(snapshot->'segments') AS segment_count,created_at FROM source_versions "
                "WHERE user_id=%s ORDER BY created_at DESC,id DESC LIMIT %s OFFSET %s",
                (user_id, limit, offset),
            ).fetchall()
            total = conn.execute(
                "SELECT count(*) AS count FROM source_versions WHERE user_id=%s", (user_id,),
            ).fetchone()
            for row in rows:
                row["created_at"] = row["created_at"].isoformat()
            return rows, total["count"]
