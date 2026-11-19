"""Crash/replay tests use explicit clocks and kill points, without real sleeps."""

import copy
import threading
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest

from app.documents.store import InMemoryDocumentStore
from app.jobs.postgres_store import PgJobStore
from app.jobs.worker import Claim, InMemoryJobStore, Job, LeaseLost, Worker, current_claim, stage_key
from app.parsing.pdf import ParseResult
from app.pipeline import make_parse_handler, make_structure_handler

NOW = datetime(2026, 11, 18, tzinfo=UTC)


def pending(store, *, kind="noop", **kwargs):
    return store.add(Job(id="job", kind=kind, payload={"user_id": "alice"}, run_after=NOW, **kwargs))


def test_attempt_and_failure_survive_a_worker_restart():
    store = InMemoryJobStore()
    pending(store, max_attempts=2)

    def broken(payload):
        raise RuntimeError("provider interrupted")

    Worker(store, {"noop": broken}, backoff_seconds=1).process_one(NOW)
    saved = asdict(store.jobs["job"])
    assert saved["attempts"] == 1 and saved["error_reason"] == "RuntimeError: provider interrupted"
    restarted = InMemoryJobStore()
    restarted.add(Job(**saved))
    Worker(restarted, {"noop": broken}).process_one(NOW + timedelta(seconds=2))
    assert restarted.jobs["job"].attempts == 2
    assert restarted.jobs["job"].status == "failed"
    assert not Worker(restarted, {"noop": broken}).process_one(NOW + timedelta(days=1))


def test_dead_worker_reclaimed_with_new_token_and_old_worker_cannot_publish():
    store = InMemoryJobStore(lease_seconds=10)
    pending(store)
    old = store.claim_next(NOW)
    assert old.attempts == 1
    assert store.claim_next(NOW + timedelta(seconds=9)) is None
    new = store.claim_next(NOW + timedelta(seconds=10))
    assert new.attempts == 2 and old.lease_token != new.lease_token
    assert not store.mark_done(old.id, {"old": True}, lease_token=old.lease_token, now=NOW + timedelta(seconds=11))
    assert not store.mark_retry(old.id, NOW, lease_token=old.lease_token, now=NOW + timedelta(seconds=11))
    assert not store.mark_failed(old.id, "late", lease_token=old.lease_token, now=NOW + timedelta(seconds=11))
    assert not store.heartbeat(old.id, old.lease_token, NOW + timedelta(seconds=11))
    with pytest.raises(LeaseLost), store.publication(old.id, old.lease_token, NOW + timedelta(seconds=11)):
        pytest.fail("stale publication was allowed")
    assert store.mark_done(new.id, {"new": True}, lease_token=new.lease_token, now=NOW + timedelta(seconds=11))
    assert store.jobs["job"].result == {"new": True}


def test_heartbeat_renews_only_a_live_claim_and_exhaustion_is_terminal():
    store = InMemoryJobStore(lease_seconds=10)
    pending(store, max_attempts=1)
    job = store.claim_next(NOW)
    assert store.heartbeat(job.id, job.lease_token, NOW + timedelta(seconds=9))
    assert store.claim_next(NOW + timedelta(seconds=11)) is None
    assert not store.heartbeat(job.id, job.lease_token, NOW + timedelta(seconds=19))
    assert store.claim_next(NOW + timedelta(seconds=19)) is None
    assert store.jobs[job.id].status == "failed"
    assert store.jobs[job.id].attempts == 1


def test_worker_heartbeat_runs_while_handler_is_blocked():
    store = InMemoryJobStore(lease_seconds=1)
    pending(store)
    renewed = threading.Event()
    heartbeat = store.heartbeat

    def record_heartbeat(*args):
        result = heartbeat(*args)
        renewed.set()
        return result

    store.heartbeat = record_heartbeat
    Worker(store, {"noop": lambda payload: {"renewed": renewed.wait(1)}}, heartbeat_seconds=0.01).process_one(NOW)
    assert store.jobs["job"].result == {"renewed": True}


