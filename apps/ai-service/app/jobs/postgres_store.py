"""Postgres-backed JobStore (task 1.14). Schema: docs/schema.md `jobs` table.

Claim is `SELECT ... FOR UPDATE SKIP LOCKED` inside a short transaction so
concurrent workers never take the same job. Retried jobs go back to
`pending` with a `run_after` in the future; permanent failures become `failed`.

Requires `psycopg[binary]`; the app falls back to `InMemoryJobStore` when the
package or DATABASE_URL is absent so tests and dev still run.
"""

import json
import logging
import re
import threading
import uuid
from contextlib import contextmanager, nullcontext
from datetime import UTC, datetime, timedelta
from typing import Any

from app.jobs.worker import Job, JobStore, LeaseLost, current_claim, stage_key

logger = logging.getLogger("studyvault.jobs.pg")


def _create_sql(table: str) -> str:
    return f"""
CREATE TABLE IF NOT EXISTS {table} (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    error_reason text,
    run_after timestamptz DEFAULT now() NOT NULL,
    claimed_at timestamptz,
    lease_token uuid,
    lease_expires_at timestamptz,
    heartbeat_at timestamptz,
    cancel_requested boolean NOT NULL DEFAULT false,
    dedupe_key text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_{table}_poll ON {table} (status, run_after);
CREATE INDEX IF NOT EXISTS idx_{table}_expiry ON {table} (status, lease_expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_dedupe ON {table} (kind, dedupe_key)
    WHERE dedupe_key IS NOT NULL;
"""


def _to_job(row: tuple) -> Job:
    (
        jid,
        kind,
        payload,
        status,
        attempts,
        max_attempts,
        error_reason,
        run_after,
        result,
        lease_token,
        lease_expires_at,
        heartbeat_at,
        cancel_requested,
        dedupe_key,
    ) = row
    return Job(
        id=str(jid),
        kind=kind,
        payload=payload,
        status=status,
        attempts=attempts,
        max_attempts=max_attempts,
        error_reason=error_reason,
        result=result,
        run_after=run_after,
        lease_token=str(lease_token) if lease_token is not None else None,
        lease_expires_at=lease_expires_at,
        heartbeat_at=heartbeat_at,
        cancel_requested=cancel_requested,
        dedupe_key=dedupe_key,
    )


