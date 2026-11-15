"""Postgres-backed job system (task 1.14). Schema in docs/schema.md `jobs`.

The worker loop is storage-agnostic: `JobStore` is a Protocol so unit tests run
against an in-memory store; a Postgres implementation plugs in without changes.
"""

import logging
import threading
import traceback
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

logger = logging.getLogger("studyvault.jobs")

# A handler may return a JSON-serialisable result (exposed as Job.result).
Handler = Callable[[dict[str, Any]], dict[str, Any] | None]


class PermanentJobError(Exception):
    """Raise from a handler when retrying cannot help (e.g. encrypted PDF)."""


@dataclass
class Job:
    id: str
    kind: str
    payload: dict[str, Any]
    status: str = "pending"  # pending|running|done|failed
    attempts: int = 0
    max_attempts: int = 3
    error_reason: str | None = None
    result: dict[str, Any] | None = None
    run_after: datetime = field(default_factory=lambda: datetime.now(UTC))


class JobStore(Protocol):
    def claim_next(self, now: datetime) -> Job | None: ...
    def mark_done(self, job_id: str, result: dict[str, Any] | None = None) -> None: ...
    def mark_running(self, job_id: str) -> None: ...
    def mark_retry(self, job_id: str, run_after: datetime) -> None: ...
    def mark_failed(self, job_id: str, reason: str) -> None: ...


class InMemoryJobStore:
    """Thread-safe: request handlers add jobs while the worker thread claims them."""

    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def add(self, job: Job) -> Job:
        with self._lock:
            self.jobs[job.id] = job
        return job

    def claim_next(self, now: datetime) -> Job | None:
        # Claim atomically (pending -> running) so two workers never take the same job.
        with self._lock:
            for job in self.jobs.values():
                if job.status == "pending" and job.run_after <= now:
                    job.status = "running"
                    return job
        return None

    def mark_running(self, job_id: str) -> None:
        self.jobs[job_id].status = "running"

    def mark_done(self, job_id: str, result: dict[str, Any] | None = None) -> None:
        job = self.jobs[job_id]
        job.status = "done"
        job.result = result

    def mark_retry(self, job_id: str, run_after: datetime) -> None:
        job = self.jobs[job_id]
        job.status = "pending"
        job.run_after = run_after

    def mark_failed(self, job_id: str, reason: str) -> None:
        job = self.jobs[job_id]
        job.status = "failed"
        job.error_reason = reason

    def get(self, job_id: str, user_id: str) -> Job | None:
        job = self.jobs.get(job_id)
        return job if job is not None and job.payload.get("user_id") == user_id else None


class Worker:
    def __init__(self, store: JobStore, handlers: dict[str, Handler], backoff_seconds: float = 5.0) -> None:
        self.store = store
        self.handlers = handlers
        self.backoff_seconds = backoff_seconds

    def process_one(self, now: datetime | None = None) -> bool:
        """Claim and process at most one job. Returns True if a job was processed."""
        now = now or datetime.now(UTC)
        job = self.store.claim_next(now)
        if job is None:
            return False
        self.store.mark_running(job.id)
        job.attempts += 1
        handler = self.handlers.get(job.kind)
        if handler is None:
            self.store.mark_failed(job.id, f"no handler for kind {job.kind!r}")
            return True
        try:
            result = handler(job.payload)
        except PermanentJobError as exc:
            logger.warning("job %s failed permanently: %s", job.id, exc)
            self.store.mark_failed(job.id, str(exc))
        except Exception as exc:  # noqa: BLE001 - job boundary; error is recorded, not silent
            reason = f"{type(exc).__name__}: {exc}"
            logger.warning("job %s attempt %d failed: %s\n%s", job.id, job.attempts, reason, traceback.format_exc())
            if job.attempts >= job.max_attempts:
                self.store.mark_failed(job.id, reason)
            else:
                self.store.mark_retry(job.id, now + timedelta(seconds=self.backoff_seconds * job.attempts))
        else:
            self.store.mark_done(job.id, result)
        return True
