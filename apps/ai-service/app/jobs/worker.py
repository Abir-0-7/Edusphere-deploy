"""Postgres-backed job system (task 1.14). Schema in docs/schema.md `jobs`.

The worker loop is storage-agnostic: `JobStore` is a Protocol so unit tests run
against an in-memory store; a Postgres implementation plugs in without changes.
"""

import copy
import hashlib
import logging
import threading
import time
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager, contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from app.errors import RateLimited
from app.llm.admission import ai_scope
from app.llm.operations import operation_scope

logger = logging.getLogger("studyvault.jobs")

# A handler may return a JSON-serialisable result (exposed as Job.result).
Handler = Callable[[dict[str, Any]], dict[str, Any] | None]


class PermanentJobError(Exception):
    """Raise from a handler when retrying cannot help (e.g. encrypted PDF)."""


class LeaseLost(Exception):
    """An expired/cancelled worker may no longer publish results."""


@dataclass
class Job:
    id: str
    kind: str
    payload: dict[str, Any]
    status: str = "pending"  # pending|running|done|failed|cancelled
    attempts: int = 0
    max_attempts: int = 3
    error_reason: str | None = None
    result: dict[str, Any] | None = None
    run_after: datetime = field(default_factory=lambda: datetime.now(UTC))
    lease_token: str | None = None
    lease_expires_at: datetime | None = None
    heartbeat_at: datetime | None = None
    cancel_requested: bool = False
    dedupe_key: str | None = None


class JobStore(Protocol):
    lease_seconds: float

    def claim_next(self, now: datetime) -> Job | None: ...
    def mark_done(self, job_id: str, result: dict[str, Any] | None = None, **kwargs: Any) -> bool: ...
    def mark_running(self, job_id: str) -> None: ...
    def mark_retry(self, job_id: str, run_after: datetime, **kwargs: Any) -> bool: ...
    def mark_failed(self, job_id: str, reason: str, **kwargs: Any) -> bool: ...
    def heartbeat(self, job_id: str, lease_token: str, now: datetime) -> bool: ...
    def is_current(self, job_id: str, lease_token: str, now: datetime) -> bool: ...
    def publication(self, job_id: str, lease_token: str, now: datetime) -> AbstractContextManager[None]: ...
    def save_flashcard_checkpoint(self, job_id: str, user_id: str, checkpoint: dict[str, Any]) -> bool: ...
    def request_cancel(self, job_id: str, user_id: str) -> bool: ...


@dataclass
class Claim:
    store: JobStore
    job: Job
    clock: Callable[[], datetime]

    def check(self) -> None:
        if not self.job.lease_token or not self.store.is_current(self.job.id, self.job.lease_token, self.clock()):
            raise LeaseLost("Job lease expired, was cancelled, or belongs to another worker")


current_claim: ContextVar[Claim | None] = ContextVar("job_claim", default=None)


def check_claim() -> None:
    claim = current_claim.get()
    if claim is not None:
        claim.check()


@contextmanager
def publishing():
    """Hold the current lease row while a handler publishes effects."""
    claim = current_claim.get()
    if claim is None:
        yield
    else:
        with claim.store.publication(claim.job.id, claim.job.lease_token, claim.clock()):
            yield


def stage_key(user_id: str, document_id: str, kind: str) -> str:
    """Immutable document imports have one private consumer per pipeline stage."""
    return hashlib.sha256(f"{user_id}:{document_id}:{kind}:v1".encode()).hexdigest()


