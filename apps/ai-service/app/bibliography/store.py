"""Private, revisioned bibliography item persistence."""

from datetime import UTC, datetime
from threading import Lock
from typing import Protocol
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.bibliography.contracts import BibliographyItemInput, BibliographyItemResponse
from app.errors import Conflict


class BibliographyStore(Protocol):
    def list_items(self, user_id: str, *, limit: int, offset: int) -> tuple[list[BibliographyItemResponse], int]: ...
    def get_item(self, user_id: str, item_id: UUID) -> BibliographyItemResponse | None: ...
    def create_item(self, user_id: str, body: BibliographyItemInput) -> BibliographyItemResponse: ...
    def update_item(
        self, user_id: str, item_id: UUID, body: BibliographyItemInput, *, expected_revision: int
    ) -> BibliographyItemResponse | None: ...
    def delete_item(self, user_id: str, item_id: UUID) -> bool: ...


def _response(values: dict) -> BibliographyItemResponse:
    return BibliographyItemResponse.model_validate(values)


def _now() -> datetime:
    return datetime.now(UTC)


class MemoryBibliographyStore:
    """Explicit local/test store. Data and revisions are scoped to one internal owner id."""

    def __init__(self, *, max_items_per_user: int = 1000) -> None:
        if max_items_per_user < 1:
            raise ValueError("max_items_per_user must be positive")
        self._items: dict[tuple[str, UUID], BibliographyItemResponse] = {}
        self._max_items_per_user = max_items_per_user
        self._lock = Lock()

    def list_items(self, user_id: str, *, limit: int, offset: int) -> tuple[list[BibliographyItemResponse], int]:
        with self._lock:
            items = [row for (owner, _), row in self._items.items() if owner == user_id]
            items.sort(key=lambda row: (row.updated_at, row.id.int), reverse=True)
            return [row.model_copy(deep=True) for row in items[offset : offset + limit]], len(items)

    def get_item(self, user_id: str, item_id: UUID) -> BibliographyItemResponse | None:
        with self._lock:
            row = self._items.get((user_id, item_id))
            return row.model_copy(deep=True) if row else None

    def create_item(self, user_id: str, body: BibliographyItemInput) -> BibliographyItemResponse:
        with self._lock:
            if sum(owner == user_id for owner, _ in self._items) >= self._max_items_per_user:
                raise ValueError("bibliography item limit reached for this account")
            now = _now()
            row = BibliographyItemResponse(
                **body.model_dump(),
                id=uuid4(),
                revision=1,
                created_at=now,
                updated_at=now,
            )
            self._items[(user_id, row.id)] = row
            return row.model_copy(deep=True)

    def update_item(
        self, user_id: str, item_id: UUID, body: BibliographyItemInput, *, expected_revision: int
    ) -> BibliographyItemResponse | None:
        with self._lock:
            old = self._items.get((user_id, item_id))
            if old is None:
                return None
            if old.revision != expected_revision:
                raise Conflict(
                    "This bibliography item changed. Reload it before saving.",
                    details={"current_revision": old.revision},
                )
            row = BibliographyItemResponse(
                **body.model_dump(),
                id=old.id,
                revision=old.revision + 1,
                created_at=old.created_at,
                updated_at=_now(),
            )
            self._items[(user_id, row.id)] = row
            return row.model_copy(deep=True)

    def delete_item(self, user_id: str, item_id: UUID) -> bool:
        with self._lock:
            return self._items.pop((user_id, item_id), None) is not None


_COLUMNS = (
    "id, user_id, kind, title, authors, issued, container_title, edition, volume, issue, item_pages, "
    "publisher, doi, isbn, url, accessed, repository_commit, source_document_id, metadata_provenance, "
    "metadata_suggestions, revision, created_at, updated_at"
)


def _to_api(row: dict) -> BibliographyItemResponse:
    data = dict(row)
    data.pop("user_id", None)
    return _response(data)


