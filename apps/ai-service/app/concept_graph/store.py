"""Private saved concept-graph persistence with optimistic revisions."""

import json
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID, uuid4

from app.concept_graph.contracts import ConceptGraph, ConceptGraphRecord
from app.errors import Conflict, NotFound


class ConceptGraphStore(Protocol):
    def get(self, user_id: str, document_id: str) -> ConceptGraphRecord | None: ...
    def save(
        self, user_id: str, document_id: str, graph: ConceptGraph, *, expected_revision: int | None
    ) -> ConceptGraphRecord: ...


def _record(
    graph_id: str,
    document_id: str,
    revision: int,
    graph: dict | ConceptGraph,
    created_at: datetime | str,
    updated_at: datetime | str,
) -> ConceptGraphRecord:
    if isinstance(graph, str):
        graph = json.loads(graph)
    return ConceptGraphRecord(
        id=UUID(str(graph_id)),
        document_id=UUID(str(document_id)),
        revision=revision,
        graph=graph.model_copy(deep=True) if isinstance(graph, ConceptGraph) else ConceptGraph.model_validate(graph),
        created_at=created_at.isoformat() if isinstance(created_at, datetime) else created_at,
        updated_at=updated_at.isoformat() if isinstance(updated_at, datetime) else updated_at,
    )


class MemoryConceptGraphStore:
    def __init__(self) -> None:
        import threading

        self._rows: dict[tuple[str, str], ConceptGraphRecord] = {}
        self._lock = threading.Lock()

    def get(self, user_id: str, document_id: str) -> ConceptGraphRecord | None:
        with self._lock:
            row = self._rows.get((user_id, document_id))
            return row.model_copy(deep=True) if row is not None else None

    def save(
        self, user_id: str, document_id: str, graph: ConceptGraph, *, expected_revision: int | None
    ) -> ConceptGraphRecord:
        key = (user_id, document_id)
        with self._lock:
            previous = self._rows.get(key)
            if previous is None:
                if expected_revision is not None:
                    raise Conflict("This concept graph changed or was removed. Reload before saving.")
                now = datetime.now(UTC).isoformat()
                saved = _record(str(uuid4()), document_id, 1, graph, now, now)
            else:
                if expected_revision != previous.revision:
                    raise Conflict(
                        "This concept graph changed. Reload it before saving.",
                        details={"current_revision": previous.revision},
                    )
                saved = _record(
                    str(previous.id), document_id, previous.revision + 1, graph,
                    previous.created_at, datetime.now(UTC).isoformat(),
                )
            self._rows[key] = saved
            return saved.model_copy(deep=True)


class PgConceptGraphStore:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def get(self, user_id: str, document_id: str) -> ConceptGraphRecord | None:
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(self._database_url, row_factory=dict_row, connect_timeout=5) as conn:
            row = conn.execute(
                "SELECT id, document_id, revision, graph, created_at, updated_at "
                "FROM concept_graphs WHERE user_id=%s AND document_id=%s",
                (user_id, document_id),
            ).fetchone()
        if row is None:
            return None
        return _record(
            row["id"], row["document_id"], row["revision"], row["graph"], row["created_at"], row["updated_at"]
        )

    def save(
        self, user_id: str, document_id: str, graph: ConceptGraph, *, expected_revision: int | None
    ) -> ConceptGraphRecord:
        import psycopg
        from psycopg.rows import dict_row
        from psycopg.types.json import Jsonb

        with psycopg.connect(self._database_url, row_factory=dict_row, connect_timeout=5) as conn:
            with conn.transaction():
                owner = conn.execute(
                    "SELECT id FROM users WHERE id=%s FOR KEY SHARE", (user_id,),
                ).fetchone()
                if owner is None:
                    raise NotFound("Source owner not found")
                document = conn.execute(
                    "SELECT id FROM documents WHERE id=%s AND user_id=%s FOR UPDATE",
                    (document_id, user_id),
                ).fetchone()
                if document is None:
                    raise NotFound("Source document not found")
                source_rows = conn.execute(
                    "SELECT c.id,c.chapter_id,c.page,c.content FROM chunks c "
                    "LEFT JOIN chapters h ON h.id=c.chapter_id AND h.document_id=c.document_id AND h.user_id=c.user_id "
                    "WHERE c.document_id=%s AND c.user_id=%s "
                    "AND c.id=ANY(%s::uuid[]) AND (c.chapter_id IS NULL OR h.id IS NOT NULL) FOR SHARE OF c",
                    (document_id, user_id, [str(evidence.chunk_id) for evidence in graph.evidence]),
                ).fetchall()
                sources = {str(item["id"]): item for item in source_rows}
                for evidence in graph.evidence:
                    source = sources.get(str(evidence.chunk_id))
                    if (
                        str(evidence.source_document_id) != document_id
                        or source is None
                        or (str(evidence.chapter_id) if evidence.chapter_id is not None else None)
                        != (str(source["chapter_id"]) if source["chapter_id"] is not None else None)
                        or evidence.page != source["page"]
                        or evidence.quote not in source["content"]
                    ):
                        raise Conflict("The source changed while saving this graph. Reload and regenerate it.")
                conn.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (f"concept-graph:{user_id}:{document_id}",),
                )
                previous = conn.execute(
                    "SELECT id, revision FROM concept_graphs WHERE user_id=%s AND document_id=%s FOR UPDATE",
                    (user_id, document_id),
                ).fetchone()
                data = Jsonb(graph.model_dump(mode="json"))
                if previous is None:
                    if expected_revision is not None:
                        raise Conflict("This concept graph changed or was removed. Reload before saving.")
                    row = conn.execute(
                        "INSERT INTO concept_graphs (user_id, document_id, graph) "
                        "SELECT %s, d.id, %s FROM documents d WHERE d.id=%s AND d.user_id=%s "
                        "RETURNING id, document_id, revision, graph, created_at, updated_at",
                        (user_id, data, document_id, user_id),
                    ).fetchone()
                    if row is None:
                        raise NotFound("Source document not found")
                else:
                    current_revision = int(previous["revision"])
                    if expected_revision != current_revision:
                        raise Conflict(
                            "This concept graph changed. Reload it before saving.",
                            details={"current_revision": current_revision},
                        )
                    row = conn.execute(
                        "UPDATE concept_graphs SET graph=%s, revision=revision+1, updated_at=now() "
                        "WHERE id=%s AND user_id=%s AND document_id=%s "
                        "RETURNING id, document_id, revision, graph, created_at, updated_at",
                        (data, previous["id"], user_id, document_id),
                    ).fetchone()
                    if row is None:
                        raise Conflict("This concept graph changed. Reload it before saving.")
        return _record(
            row["id"], row["document_id"], row["revision"], row["graph"], row["created_at"], row["updated_at"]
        )