class InMemoryJobStore:
    """Thread-safe: request handlers add jobs while the worker thread claims them."""

    def __init__(self, *, lease_seconds: float = 60) -> None:
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        self.lease_seconds = lease_seconds
        self.jobs: dict[str, Job] = {}
        self._lock = threading.RLock()

    def add(self, job: Job) -> Job:
        with self._lock:
            if job.id in self.jobs:
                existing = self.jobs[job.id]
                if existing.kind != job.kind or existing.payload.get("user_id") != job.payload.get("user_id"):
                    raise ValueError("job id belongs to another owner or kind")
                return copy.deepcopy(existing)
            if job.dedupe_key:
                for existing in self.jobs.values():
                    if existing.kind == job.kind and existing.dedupe_key == job.dedupe_key:
                        if existing.payload.get("user_id") != job.payload.get("user_id"):
                            raise ValueError("stage key belongs to another owner")
                        return copy.deepcopy(existing)
            self.jobs.setdefault(job.id, copy.deepcopy(job))
            return copy.deepcopy(self.jobs[job.id])

    def claim_next(self, now: datetime) -> Job | None:
        # Claim atomically (pending -> running) so two workers never take the same job.
        with self._lock:
            for job in sorted(self.jobs.values(), key=lambda item: item.run_after):
                expired = job.status == "running" and job.lease_expires_at is not None and job.lease_expires_at <= now
                if not ((job.status == "pending" and job.run_after <= now) or expired):
                    continue
                if job.cancel_requested or job.attempts >= job.max_attempts:
                    job.status = "cancelled" if job.cancel_requested else "failed"
                    job.error_reason = job.error_reason or "Worker lease expired; retry limit reached"
                    job.lease_token = None
                    continue
                job.status = "running"
                job.attempts += 1
                job.lease_token = str(uuid.uuid4())
                job.heartbeat_at = now
                job.lease_expires_at = now + timedelta(seconds=self.lease_seconds)
                return copy.deepcopy(job)
        return None

    def _owned(self, job: Job, lease_token: str | None, now: datetime | None = None) -> bool:
        if job.status != "running" or job.cancel_requested:
            return False
        if lease_token is None:  # Manual/administrative compatibility; workers always supply their token.
            return True
        return (
            job.lease_token == lease_token
            and job.lease_expires_at is not None
            and job.lease_expires_at > (now or datetime.now(UTC))
        )

    def is_current(self, job_id: str, lease_token: str, now: datetime) -> bool:
        with self._lock:
            job = self.jobs.get(job_id)
            return job is not None and self._owned(job, lease_token, now)

    def heartbeat(self, job_id: str, lease_token: str, now: datetime) -> bool:
        with self._lock:
            job = self.jobs.get(job_id)
            if job is None or not self._owned(job, lease_token, now):
                return False
            job.heartbeat_at = now
            job.lease_expires_at = now + timedelta(seconds=self.lease_seconds)
            return True

    @contextmanager
    def publication(self, job_id: str, lease_token: str, now: datetime):
        with self._lock:
            job = self.jobs.get(job_id)
            if job is None or not self._owned(job, lease_token, now):
                raise LeaseLost("Cannot publish with an expired or cancelled claim")
            yield

    def mark_running(self, job_id: str) -> None:
        with self._lock:
            self.jobs[job_id].status = "running"

    def _finish(self, job_id: str, status: str, lease_token: str | None, now: datetime | None) -> Job | None:
        job = self.jobs.get(job_id)
        if job is None or not self._owned(job, lease_token, now):
            return None
        job.status, job.lease_token, job.lease_expires_at = status, None, None
        return job

    def mark_done(
        self,
        job_id: str,
        result: dict[str, Any] | None = None,
        *,
        lease_token: str | None = None,
        now: datetime | None = None,
    ) -> bool:
        with self._lock:
            job = self._finish(job_id, "done", lease_token, now)
            if job is None:
                return False
            job.result, job.error_reason = result, None
            job.payload.pop("flashcard_checkpoint", None)
            return True

    def save_flashcard_checkpoint(self, job_id: str, user_id: str, checkpoint: dict[str, Any]) -> bool:
        """Only a running flashcard job may save its own private chapter drafts."""
        with self._lock:
            job = self.jobs.get(job_id)
            claim = current_claim.get()
            if (
                job is None
                or job.payload.get("user_id") != user_id
                or job.kind != "generate_flashcards"
                or not self._owned(job, claim.job.lease_token if claim else None, claim.clock() if claim else None)
            ):
                return False
            job.payload["flashcard_checkpoint"] = copy.deepcopy(checkpoint)
            return True

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
        with self._lock:
            job = self._finish(job_id, "pending", lease_token, now)
            if job is None:
                return False
            job.run_after, job.error_reason = run_after, reason
            if refund_attempt:
                job.attempts = max(0, job.attempts - 1)
            return True

    def mark_failed(
        self, job_id: str, reason: str, *, lease_token: str | None = None, now: datetime | None = None
    ) -> bool:
        with self._lock:
            job = self._finish(job_id, "failed", lease_token, now)
            if job is None:
                return False
            job.error_reason = reason
            return True

    def request_cancel(self, job_id: str, user_id: str) -> bool:
        with self._lock:
            job = self.jobs.get(job_id)
            if job is None or job.payload.get("user_id") != user_id or job.status not in {"pending", "running"}:
                return False
            job.cancel_requested = True
            job.status, job.lease_token, job.lease_expires_at = "cancelled", None, None
            return True

    def get(self, job_id: str, user_id: str) -> Job | None:
        with self._lock:
            job = self.jobs.get(job_id)
            return copy.deepcopy(job) if job is not None and job.payload.get("user_id") == user_id else None