class PgBibliographyStore:
    def __init__(self, database_url: str, *, max_items_per_user: int = 1000) -> None:
        self.database_url = database_url
        self.max_items_per_user = max_items_per_user

    def list_items(self, user_id: str, *, limit: int, offset: int) -> tuple[list[BibliographyItemResponse], int]:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            rows = conn.execute(
                f"SELECT {_COLUMNS} FROM bibliography_items WHERE user_id = %s "
                "ORDER BY updated_at DESC, id DESC LIMIT %s OFFSET %s",
                (user_id, limit, offset),
            ).fetchall()
            total = conn.execute(
                "SELECT count(*) AS count FROM bibliography_items WHERE user_id = %s", (user_id,)
            ).fetchone()
        return [_to_api(row) for row in rows], int(total["count"])

    def get_item(self, user_id: str, item_id: UUID) -> BibliographyItemResponse | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            row = conn.execute(
                f"SELECT {_COLUMNS} FROM bibliography_items WHERE id = %s AND user_id = %s",
                (item_id, user_id),
            ).fetchone()
        return _to_api(row) if row else None

    def _count(self, conn, user_id: str) -> int:
        row = conn.execute(
            "SELECT count(*) AS count FROM bibliography_items WHERE user_id = %s", (user_id,)
        ).fetchone()
        return int(row["count"])

    @staticmethod
    def _values(user_id: str, body: BibliographyItemInput) -> tuple:
        return (
            user_id,
            body.kind,
            body.title,
            Jsonb([author.model_dump(exclude_none=True) for author in body.authors]),
            Jsonb(body.issued.model_dump(exclude_none=True) if body.issued else None),
            body.container_title,
            body.edition,
            body.volume,
            body.issue,
            body.item_pages,
            body.publisher,
            body.doi,
            body.isbn,
            body.url,
            Jsonb(body.accessed.model_dump(exclude_none=True) if body.accessed else None),
            body.repository_commit,
            body.source_document_id,
            Jsonb([entry.model_dump() for entry in body.metadata_provenance]),
            Jsonb([entry.model_dump() for entry in body.metadata_suggestions]),
        )

    def create_item(self, user_id: str, body: BibliographyItemInput) -> BibliographyItemResponse:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            with conn.transaction():
                conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (user_id,))
                if self._count(conn, user_id) >= self.max_items_per_user:
                    raise ValueError("bibliography item limit reached for this account")
                row = conn.execute(
                    f"""INSERT INTO bibliography_items
                        (user_id, kind, title, authors, issued, container_title, edition, volume, issue, item_pages,
                         publisher, doi, isbn, url, accessed, repository_commit, source_document_id,
                         metadata_provenance,
                         metadata_suggestions)
                        VALUES ({", ".join(["%s"] * 19)})
                        RETURNING {_COLUMNS}""",
                    self._values(user_id, body),
                ).fetchone()
        return _to_api(row)

    def update_item(
        self, user_id: str, item_id: UUID, body: BibliographyItemInput, *, expected_revision: int
    ) -> BibliographyItemResponse | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            with conn.transaction():
                current = conn.execute(
                    "SELECT revision FROM bibliography_items WHERE id = %s AND user_id = %s FOR UPDATE",
                    (item_id, user_id),
                ).fetchone()
                if current is None:
                    return None
                if int(current["revision"]) != expected_revision:
                    raise Conflict(
                        "This bibliography item changed. Reload it before saving.",
                        details={"current_revision": int(current["revision"])},
                    )
                values = self._values(user_id, body)
                row = conn.execute(
                    f"""UPDATE bibliography_items SET
                        kind=%s, title=%s, authors=%s, issued=%s, container_title=%s, edition=%s,
                        volume=%s, issue=%s, item_pages=%s, publisher=%s, doi=%s, isbn=%s, url=%s, accessed=%s,
                        repository_commit=%s, source_document_id=%s, metadata_provenance=%s,
                        metadata_suggestions=%s, revision=revision+1, updated_at=now()
                        WHERE user_id=%s AND id=%s RETURNING {_COLUMNS}""",
                    (*values[1:], user_id, item_id),
                ).fetchone()
        return _to_api(row) if row else None

    def delete_item(self, user_id: str, item_id: UUID) -> bool:
        with psycopg.connect(self.database_url) as conn:
            row = conn.execute(
                "DELETE FROM bibliography_items WHERE id = %s AND user_id = %s RETURNING id",
                (item_id, user_id),
            ).fetchone()
        return row is not None
