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
    owner_table = f"owners_test_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(URL, autocommit=True) as conn:
        conn.execute(f"CREATE TABLE {owner_table} (id text PRIMARY KEY)")
        conn.execute(f"INSERT INTO {owner_table} VALUES ('u1')")
    s = PgJobStore(URL, table=table, owner_table=owner_table)
    yield s
    try:
        with psycopg.connect(URL, autocommit=True) as conn, conn.cursor() as cur:
            cur.execute(f"DROP TABLE IF EXISTS {table}")
            cur.execute(f"DROP TABLE IF EXISTS {owner_table}")
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


def test_flashcard_checkpoint_is_owner_scoped_durable_and_removed_after_completion(store) -> None:
    job = _job(store, "generate_flashcards", document_id="doc")
    checkpoint = {"version": 1, "fingerprint": "a" * 64, "chapters": {"chapter": []}}
    assert not store.save_flashcard_checkpoint(job.id, "u1", checkpoint)  # pending
    assert store.claim_next(datetime.now(UTC)) is not None
    assert not store.save_flashcard_checkpoint(job.id, "someone-else", checkpoint)
    assert store.save_flashcard_checkpoint(job.id, "u1", checkpoint)
    store.mark_retry(job.id, datetime.now(UTC))
    claimed = store.claim_next(datetime.now(UTC))
    assert claimed.payload["flashcard_checkpoint"] == checkpoint
    store.mark_done(job.id, {"flashcard_count": 1})
    assert "flashcard_checkpoint" not in store.get(job.id, "u1").payload
    assert not store.save_flashcard_checkpoint(job.id, "u1", checkpoint)


def test_deleted_owner_cannot_save_draft_even_if_job_still_exists(store) -> None:
    job = _job(store, "generate_flashcards", document_id="doc")
    assert store.claim_next(datetime.now(UTC)) is not None
    with store._conn.cursor() as cur:
        cur.execute(f"DELETE FROM {store._owner_table} WHERE id=%s", ("u1",))
    assert not store.save_flashcard_checkpoint(job.id, "u1", {"chapters": {}})


def test_claim_attempt_persists_across_connection_restart_and_expired_lease_is_fenced(store) -> None:
    from app.jobs.postgres_store import PgJobStore

    job = _job(store)
    now = datetime.now(UTC)
    first = store.claim_next(now)
    restarted = PgJobStore(URL, table=store._table, owner_table=store._owner_table)
    try:
        assert restarted.get(job.id, "u1").attempts == 1
        later = now + timedelta(seconds=store.lease_seconds)
        second = restarted.claim_next(later)
        assert second.id == first.id and second.attempts == 2
        assert second.lease_token != first.lease_token
        assert not store.mark_done(job.id, {"stale": True}, lease_token=first.lease_token, now=later)
        assert not store.heartbeat(job.id, first.lease_token, later)
        assert restarted.mark_done(job.id, {"current": True}, lease_token=second.lease_token, now=later)
        assert store.get(job.id, "u1").result == {"current": True}
    finally:
        restarted.close()


def test_cancellation_and_successor_dedupe_survive_connection_restart(store) -> None:
    from app.jobs.worker import Job, stage_key

    key = stage_key("u1", "document", "structure_chapters")
    first = store.add(Job(str(uuid.uuid4()), "structure_chapters", {"user_id": "u1"}, dedupe_key=key))
    second = store.add(Job(str(uuid.uuid4()), "structure_chapters", {"user_id": "u1"}, dedupe_key=key))
    assert first.id == second.id
    claim = store.claim_next(datetime.now(UTC))
    assert not store.request_cancel(first.id, "another-owner")
    assert store.request_cancel(first.id, "u1")
    assert not store.mark_done(first.id, {}, lease_token=claim.lease_token)
    assert store.get(first.id, "u1").status == "cancelled"


def test_parse_output_original_clear_and_successor_roll_back_together(store) -> None:
    from psycopg.errors import CheckViolation

    from app.jobs.worker import Claim, LeaseLost, current_claim

    document_id = str(uuid.uuid4())
    # A connection-local temporary table shadows the real documents table;
    # this acceptance fixture never writes a migrated/private document row.
    store._conn.execute(
        "CREATE TEMP TABLE documents (id uuid PRIMARY KEY, user_id text NOT NULL, markdown text, "
        "page_count integer, status text, error_reason text, source_bytes bytea, updated_at timestamptz)"
    )
    store._conn.execute(
        "INSERT INTO documents (id, user_id, source_bytes) VALUES (%s, 'u1', %s)", (document_id, b"%PDF-original")
    )
    job = _job(store, "parse_pdf", document_id=document_id)
    now = datetime.now(UTC)
    claimed = store.claim_next(now)
    token = current_claim.set(Claim(store, claimed, lambda: now))
    try:
        store._conn.execute(
            f"ALTER TABLE {store._table} ADD CONSTRAINT fail_handoff CHECK (kind <> 'structure_chapters')"
        )
        with pytest.raises(CheckViolation):
            store.commit_parse_stage(
                document_id=document_id, user_id="u1", markdown="saved", page_count=1, unreadable_pages=[]
            )
        row = store._conn.execute("SELECT markdown, source_bytes FROM documents WHERE id=%s", (document_id,)).fetchone()
        assert row == (None, b"%PDF-original")
        assert store.get(job.id, "u1").status == "running"
        store._conn.execute(f"ALTER TABLE {store._table} DROP CONSTRAINT fail_handoff")
        result = store.commit_parse_stage(
            document_id=document_id, user_id="u1", markdown="saved", page_count=1, unreadable_pages=[]
        )
        row = store._conn.execute("SELECT markdown, source_bytes FROM documents WHERE id=%s", (document_id,)).fetchone()
        assert row == ("saved", None)
        assert store.get(job.id, "u1").status == "done"
        assert store.get(result["next_job_id"], "u1").kind == "structure_chapters"
        with pytest.raises(LeaseLost):
            store.commit_parse_stage(
                document_id=document_id, user_id="u1", markdown="replay", page_count=1, unreadable_pages=[]
            )
        assert (
            store._conn.execute(f"SELECT count(*) FROM {store._table} WHERE kind='structure_chapters'").fetchone()[0]
            == 1
        )
    finally:
        current_claim.reset(token)