@pytest.mark.parametrize("claimed", [False, True])
def test_owner_cancel_revokes_pending_and_running_claims(claimed):
    store = InMemoryJobStore()
    pending(store)
    job = store.claim_next(NOW) if claimed else None
    assert not store.request_cancel("job", "bob")
    assert store.request_cancel("job", "alice")
    assert store.jobs["job"].status == "cancelled"
    assert store.claim_next(NOW + timedelta(days=1)) is None
    if job:
        assert not store.mark_done(job.id, {}, lease_token=job.lease_token, now=NOW)


def test_stable_stages_deduplicate_but_different_owners_do_not_collide():
    store = InMemoryJobStore()
    key = stage_key("alice", "doc", "structure_chapters")
    first = store.add(Job("first", "structure_chapters", {"user_id": "alice"}, dedupe_key=key))
    duplicate = store.add(Job("second", "structure_chapters", {"user_id": "alice"}, dedupe_key=key))
    assert first.id == duplicate.id
    assert len(store.jobs) == 1
    assert stage_key("bob", "doc", "structure_chapters") != key
    with pytest.raises(ValueError):
        store.add(Job("third", "structure_chapters", {"user_id": "bob"}, dedupe_key=key))


def document():
    docs = InMemoryDocumentStore()
    doc = docs.create(
        user_id="alice", filename="book.pdf", mime_type="application/pdf", size_bytes=6, source_bytes=b"%PDF-1"
    )
    return docs, doc


def test_parser_crash_preserves_original_then_committed_text_discards_it(monkeypatch):
    docs, doc = document()

    def crash(*args, **kwargs):
        raise RuntimeError("worker killed before parse commit")

    monkeypatch.setattr("app.pipeline.parse_pdf", crash)
    handler = make_parse_handler(docs=docs, enqueue=lambda *args: "next", ocr=None, max_pages=10)
    payload = {"user_id": "alice", "document_id": doc.id}
    with pytest.raises(RuntimeError):
        handler(payload)
    assert docs.read_source_bytes(doc.id, "alice") == b"%PDF-1"
    assert docs.read_source_bytes(doc.id, "bob") is None
    monkeypatch.setattr("app.pipeline.parse_pdf", lambda *a, **kw: ParseResult("# Saved", 1, []))
    assert handler(payload)["next_job_id"] == "next"
    assert docs.read_source_bytes(doc.id, "alice") is None
    # Replaying after the byte clear consumes committed Markdown, without OCR.
    monkeypatch.setattr("app.pipeline.parse_pdf", crash)
    assert handler(payload)["page_count"] == 1


def test_parser_commit_then_handoff_crash_replays_from_saved_text(monkeypatch):
    docs, doc = document()
    calls = []

    def parser(*args, **kwargs):
        calls.append(1)
        return ParseResult("# Saved", 1, [])

    def interrupted_handoff(*args):
        raise RuntimeError("worker killed between output and enqueue")

    monkeypatch.setattr("app.pipeline.parse_pdf", parser)
    payload = {"user_id": "alice", "document_id": doc.id}
    handler = make_parse_handler(docs=docs, enqueue=interrupted_handoff, ocr=None, max_pages=10)
    with pytest.raises(RuntimeError):
        handler(payload)
    assert doc.markdown == "# Saved" and docs.read_source_bytes(doc.id, "alice") is None
    resumed = make_parse_handler(docs=docs, enqueue=lambda *args: "successor", ocr=None, max_pages=10)
    assert resumed(payload)["next_job_id"] == "successor"
    assert calls == [1]


def test_missing_original_is_a_permanent_reupload_error():
    from app.jobs.worker import PermanentJobError

    docs, doc = document()
    docs.take_source_bytes(doc.id)
    handler = make_parse_handler(
        docs=docs, enqueue=lambda *args: pytest.fail("missing file enqueued"), ocr=None, max_pages=10
    )
    with pytest.raises(PermanentJobError, match="re-upload"):
        handler({"user_id": "alice", "document_id": doc.id})
    assert doc.status == "failed"