class Worker:
    def __init__(
        self,
        store: JobStore,
        handlers: dict[str, Handler],
        backoff_seconds: float = 5.0,
        *,
        heartbeat_seconds: float | None = None,
    ) -> None:
        self.store = store
        self.handlers = handlers
        self.backoff_seconds = backoff_seconds
        self.heartbeat_seconds = heartbeat_seconds or store.lease_seconds / 3
        if not 0 < self.heartbeat_seconds < store.lease_seconds:
            raise ValueError("heartbeat interval must be positive and shorter than the lease")

    def process_one(self, now: datetime | None = None) -> bool:
        """Claim and process at most one job. Returns True if a job was processed."""
        started = time.monotonic()
        now = now or datetime.now(UTC)

        def clock() -> datetime:
            return now + timedelta(seconds=time.monotonic() - started)

        job = self.store.claim_next(now)
        if job is None:
            return False
        claim = Claim(self.store, job, clock)
        stopped = threading.Event()

        def renew() -> None:
            while not stopped.wait(self.heartbeat_seconds):
                try:
                    if not self.store.heartbeat(job.id, job.lease_token, clock()):
                        return
                except Exception:  # noqa: BLE001 - failed renewals are logged; completion remains fenced.
                    logger.exception("job %s lease renewal failed", job.id)
                    return

        heartbeat = threading.Thread(target=renew, daemon=True, name=f"job-lease-{job.id}")
        heartbeat.start()
        token = current_claim.set(claim)
        try:
            handler = self.handlers.get(job.kind)
            if handler is None:
                raise PermanentJobError(f"no handler for kind {job.kind!r}")
            # The trusted queued payload owns AI work after the HTTP request ends.
            with ai_scope(job.payload.get("user_id")), operation_scope(f"job:{job.id}"):
                result = handler(job.payload)
            self.store.mark_done(job.id, result, lease_token=job.lease_token, now=clock())
        except LeaseLost:
            logger.info("job %s stopped after losing its lease or cancellation", job.id)
        except RateLimited as exc:
            details = exc.details if isinstance(exc.details, dict) else {}
            retry = details.get("retryAfterSeconds", 60)
            retry = retry if type(retry) is int and retry > 0 else 60
            self.store.mark_retry(
                job.id,
                now + timedelta(seconds=retry),
                lease_token=job.lease_token,
                now=clock(),
                reason=exc.message,
                refund_attempt=True,
            )
            logger.info("job %s deferred by AI quota for %d seconds", job.id, retry)
        except PermanentJobError as exc:
            logger.warning("job %s failed permanently: %s", job.id, exc)
            self.store.mark_failed(job.id, str(exc), lease_token=job.lease_token, now=clock())
        except Exception as exc:  # noqa: BLE001 - job boundary; error is recorded, not silent
            reason = f"{type(exc).__name__}: {exc}"
            logger.exception("job %s attempt %d failed", job.id, job.attempts)
            if job.attempts >= job.max_attempts:
                self.store.mark_failed(job.id, reason, lease_token=job.lease_token, now=clock())
            else:
                retry_now = clock()
                self.store.mark_retry(
                    job.id,
                    retry_now + timedelta(seconds=self.backoff_seconds * job.attempts),
                    lease_token=job.lease_token,
                    now=retry_now,
                    reason=reason,
                )
        finally:
            current_claim.reset(token)
            stopped.set()
            heartbeat.join(timeout=1)
        return True