class PgJobStore(JobStore):
    def __init__(
        self, database_url: str, table: str = "jobs", *, owner_table: str = "users", lease_seconds: float = 60
    ) -> None:
        import psycopg

        if any(re.fullmatch(r"[a-z_][a-z0-9_]*", name) is None for name in (table, owner_table)):
            raise ValueError("table name must be a simple identifier")
        self._table = table
        self._owner_table = owner_table
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        self.lease_seconds = lease_seconds
        # Cursors share a transaction on a psycopg connection. Serialize complete
        # transactions so the heartbeat thread cannot join a handler transaction.
        self._lock = threading.RLock()
        self._conn = psycopg.connect(database_url, autocommit=True)
        self._init_schema()

    def healthcheck(self) -> None:
        """Raise when the durable job database cannot answer a trivial query."""
        with self._lock, self._conn.cursor() as cur:
            cur.execute("SELECT 1")
            if cur.fetchone() != (1,):
                raise RuntimeError("job database health check returned an invalid result")

    def _init_schema(self) -> None:
        with self._conn.cursor() as cur:
            cur.execute(_create_sql(self._table))

    def add(self, job: Job) -> Job:
        if not job.id:
            job.id = str(uuid.uuid4())
        with self._lock, self._conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {self._table} (id, kind, payload, status, attempts, max_attempts, run_after, dedupe_key)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"
                " ON CONFLICT DO NOTHING",
                (
                    job.id,
                    job.kind,
                    json.dumps(job.payload),
                    job.status,
                    job.attempts,
                    job.max_attempts,
                    job.run_after,
                    job.dedupe_key,
                ),
            )
            if cur.rowcount == 0:
                cur.execute(
                    f"SELECT {self._columns()} FROM {self._table} WHERE id=%s OR (kind=%s AND dedupe_key=%s)",
                    (job.id, job.kind, job.dedupe_key),
                )
                existing = cur.fetchone()
                if (
                    existing is None
                    or existing[1] != job.kind
                    or existing[2].get("user_id") != job.payload.get("user_id")
                ):
                    raise ValueError("job id or stage key belongs to another owner or kind")
                return _to_job(existing)
        return job

    @staticmethod
    def _columns() -> str:
        return (
            "id, kind, payload, status, attempts, max_attempts, error_reason, run_after, "
            "payload->'result' AS result, lease_token, lease_expires_at, heartbeat_at, "
            "cancel_requested, dedupe_key"
        )

    def claim_next(self, now: datetime) -> Job | None:
        # Claim atomically so two workers never take the same job. The claim
        # runs in its own transaction: the row lock is released on commit, while
        # the status='running' + claimed_at update makes the claim durable.
        t = self._table
        with self._lock, self._conn.transaction():
            with self._conn.cursor() as cur:
                # Exhausted claims must terminate even when a worker died before
                # recording its final failure. Each recovery batch is bounded.
                cur.execute(
                    f"WITH expired AS (SELECT id FROM {t} WHERE (status='pending' AND run_after<=%s "
                    "OR status='running' AND lease_expires_at<=%s) AND (attempts>=max_attempts OR cancel_requested) "
                    "ORDER BY run_after LIMIT 100 FOR UPDATE SKIP LOCKED) "
                    f"UPDATE {t} SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END, "
                    "error_reason=COALESCE(error_reason, 'Worker lease expired; retry limit reached'), "
                    "lease_token=NULL, lease_expires_at=NULL, updated_at=%s WHERE id IN (SELECT id FROM expired)",
                    (now, now, now),
                )
                cur.execute(
                    f"SELECT id FROM {t} WHERE ((status='pending' AND run_after<=%s) "
                    "OR (status='running' AND lease_expires_at<=%s)) AND attempts<max_attempts AND NOT cancel_requested"
                    " ORDER BY run_after LIMIT 1 FOR UPDATE SKIP LOCKED",
                    (now, now),
                )
                row = cur.fetchone()
                if row is None:
                    return None
                job_id = row[0]
                cur.execute(
                    f"UPDATE {t} SET status='running', attempts=attempts+1, claimed_at=%s, heartbeat_at=%s, "
                    "lease_token=%s, lease_expires_at=%s, updated_at=%s WHERE id=%s",
                    (now, now, str(uuid.uuid4()), now + timedelta(seconds=self.lease_seconds), now, job_id),
                )
                cur.execute(
                    f"SELECT {self._columns()} FROM {t} WHERE id=%s",
                    (job_id,),
                )
                full = cur.fetchone()
        return _to_job(full) if full else None

    def _touch(
        self,
        job_id: str,
        sql_fragment: str,
        params: tuple,
        *,
        lease_token: str | None = None,
        now: datetime | None = None,
    ) -> bool:
        now = now or datetime.now(UTC)
        fence = " AND lease_token=%s AND lease_expires_at>%s" if lease_token else ""
        with self._lock, self._conn.cursor() as cur:
            cur.execute(
                sql_fragment + ", updated_at=%s WHERE id=%s AND status='running' AND NOT cancel_requested" + fence,
                (*params, now, job_id, *((lease_token, now) if lease_token else ())),
            )
            return cur.rowcount == 1

    def mark_running(self, job_id: str) -> None:
        with self._lock, self._conn.cursor() as cur:
            cur.execute(f"UPDATE {self._table} SET status='running' WHERE id=%s AND status='pending'", (job_id,))

    def mark_done(
        self,
        job_id: str,
        result: dict[str, Any] | None = None,
        *,
        lease_token: str | None = None,
        now: datetime | None = None,
    ) -> bool:
        payload_result = json.dumps(result) if result is not None else None
        return self._touch(
            job_id,
            f"UPDATE {self._table} SET status='done', error_reason=NULL, "
            "lease_token=NULL, lease_expires_at=NULL, payload=(payload-'flashcard_checkpoint') || "
            "jsonb_build_object('result', COALESCE(%s::jsonb, 'null'::jsonb))",
            (payload_result,),
            lease_token=lease_token,
            now=now,
        )

    def is_current(self, job_id: str, lease_token: str, now: datetime) -> bool:
        with self._lock, self._conn.cursor() as cur:
            cur.execute(
                f"SELECT 1 FROM {self._table} WHERE id=%s AND status='running' AND NOT cancel_requested "
                "AND lease_token=%s AND lease_expires_at>%s",
                (job_id, lease_token, now),
            )
            return cur.fetchone() is not None

    def heartbeat(self, job_id: str, lease_token: str, now: datetime) -> bool:
        return self._touch(
            job_id,
            f"UPDATE {self._table} SET heartbeat_at=%s, lease_expires_at=%s",
            (now, now + timedelta(seconds=self.lease_seconds)),
            lease_token=lease_token,
            now=now,
        )

    @contextmanager
    def publication(self, job_id: str, lease_token: str, now: datetime):
        with self._lock, self._conn.transaction(), self._conn.cursor() as cur:
            cur.execute(
                f"SELECT id FROM {self._table} WHERE id=%s AND status='running' AND NOT cancel_requested "
                "AND lease_token=%s AND lease_expires_at>%s FOR UPDATE",
                (job_id, lease_token, now),
            )
            if cur.fetchone() is None:
                raise LeaseLost("Cannot publish with an expired or cancelled claim")
            yield

    def request_cancel(self, job_id: str, user_id: str) -> bool:
        with self._lock, self._conn.cursor() as cur:
            cur.execute(
                f"UPDATE {self._table} SET cancel_requested=true, status='cancelled', lease_token=NULL, "
                "lease_expires_at=NULL, updated_at=now() WHERE id=%s AND payload->>'user_id'=%s "
                "AND status IN ('pending', 'running')",
                (job_id, user_id),
            )
            return cur.rowcount == 1

    def commit_parse_stage(
        self, *, document_id: str, user_id: str, markdown: str, page_count: int, unreadable_pages: list[int]
    ) -> dict[str, Any]:
        """Publish parsed text, discard temporary bytes, enqueue the consumer and
        finish the producer in one transaction. The jobs row is the outbox.
        """
        claim = current_claim.get()
        if (
            claim is None
            or claim.store is not self
            or claim.job.kind != "parse_pdf"
            or claim.job.payload.get("user_id") != user_id
            or claim.job.payload.get("document_id") != document_id
        ):
            raise LeaseLost("Parse stage requires its current authenticated claim")
        key = stage_key(user_id, document_id, "structure_chapters")
        next_id = str(uuid.uuid5(uuid.NAMESPACE_URL, key))
        next_payload = {"job_id": next_id, "user_id": user_id, "document_id": document_id, "stage_key": key}
        now = claim.clock()
        with self._lock, self._conn.transaction(), self._conn.cursor() as cur:
            cur.execute(
                f"SELECT id FROM {self._table} WHERE id=%s AND status='running' AND NOT cancel_requested "
                "AND lease_token=%s AND lease_expires_at>%s FOR UPDATE",
                (claim.job.id, claim.job.lease_token, now),
            )
            if cur.fetchone() is None:
                raise LeaseLost("Parse claim is no longer current")
            cur.execute(
                "UPDATE documents SET markdown=%s, page_count=%s, status='parsed', error_reason=NULL, "
                "source_bytes=NULL, updated_at=%s WHERE id=%s AND user_id=%s",
                (markdown, page_count, now, document_id, user_id),
            )
            if cur.rowcount != 1:
                raise LeaseLost("Parse document was removed or belongs to another owner")
            cur.execute(
                f"INSERT INTO {self._table} (id, kind, payload, dedupe_key, run_after) "
                "VALUES (%s, 'structure_chapters', %s::jsonb, %s, %s) "
                "ON CONFLICT (kind, dedupe_key) WHERE dedupe_key IS NOT NULL "
                f"DO UPDATE SET dedupe_key={self._table}.dedupe_key RETURNING id",
                (next_id, json.dumps(next_payload), key, now),
            )
            next_id = str(cur.fetchone()[0])
            result = {
                "document_id": document_id,
                "page_count": page_count,
                "unreadable_pages": unreadable_pages,
                "next_job_id": next_id,
            }
            cur.execute(
                f"UPDATE {self._table} SET status='done', error_reason=NULL, lease_token=NULL, "
                "lease_expires_at=NULL, payload=payload || jsonb_build_object('result', %s::jsonb), "
                "updated_at=%s WHERE id=%s",
                (json.dumps(result), now, claim.job.id),
            )
        return result

    def save_flashcard_checkpoint(self, job_id: str, user_id: str, checkpoint: dict[str, Any]) -> bool:
        """Persist a private draft without allowing deleted/completed jobs to be recreated."""
        claim = current_claim.get()
        token = claim.job.lease_token if claim else None
        now = claim.clock() if claim else datetime.now(UTC)
        fence = " AND lease_token=%s AND lease_expires_at>%s" if token else ""
        with getattr(self, "_lock", nullcontext()), self._conn.transaction(), self._conn.cursor() as cur:
            # Coordinate with account deletion: either the draft commits first
            # and is removed by deletion, or the absent owner prevents its save.
            cur.execute(f"SELECT id FROM {self._owner_table} WHERE id::text = %s FOR KEY SHARE", (user_id,))
            if cur.fetchone() is None:
                return False
            cur.execute(
                f"UPDATE {self._table} SET payload = jsonb_set(payload, '{{flashcard_checkpoint}}', %s::jsonb), "
                "updated_at=%s WHERE id=%s AND payload->>'user_id'=%s "
                "AND kind='generate_flashcards' AND status='running' AND NOT cancel_requested" + fence,
                (json.dumps(checkpoint), now, job_id, user_id, *((token, now) if token else ())),
            )
            return cur.rowcount == 1

    def mark_retry(
        self,
        job_id: str,
        run_after: datetime,
        *,
        lease_token: str | None = None,
        now: datetime | None = None,
        reason: str | None = None,
        refund_attempt: bool = False,
    ) -> bool:
        return self._touch(
            job_id,
            f"UPDATE {self._table} SET status='pending', run_after=%s, error_reason=%s, "
            "attempts=GREATEST(0, attempts-%s), lease_token=NULL, lease_expires_at=NULL",
            (run_after, reason, 1 if refund_attempt else 0),
            lease_token=lease_token,
            now=now,
        )

    def mark_failed(
        self, job_id: str, reason: str, *, lease_token: str | None = None, now: datetime | None = None
    ) -> bool:
        return self._touch(
            job_id,
            f"UPDATE {self._table} SET status='failed', error_reason=%s, lease_token=NULL, lease_expires_at=NULL",
            (reason,),
            lease_token=lease_token,
            now=now,
        )

    # Read path used by GET /api/jobs/{id}
    def get(self, job_id: str, user_id: str) -> Job | None:
        with self._lock, self._conn.cursor() as cur:
            cur.execute(
                f"SELECT {self._columns()} FROM {self._table} WHERE id=%s AND payload->>'user_id'=%s",
                (job_id, user_id),
            )
            row = cur.fetchone()
        if row is None:
            return None
        job = _to_job(row)
        return job if job.payload.get("user_id") == user_id else None

    def close(self) -> None:
        self._conn.close()