def test_structure_replay_preserves_committed_ids_and_enqueues_once(monkeypatch):
    from app.ai.outline import Outline

    docs, doc = document()
    docs.mark_parsed(doc.id, markdown="<!-- page:1 -->\n# Chapter\nmaterial", page_count=1)
    jobs = InMemoryJobStore()
    calls = []

    def outline(*args):
        calls.append(1)
        return [Outline(title="Chapter", start_page=1, end_page=1)], "heuristic"

    def enqueue(kind, payload):
        return jobs.add(Job(str(len(calls)), kind, payload, dedupe_key=payload["stage_key"])).id

    handler = make_structure_handler(
        docs=docs, outline_fn=outline, chunk_max_chars=100, chunk_overlap_chars=10, enqueue=enqueue
    )
    payload = {"user_id": "alice", "document_id": doc.id}
    first = handler(payload)
    chapters, chunks = copy.deepcopy(doc.chapters), copy.deepcopy(doc.chunks)
    second = handler(payload)
    assert first["next_job_id"] == second["next_job_id"]
    assert doc.chapters == chapters and doc.chunks == chunks
    assert calls == [1] and len(jobs.jobs) == 1


def test_cancel_during_parser_prevents_document_publication(monkeypatch):
    docs, doc = document()
    jobs = InMemoryJobStore()
    jobs.add(Job("job", "parse_pdf", {"user_id": "alice", "document_id": doc.id}, run_after=NOW))

    def cancelled_parse(*args, **kwargs):
        jobs.request_cancel("job", "alice")
        return ParseResult("unpublished", 1, [])

    monkeypatch.setattr("app.pipeline.parse_pdf", cancelled_parse)
    handler = make_parse_handler(
        docs=docs, enqueue=lambda *args: pytest.fail("cancelled stage enqueued"), ocr=None, max_pages=10
    )
    Worker(jobs, {"parse_pdf": handler}).process_one(NOW)
    assert doc.markdown is None and jobs.jobs["job"].status == "cancelled"


def test_pg_parse_commit_uses_one_transaction_for_output_bytes_and_successor():
    store = PgJobStore.__new__(PgJobStore)
    store._table, store._lock, store._conn = "jobs", threading.RLock(), MagicMock()
    cur = store._conn.cursor.return_value.__enter__.return_value
    cur.fetchone.side_effect = [("job",), ("successor",)]
    cur.rowcount = 1
    job = Job("job", "parse_pdf", {"user_id": "alice", "document_id": "doc"}, lease_token="token")
    token = current_claim.set(Claim(store, job, lambda: NOW))
    try:
        result = store.commit_parse_stage(
            document_id="doc", user_id="alice", markdown="saved", page_count=1, unreadable_pages=[]
        )
    finally:
        current_claim.reset(token)
    statements = [call.args[0] for call in cur.execute.call_args_list]
    assert store._conn.transaction.call_count == 1
    assert "FOR UPDATE" in statements[0] and "lease_token=%s" in statements[0]
    assert "source_bytes=NULL" in statements[1] and "AND user_id=%s" in statements[1]
    assert "ON CONFLICT" in statements[2] and "RETURNING id" in statements[2]
    assert "status='done'" in statements[3]
    assert result["next_job_id"] == "successor"


def test_pg_cancelled_parse_rolls_back_without_touching_output():
    store = PgJobStore.__new__(PgJobStore)
    store._table, store._lock, store._conn = "jobs", threading.RLock(), MagicMock()
    cur = store._conn.cursor.return_value.__enter__.return_value
    cur.fetchone.return_value = None
    job = Job("job", "parse_pdf", {"user_id": "alice", "document_id": "doc"}, lease_token="token")
    token = current_claim.set(Claim(store, job, lambda: NOW))
    try:
        with pytest.raises(LeaseLost):
            store.commit_parse_stage(
                document_id="doc", user_id="alice", markdown="saved", page_count=1, unreadable_pages=[]
            )
    finally:
        current_claim.reset(token)
    assert cur.execute.call_count == 1
