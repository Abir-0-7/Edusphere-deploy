"""Private revisioned outline plans and immutable owner approvals.

No method publishes a course or grants editorial authority. Source links retain
current and approved historical versions, so deletion revokes dependent approvals.
"""

import math
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import uuid4

from app.course_outlines.contracts import (
    OutlineApproval,
    OutlineApprovalListResponse,
    OutlineApprovalReceipt,
    OutlineApproveRequest,
    OutlineCreateRequest,
    OutlineListResponse,
    OutlinePlan,
    OutlineRecord,
    OutlineSummary,
    OutlineUpdateRequest,
)
from app.course_outlines.coverage import analyze_plan, describe_plan
from app.errors import ApiError, Conflict, InvalidInput, NotFound


def _now():
    return datetime.now(UTC).isoformat()


def _timestamp(value):
    return value.isoformat() if isinstance(value, datetime) else value


def _source_ids(plan):
    return {str(source.version_id) for source in plan.sources}


def _limits(outlines, approvals):
    if type(outlines) is not int or outlines <= 0 or type(approvals) is not int or not 1 <= approvals <= 50:
        raise ValueError("outline and approval limits must be positive bounded integers")


def _page(limit, offset):
    if type(limit) is not int or not 1 <= limit <= 50 or type(offset) is not int or offset < 0:
        raise InvalidInput("invalid outline pagination")


def _receipt(approval: OutlineApproval | None):
    if approval is None:
        return None
    return OutlineApprovalReceipt.model_validate(approval.model_dump(mode="json", exclude={"outline_id", "snapshot"}))


def _summary(record):
    return OutlineSummary(
        id=record.id, title=record.plan.title, revision=record.revision, status=record.status,
        estimated_minutes=record.coverage.estimated_minutes, source_count=len(record.plan.sources),
        objective_count=len(record.plan.objectives), content_hash=record.content_hash, updated_at=record.updated_at,
    )


def _check_approval(row, body, coverage):
    if body.expected_revision != row["revision"] or body.content_hash != row["content_hash"]:
        raise Conflict("Outline changed; reload and review the current revision before approving")
    if not coverage.ready_for_approval:
        raise InvalidInput(
            "Resolve coverage gaps, unmapped objectives, prerequisite order, unreviewed evidence and conflicts "
            "before approval",
        )


@dataclass
class _MemoryRow:
    owner: str
    plan: OutlinePlan
    revision: int = 1
    status: str = "draft"
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    sources: set[str] = field(default_factory=set)
    approvals: list[OutlineApproval] = field(default_factory=list)


