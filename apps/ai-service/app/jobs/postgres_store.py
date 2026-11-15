"""Postgres-backed JobStore (task 1.14). Schema: docs/schema.md `jobs` table.

Claim is `SELECT ... FOR UPDATE SKIP LOCKED` inside a short transaction so
concurrent workers never take the same job. Retried jobs go back to
`pending` with a `run_after` in the future; permanent failures become `failed`.

Requires `psycopg[binary]`; the app falls back to `InMemoryJobStore` when the
package or DATABASE_URL is absent so tests and dev still run.
"""

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from app.jobs.worker import Job, JobStore

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
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_{table}_poll ON {table} (status, run_after);
"""


def _to_job(row: tuple) -> Job:
    (jid, kind, payload, status, attempts, max_attempts, error_reason, run_after, result) = row
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
    )


class PgJobStore(JobStore):
    def __init__(self, database_url: str, table: str = "jobs") -> None:
        import psycopg

        if not table.replace("_", "").isalnum():
            raise ValueError("table name must be a simple identifier")
        self._table = table
        self._conn = psycopg.connect(database_url, autocommit=True)
        self._init_schema()

    def _init_schema(self) -> None:
        with self._conn.cursor() as cur:
            cur.execute(_create_sql(self._table))

    def add(self, job: Job) -> Job:
        if not job.id:
            job.id = str(uuid.uuid4())
        with self._conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {self._table} (id, kind, payload, status, attempts, max_attempts, run_after)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (
                    job.id,
                    job.kind,
                    json.dumps(job.payload),
                    job.status,
                    job.attempts,
                    job.max_attempts,
                    job.run_after,
                ),
            )
        return job

    def claim_next(self, now: datetime) -> Job | None:
        # Claim atomically so two workers never take the same job. The claim
        # runs in its own transaction: the row lock is released on commit, while
        # the status='running' + claimed_at update makes the claim durable.
        t = self._table
        with self._conn.transaction():
            with self._conn.cursor() as cur:
                cur.execute(
                    f"SELECT id FROM {t} WHERE status = 'pending' AND run_after <= %s"
                    " ORDER BY run_after LIMIT 1 FOR UPDATE SKIP LOCKED",
                    (now,),
                )
                row = cur.fetchone()
                if row is None:
                    return None
                job_id = row[0]
                cur.execute(
                    f"UPDATE {t} SET status='running', claimed_at=%s, updated_at=%s WHERE id=%s",
                    (now, now, job_id),
                )
                cur.execute(
                    f"SELECT id, kind, payload, status, attempts, max_attempts, error_reason, run_after, "
                    f"payload->'result' AS result FROM {t} WHERE id=%s",
                    (job_id,),
                )
                full = cur.fetchone()
        return _to_job(full) if full else None

    def _touch(self, job_id: str, sql_fragment: str, params: tuple) -> None:
        with self._conn.cursor() as cur:
            cur.execute(sql_fragment + ", updated_at=%s WHERE id=%s", (*params, datetime.now(UTC), job_id))

    def mark_running(self, job_id: str) -> None:
        self._touch(job_id, f"UPDATE {self._table} SET status='running'", ())

    def mark_done(self, job_id: str, result: dict[str, Any] | None = None) -> None:
        payload_result = json.dumps(result) if result is not None else None
        with self._conn.cursor() as cur:
            cur.execute(
                f"UPDATE {self._table} SET status='done', error_reason=NULL, "
                "payload = payload || jsonb_build_object('result', COALESCE(%s::jsonb, 'null'::jsonb))"
                ", updated_at=%s WHERE id=%s",
                (payload_result, datetime.now(UTC), job_id),
            )

    def mark_retry(self, job_id: str, run_after: datetime) -> None:
        self._touch(job_id, f"UPDATE {self._table} SET status='pending', run_after=%s", (run_after,))

    def mark_failed(self, job_id: str, reason: str) -> None:
        self._touch(job_id, f"UPDATE {self._table} SET status='failed', error_reason=%s", (reason,))

    # Read path used by GET /api/jobs/{id}
    def get(self, job_id: str, user_id: str) -> Job | None:
        with self._conn.cursor() as cur:
            cur.execute(
                f"SELECT id, kind, payload, status, attempts, max_attempts, error_reason, run_after, "
                f"payload->'result' AS result FROM {self._table} WHERE id=%s",
                (job_id,),
            )
            row = cur.fetchone()
        if row is None:
            return None
        job = _to_job(row)
        return job if job.payload.get("user_id") == user_id else None

    def close(self) -> None:
        self._conn.close()
