"""Integration test for the Postgres job store (task 1.14).

Runs only when STUDYVAULT_TEST_DATABASE_URL points at a disposable database
(e.g. the Neon dev branch). It uses a unique table name per run so it never
touches the migrated `jobs` table — no search_path tricks needed (the Neon
pooler rejects that startup parameter).

    STUDYVAULT_TEST_DATABASE_URL=postgresql://... pytest tests/test_pg_job_store.py
"""

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest

pytest.importorskip("psycopg")

URL = os.environ.get("STUDYVAULT_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="STUDYVAULT_TEST_DATABASE_URL not set")


@pytest.fixture()
def store():
    import psycopg

    from app.jobs.postgres_store import PgJobStore

    table = f"jobs_test_{uuid.uuid4().hex[:8]}"
    s = PgJobStore(URL, table=table)
    yield s
    try:
        with psycopg.connect(URL, autocommit=True) as conn, conn.cursor() as cur:
            cur.execute(f"DROP TABLE IF EXISTS {table}")
    finally:
        s.close()


def _job(store, kind: str = "dummy", **kw):
    from app.jobs.worker import Job

    return store.add(Job(id=str(uuid.uuid4()), kind=kind, payload={"user_id": "u1", **kw}))


def test_add_and_claim_roundtrip(store) -> None:
    job = _job(store)
    claimed = store.claim_next(datetime.now(UTC))
    assert claimed is not None
    assert claimed.id == job.id
    assert claimed.status == "running"
    assert store.get(job.id, "u1") is not None
    assert store.get(job.id, "someone-else") is None


def test_retry_then_done(store) -> None:
    job = _job(store)
    store.claim_next(datetime.now(UTC))
    later = datetime.now(UTC) + timedelta(minutes=5)
    store.mark_retry(job.id, later)
    # Not yet due.
    assert store.claim_next(datetime.now(UTC)) is None
    # Due again.
    claimed = store.claim_next(later)
    assert claimed is not None and claimed.id == job.id
    store.mark_done(job.id, {"ok": True})
    got = store.get(job.id, "u1")
    assert got is not None and got.status == "done" and got.result == {"ok": True}


def test_failed_job_is_terminal(store) -> None:
    job = _job(store)
    store.claim_next(datetime.now(UTC))
    store.mark_failed(job.id, "boom")
    got = store.get(job.id, "u1")
    assert got is not None and got.status == "failed" and got.error_reason == "boom"
    assert store.claim_next(datetime.now(UTC)) is None


def test_claim_is_exclusive(store) -> None:
    _job(store)
    first = store.claim_next(datetime.now(UTC))
    second = store.claim_next(datetime.now(UTC))
    assert first is not None
    assert second is None  # already running: never handed to a second worker
