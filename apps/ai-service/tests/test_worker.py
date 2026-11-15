from datetime import UTC, datetime

from app.jobs.worker import InMemoryJobStore, Job, Worker


def test_dummy_job_runs_to_done() -> None:
    store = InMemoryJobStore()
    ran: list[dict] = []
    worker = Worker(store, {"noop": ran.append})
    store.add(Job(id="j1", kind="noop", payload={"x": 1}))
    assert worker.process_one(now=datetime.now(UTC)) is True
    assert store.jobs["j1"].status == "done"
    assert ran == [{"x": 1}]
    # nothing left to do
    assert worker.process_one() is False


def test_failing_job_retries_then_fails() -> None:
    store = InMemoryJobStore()
    calls: list[int] = []

    def flaky(payload: dict) -> None:
        calls.append(1)
        raise ValueError("boom")

    worker = Worker(store, {"flaky": flaky}, backoff_seconds=10)
    store.add(Job(id="j2", kind="flaky", payload={}, max_attempts=3))
    now = datetime.now(UTC)
    worker.process_one(now)  # attempt 1 -> retry
    assert store.jobs["j2"].status == "pending"
    assert store.jobs["j2"].attempts == 1
    assert store.jobs["j2"].run_after > now
    store.jobs["j2"].run_after = now  # simulate backoff elapsed
    worker.process_one(now)
    store.jobs["j2"].run_after = now
    worker.process_one(now)  # attempt 3 == max -> failed
    assert store.jobs["j2"].status == "failed"
    assert "boom" in (store.jobs["j2"].error_reason or "")
    assert len(calls) == 3


def test_unknown_kind_fails_immediately() -> None:
    store = InMemoryJobStore()
    worker = Worker(store, {})
    store.add(Job(id="j3", kind="ghost", payload={}))
    worker.process_one()
    assert store.jobs["j3"].status == "failed"


def test_handler_result_is_stored() -> None:
    store = InMemoryJobStore()
    worker = Worker(store, {"calc": lambda payload: {"answer": payload["n"] * 2}})
    store.add(Job(id="j4", kind="calc", payload={"n": 21}))
    worker.process_one()
    assert store.jobs["j4"].status == "done"
    assert store.jobs["j4"].result == {"answer": 42}


def test_permanent_error_fails_without_retry() -> None:
    from app.jobs.worker import PermanentJobError

    store = InMemoryJobStore()
    calls: list[int] = []

    def bad_input(payload: dict) -> None:
        calls.append(1)
        raise PermanentJobError("encrypted PDF")

    worker = Worker(store, {"bad": bad_input})
    store.add(Job(id="j5", kind="bad", payload={}, max_attempts=3))
    worker.process_one()
    assert store.jobs["j5"].status == "failed"
    assert store.jobs["j5"].error_reason == "encrypted PDF"
    assert calls == [1]