class MemoryOutlineStore:
    def __init__(self, source_versions, *, max_outlines_per_user=20, max_approvals_per_outline=10):
        _limits(max_outlines_per_user, max_approvals_per_outline)
        self.source_versions = source_versions
        self.max_outlines_per_user, self.max_approvals_per_outline = max_outlines_per_user, max_approvals_per_outline
        self._rows: dict[str, _MemoryRow] = {}
        self._lock = threading.RLock()

    def _validate_sources(self, row):
        return all(self.source_versions.get(row.owner, identifier) is not None for identifier in row.sources)

    def _purge_missing(self, user_id):
        for identifier, row in list(self._rows.items()):
            if row.owner == user_id and not self._validate_sources(row):
                del self._rows[identifier]

    def _owned(self, user_id, identifier):
        row = self._rows.get(identifier)
        if row is None or row.owner != user_id:
            raise NotFound("Outline not found")
        if not self._validate_sources(row):
            del self._rows[identifier]
            raise NotFound("Outline source no longer exists")
        return row

    def _record(self, identifier, row):
        coverage = analyze_plan(row.owner, row.plan, self.source_versions)
        approval = row.approvals[-1] if row.status == "approved" else None
        return OutlineRecord(
            id=identifier, revision=row.revision, content_hash=row.plan.content_hash(),
            plan=row.plan.model_copy(deep=True),
            coverage=coverage, status=row.status, approval=_receipt(approval), created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def create(self, user_id, body: OutlineCreateRequest):
        body = OutlineCreateRequest.model_validate(body.model_dump(mode="json"))
        identifier = str(body.id)
        with self._lock:
            self._purge_missing(user_id)
            if identifier in self._rows:
                row = self._owned(user_id, identifier)
                if row.plan.content_hash() != body.plan.content_hash():
                    raise Conflict("Outline identifier is already used by different content")
                return self._record(identifier, row)
            if sum(row.owner == user_id for row in self._rows.values()) >= self.max_outlines_per_user:
                raise InvalidInput("Outline limit reached for this account")
            analyze_plan(user_id, body.plan, self.source_versions)
            now = _now()
            row = _MemoryRow(user_id, body.plan, sources=_source_ids(body.plan), created_at=now, updated_at=now)
            self._rows[identifier] = row
            return self._record(identifier, row)

    def get(self, user_id, identifier):
        with self._lock:
            return self._record(identifier, self._owned(user_id, str(identifier)))

    def update(self, user_id, identifier, body: OutlineUpdateRequest):
        identifier = str(identifier)
        body = OutlineUpdateRequest.model_validate(body.model_dump(mode="json"))
        with self._lock:
            row = self._owned(user_id, identifier)
            if row.revision != body.expected_revision:
                raise Conflict("Outline changed; reload before saving")
            analyze_plan(user_id, body.plan, self.source_versions)
            row.plan, row.revision, row.status, row.updated_at = body.plan, row.revision + 1, "draft", _now()
            row.sources = _source_ids(body.plan)
            for approval in row.approvals:
                row.sources.update(_source_ids(approval.snapshot.plan))
            return self._record(identifier, row)

    def list(self, user_id, *, limit=20, offset=0):
        _page(limit, offset)
        with self._lock:
            self._purge_missing(user_id)
            rows = sorted(
                ((identifier, row) for identifier, row in self._rows.items() if row.owner == user_id),
                key=lambda pair: (pair[1].updated_at, pair[0]), reverse=True,
            )
            items = [_summary(self._record(identifier, row)) for identifier, row in rows[offset:offset + limit]]
            return OutlineListResponse(items=items, limit=limit, offset=offset, total_count=len(rows))

    def approve(self, user_id, identifier, body: OutlineApproveRequest):
        identifier = str(identifier)
        body = OutlineApproveRequest.model_validate(body.model_dump(mode="json"))
        with self._lock:
            row = self._owned(user_id, identifier)
            coverage = analyze_plan(user_id, row.plan, self.source_versions)
            _check_approval({"revision": row.revision, "content_hash": row.plan.content_hash()}, body, coverage)
            if row.status == "approved":
                return self._record(identifier, row)
            if len(row.approvals) >= self.max_approvals_per_outline:
                raise InvalidInput("Outline approval history limit reached")
            now = _now()
            row.approvals.append(OutlineApproval(
                id=uuid4(), outline_id=identifier, revision=row.revision, content_hash=row.plan.content_hash(),
                snapshot={"plan": row.plan.model_copy(deep=True), "coverage": coverage}, created_at=now,
            ))
            row.status, row.updated_at = "approved", now
            return self._record(identifier, row)

    def history(self, user_id, identifier):
        with self._lock:
            row = self._owned(user_id, str(identifier))
            return OutlineApprovalListResponse(items=[item.model_copy(deep=True) for item in reversed(row.approvals)])

    def delete(self, user_id, identifier):
        with self._lock:
            self._owned(user_id, str(identifier))
            del self._rows[str(identifier)]


class PgOutlineStore:
    def __init__(
        self, database_url, source_versions, *, max_outlines_per_user=20, max_approvals_per_outline=10,
        timeout_seconds=5,
    ):
        _limits(max_outlines_per_user, max_approvals_per_outline)
        self.database_url, self.source_versions = database_url, source_versions
        self.max_outlines_per_user, self.max_approvals_per_outline = max_outlines_per_user, max_approvals_per_outline
        if isinstance(timeout_seconds, bool) or not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
            raise ValueError("outline storage timeout must be positive and finite")
        self.timeout_seconds = timeout_seconds

    @contextmanager
    def _connection(self):
        import psycopg
        from psycopg.rows import dict_row

        try:
            with psycopg.connect(self.database_url, row_factory=dict_row, connect_timeout=5) as conn:
                milliseconds = max(1, int(self.timeout_seconds * 1000))
                conn.execute(
                    "SELECT set_config('statement_timeout',%s,true),set_config('lock_timeout',%s,true)",
                    (f"{milliseconds}ms", f"{milliseconds}ms"),
                )
                yield conn
        except (psycopg.OperationalError, psycopg.errors.QueryCanceled, psycopg.errors.LockNotAvailable) as exc:
            raise ApiError("Outline storage is temporarily unavailable", status_code=503) from exc

    def _owner(self, conn, user_id):
        if conn.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (user_id,)).fetchone() is None:
            raise NotFound("Outline owner no longer exists")

    def _sources(self, conn, user_id, identifier, plan=None, *, lock=False):
        rows = conn.execute(
            "SELECT source_version_id FROM course_outline_sources WHERE outline_id=%s AND user_id=%s "
            "UNION SELECT (source.value->>'version_id')::uuid AS source_version_id "
            "FROM course_outline_approvals approval "
            "CROSS JOIN LATERAL jsonb_array_elements(approval.snapshot->'plan'->'sources') AS source(value) "
            "WHERE approval.outline_id=%s AND approval.user_id=%s",
            (identifier, user_id, identifier, user_id),
        ).fetchall()
        identifiers = {str(item["source_version_id"]) for item in rows}
        if plan is not None:
            identifiers.update(_source_ids(plan))
        # Metadata only: historical approvals can reference many large immutable
        # snapshots. Never fetch or rehash their source text just to check access.
        def metadata(*, locked=False):
            versions = conn.execute(
                "SELECT v.id,v.document_id,v.content_hash FROM source_versions v "
                "WHERE v.user_id=%s AND v.id=ANY(%s::uuid[]) AND (v.document_id IS NULL OR EXISTS ("
                "SELECT 1 FROM documents d WHERE d.id=v.document_id AND d.user_id=v.user_id)) "
                "ORDER BY v.id" + (" FOR SHARE OF v" if locked else ""),
                (user_id, sorted(identifiers)),
            ).fetchall()
            found = {str(item["id"]): item for item in versions}
            if found.keys() != identifiers:
                raise NotFound("Outline source no longer exists")
            return found

        versions = metadata()
        if lock:
            # Source deletion locks PDF parents before versions and outlines.
            # Lock every parent first, then every retained version in order.
            document_ids = {str(item["document_id"]) for item in versions.values() if item["document_id"] is not None}
            if document_ids:
                documents = conn.execute(
                    "SELECT id FROM documents WHERE user_id=%s AND id=ANY(%s::uuid[]) ORDER BY id FOR SHARE",
                    (user_id, sorted(document_ids)),
                ).fetchall()
                if {str(item["id"]) for item in documents} != document_ids:
                    raise NotFound("Outline source no longer exists")
            versions = metadata(locked=True)
        if plan is not None:
            self._selected_sources(plan, versions)
        return versions

    @staticmethod
    def _selected_sources(plan, versions):
        for source in plan.sources:
            metadata = versions.get(str(source.version_id))
            if metadata is None:
                raise NotFound("Selected source version not found")
            if metadata["content_hash"] != source.content_hash:
                raise Conflict("Selected source hash does not match its immutable version")

    @staticmethod
    def _row(conn, user_id, identifier, *, lock=False):
        row = conn.execute(
            "SELECT id,user_id,revision,plan,content_hash,status,approved_revision,approved_at,created_at,updated_at "
            "FROM course_outlines WHERE id=%s AND user_id=%s" + (" FOR UPDATE" if lock else ""),
            (identifier, user_id),
        ).fetchone()
        if row is None:
            raise NotFound("Outline not found")
        return row

    @staticmethod
    def _approval(row):
        return OutlineApproval(
            id=row["id"], outline_id=row["outline_id"], revision=row["revision"], content_hash=row["content_hash"],
            snapshot=row["snapshot"], created_at=_timestamp(row["created_at"]),
        )

    def _record(self, conn, user_id, row, *, sources=None):
        plan = OutlinePlan.model_validate(row["plan"])
        if sources is None:
            self._sources(conn, user_id, str(row["id"]), plan)
        else:
            self._selected_sources(plan, sources)
        coverage = describe_plan(plan)
        approval = None
        if row["status"] == "approved":
            approved = conn.execute(
                "SELECT id,outline_id,revision,content_hash,snapshot,created_at FROM course_outline_approvals "
                "WHERE outline_id=%s AND user_id=%s AND revision=%s", (row["id"], user_id, row["revision"]),
            ).fetchone()
            if approved is None:
                raise Conflict("Outline approval is unavailable; reload before continuing")
            approval = _receipt(self._approval(approved))
        return OutlineRecord(
            id=row["id"], revision=row["revision"], content_hash=row["content_hash"], plan=plan, coverage=coverage,
            status=row["status"], approval=approval, created_at=_timestamp(row["created_at"]),
            updated_at=_timestamp(row["updated_at"]),
        )

    @staticmethod
    def _link(conn, user_id, identifier, plan):
        retained = _source_ids(plan)
        history = conn.execute(
            "SELECT snapshot FROM course_outline_approvals WHERE outline_id=%s AND user_id=%s",
            (identifier, user_id),
        ).fetchall()
        for approval in history:
            retained.update(_source_ids(OutlinePlan.model_validate(approval["snapshot"]["plan"])))
        conn.execute(
            "DELETE FROM course_outline_sources WHERE outline_id=%s AND user_id=%s "
            "AND NOT (source_version_id=ANY(%s::uuid[]))", (identifier, user_id, sorted(retained)),
        )
        for source_id in sorted(retained):
            conn.execute(
                "INSERT INTO course_outline_sources (outline_id,user_id,source_version_id) VALUES (%s,%s,%s) "
                "ON CONFLICT (outline_id,source_version_id) DO NOTHING", (identifier, user_id, source_id),
            )

    def create(self, user_id, body: OutlineCreateRequest):
        import psycopg
        from psycopg.types.json import Jsonb

        body = OutlineCreateRequest.model_validate(body.model_dump(mode="json"))
        identifier, digest = str(body.id), body.plan.content_hash()
        try:
            with self._connection() as conn:
                self._owner(conn, user_id)
                existing = conn.execute("SELECT user_id FROM course_outlines WHERE id=%s", (identifier,)).fetchone()
                if existing is not None and str(existing["user_id"]) != user_id:
                    raise NotFound("Outline not found")
                sources = self._sources(conn, user_id, identifier, body.plan, lock=True)
                if existing is not None:
                    row = self._row(conn, user_id, identifier, lock=True)
                    if row["content_hash"] != digest:
                        raise Conflict("Outline identifier is already used by different content")
                    return self._record(conn, user_id, row, sources=sources)
                count = conn.execute("SELECT count(*) AS count FROM course_outlines WHERE user_id=%s", (user_id,))
                if count.fetchone()["count"] >= self.max_outlines_per_user:
                    raise InvalidInput("Outline limit reached for this account")
                analyze_plan(user_id, body.plan, self.source_versions, conn=conn)
                conn.execute(
                    "INSERT INTO course_outlines (id,user_id,plan,content_hash) VALUES (%s,%s,%s,%s)",
                    (identifier, user_id, Jsonb(body.plan.model_dump(mode="json")), digest),
                )
                self._link(conn, user_id, identifier, body.plan)
                return self._record(conn, user_id, self._row(conn, user_id, identifier), sources=sources)
        except psycopg.errors.UniqueViolation as exc:
            raise NotFound("Outline not found") from exc

    def get(self, user_id, identifier):
        with self._connection() as conn:
            return self._record(conn, user_id, self._row(conn, user_id, str(identifier)))

    def update(self, user_id, identifier, body: OutlineUpdateRequest):
        from psycopg.types.json import Jsonb

        identifier = str(identifier)
        body = OutlineUpdateRequest.model_validate(body.model_dump(mode="json"))
        with self._connection() as conn:
            self._owner(conn, user_id)
            sources = self._sources(conn, user_id, identifier, body.plan, lock=True)
            row = self._row(conn, user_id, identifier, lock=True)
            if row["revision"] != body.expected_revision:
                raise Conflict("Outline changed; reload before saving")
            analyze_plan(user_id, body.plan, self.source_versions, conn=conn)
            conn.execute(
                "UPDATE course_outlines SET plan=%s,content_hash=%s,revision=revision+1,status='draft',"
                "approved_revision=NULL,approved_at=NULL,updated_at=now() WHERE id=%s AND user_id=%s",
                (Jsonb(body.plan.model_dump(mode="json")), body.plan.content_hash(), identifier, user_id),
            )
            self._link(conn, user_id, identifier, body.plan)
            return self._record(conn, user_id, self._row(conn, user_id, identifier), sources=sources)

    def list(self, user_id, *, limit=20, offset=0):
        _page(limit, offset)
        with self._connection() as conn:
            rows = conn.execute(
                "SELECT id FROM course_outlines WHERE user_id=%s ORDER BY updated_at DESC,id DESC LIMIT %s OFFSET %s",
                (user_id, limit, offset),
            ).fetchall()
            total = conn.execute(
                "SELECT count(*) AS count FROM course_outlines WHERE user_id=%s", (user_id,),
            ).fetchone()
            items = [_summary(self._record(conn, user_id, self._row(conn, user_id, str(row["id"])))) for row in rows]
            return OutlineListResponse(items=items, limit=limit, offset=offset, total_count=total["count"])

    def approve(self, user_id, identifier, body: OutlineApproveRequest):
        from psycopg.types.json import Jsonb

        identifier = str(identifier)
        body = OutlineApproveRequest.model_validate(body.model_dump(mode="json"))
        with self._connection() as conn:
            self._owner(conn, user_id)
            sources = self._sources(conn, user_id, identifier, lock=True)
            row = self._row(conn, user_id, identifier, lock=True)
            plan = OutlinePlan.model_validate(row["plan"])
            self._selected_sources(plan, sources)
            coverage = analyze_plan(user_id, plan, self.source_versions, conn=conn)
            _check_approval(row, body, coverage)
            if row["status"] == "approved":
                return self._record(conn, user_id, row, sources=sources)
            count = conn.execute(
                "SELECT count(*) AS count FROM course_outline_approvals WHERE outline_id=%s AND user_id=%s",
                (identifier, user_id),
            ).fetchone()
            if count["count"] >= self.max_approvals_per_outline:
                raise InvalidInput("Outline approval history limit reached")
            conn.execute(
                "INSERT INTO course_outline_approvals (outline_id,user_id,revision,content_hash,snapshot) "
                "VALUES (%s,%s,%s,%s,%s)",
                (identifier, user_id, row["revision"], row["content_hash"], Jsonb({
                    "plan": plan.model_dump(mode="json"), "coverage": coverage.model_dump(mode="json"),
                })),
            )
            conn.execute(
                "UPDATE course_outlines SET status='approved',approved_revision=revision,approved_at=now(),"
                "updated_at=now() WHERE id=%s AND user_id=%s", (identifier, user_id),
            )
            return self._record(conn, user_id, self._row(conn, user_id, identifier), sources=sources)

    def history(self, user_id, identifier):
        with self._connection() as conn:
            self._record(conn, user_id, self._row(conn, user_id, str(identifier)))
            rows = conn.execute(
                "SELECT id,outline_id,revision,content_hash,snapshot,created_at FROM course_outline_approvals "
                "WHERE outline_id=%s AND user_id=%s ORDER BY revision DESC LIMIT 50", (str(identifier), user_id),
            ).fetchall()
            return OutlineApprovalListResponse(items=[self._approval(row) for row in rows])

    def delete(self, user_id, identifier):
        with self._connection() as conn:
            self._owner(conn, user_id)
            self._sources(conn, user_id, str(identifier), lock=True)
            self._row(conn, user_id, str(identifier), lock=True)
            conn.execute("DELETE FROM course_outlines WHERE id=%s AND user_id=%s", (str(identifier), user_id))
