"""Private metadata-only ledger for logical LLM operations and HTTP attempts."""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol


class UsageLedger(Protocol):
    def begin(self, user_id: str, operation_id: str, feature: str, started_at: datetime) -> None: ...

    def record_attempt(
        self,
        user_id: str,
        operation_id: str,
        attempt_no: int,
        provider: str,
        model: str,
        outcome: str,
        prompt_tokens: int,
        completion_tokens: int,
        latency_ms: int,
        created_at: datetime,
    ) -> None: ...

    def finish(self, user_id: str, operation_id: str, outcome: str, cache_hit: bool, finished_at: datetime) -> None: ...


@dataclass
class UsageAttempt:
    attempt_no: int
    provider: str
    model: str
    outcome: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int
    created_at: datetime


@dataclass
class UsageOperation:
    user_id: str
    feature: str
    started_at: datetime
    outcome: str = "pending"
    cache_hit: bool = False
    prompt_tokens: int = 0
    completion_tokens: int = 0
    attempts: dict[int, UsageAttempt] = field(default_factory=dict)
    finished_at: datetime | None = None


def _required(value: str, name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"usage ledger requires {name}")


class MemoryUsageLedger:
    """Explicit in-memory implementation for tests and local memory mode."""

    def __init__(self) -> None:
        self.operations: dict[str, UsageOperation] = {}
        self._lock = threading.RLock()

    def begin(self, user_id: str, operation_id: str, feature: str, started_at: datetime) -> None:
        _required(user_id, "an owner")
        _required(operation_id, "an operation id")
        _required(feature, "a feature")
        with self._lock:
            current = self.operations.get(operation_id)
            if current is not None:
                if (current.user_id, current.feature) != (user_id, feature):
                    raise ValueError("usage operation scope mismatch")
                return
            self.operations[operation_id] = UsageOperation(user_id=user_id, feature=feature, started_at=started_at)

    def record_attempt(
        self,
        user_id: str,
        operation_id: str,
        attempt_no: int,
        provider: str,
        model: str,
        outcome: str,
        prompt_tokens: int,
        completion_tokens: int,
        latency_ms: int,
        created_at: datetime,
    ) -> None:
        _required(user_id, "an owner")
        _required(provider, "a provider")
        _required(model, "a model")
        _required(outcome, "an attempt outcome")
        if attempt_no < 1 or min(prompt_tokens, completion_tokens, latency_ms) < 0:
            raise ValueError("usage attempt counters are invalid")
        attempt = UsageAttempt(
            attempt_no, provider, model, outcome, prompt_tokens, completion_tokens, latency_ms, created_at
        )
        with self._lock:
            operation = self.operations.get(operation_id)
            if operation is None or operation.user_id != user_id:
                raise ValueError("usage operation is unavailable for owner")
            prior = operation.attempts.get(attempt_no)
            if prior is not None:
                if prior != attempt:
                    raise ValueError("usage attempt idempotency conflict")
                return
            if operation.finished_at is not None:
                raise ValueError("usage operation is already finished")
            operation.attempts[attempt_no] = attempt
            operation.prompt_tokens += prompt_tokens
            operation.completion_tokens += completion_tokens

    def finish(self, user_id: str, operation_id: str, outcome: str, cache_hit: bool, finished_at: datetime) -> None:
        _required(user_id, "an owner")
        _required(outcome, "an operation outcome")
        with self._lock:
            operation = self.operations.get(operation_id)
            if operation is None or operation.user_id != user_id:
                raise ValueError("usage operation is unavailable for owner")
            if operation.finished_at is not None:
                return
            operation.outcome = outcome
            operation.cache_hit = cache_hit
            operation.finished_at = finished_at


class PgUsageLedger:
    """Postgres implementation. Connections are short-lived and mutations are owner-scoped."""

    def __init__(self, database_url: str, *, connection_factory: Any | None = None) -> None:
        if not database_url:
            raise ValueError("database_url is required")
        if connection_factory is None:
            from psycopg import connect

            connection_factory = connect
        self.database_url = database_url
        self.connection_factory = connection_factory

    def _connect(self) -> Any:
        return self.connection_factory(self.database_url, autocommit=True, connect_timeout=5)

    def begin(self, user_id: str, operation_id: str, feature: str, started_at: datetime) -> None:
        _required(user_id, "an owner")
        _required(feature, "a feature")
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO ai_usage (operation_id,user_id,feature,outcome,cache_hit,started_at) "
                "VALUES (%s,%s,%s,'pending',false,%s) ON CONFLICT (operation_id) DO NOTHING RETURNING user_id,feature",
                (operation_id, user_id, feature, started_at),
            )
            row = cur.fetchone()
            if row is None:
                cur.execute(
                    "SELECT user_id,feature FROM ai_usage WHERE operation_id=%s AND user_id=%s", (operation_id, user_id)
                )
                row = cur.fetchone()
            if row is None or (str(row[0]), row[1]) != (user_id, feature):
                raise ValueError("usage operation could not be created for owner")

    def record_attempt(
        self,
        user_id: str,
        operation_id: str,
        attempt_no: int,
        provider: str,
        model: str,
        outcome: str,
        prompt_tokens: int,
        completion_tokens: int,
        latency_ms: int,
        created_at: datetime,
    ) -> None:
        _required(user_id, "an owner")
        if attempt_no < 1 or min(prompt_tokens, completion_tokens, latency_ms) < 0:
            raise ValueError("usage attempt counters are invalid")
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute(
                "SELECT user_id,finished_at FROM ai_usage WHERE operation_id=%s AND user_id=%s FOR UPDATE",
                (operation_id, user_id),
            )
            operation = cur.fetchone()
            if operation is None or str(operation[0]) != user_id:
                raise ValueError("usage operation is unavailable for owner")
            if operation[1] is not None:
                cur.execute(
                    "SELECT provider,model,outcome,prompt_tokens,completion_tokens,latency_ms "
                    "FROM ai_usage_attempts WHERE operation_id=%s AND user_id=%s AND attempt_no=%s",
                    (operation_id, user_id, attempt_no),
                )
                existing = cur.fetchone()
                expected = (provider, model, outcome, prompt_tokens, completion_tokens, latency_ms)
                if existing is None or tuple(existing) != expected:
                    raise ValueError("usage operation is already finished")
                return
            cur.execute(
                "INSERT INTO ai_usage_attempts "
                "(id,operation_id,user_id,attempt_no,provider,model,outcome,"
                "prompt_tokens,completion_tokens,latency_ms,created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT (operation_id,attempt_no) DO NOTHING RETURNING id",
                (
                    str(uuid.uuid4()),
                    operation_id,
                    user_id,
                    attempt_no,
                    provider,
                    model,
                    outcome,
                    prompt_tokens,
                    completion_tokens,
                    latency_ms,
                    created_at,
                ),
            )
            inserted = cur.fetchone()
            if inserted is not None:
                cur.execute(
                    "UPDATE ai_usage SET provider_attempts=provider_attempts+1, "
                    "prompt_tokens=prompt_tokens+%s, completion_tokens=completion_tokens+%s "
                    "WHERE operation_id=%s AND user_id=%s",
                    (prompt_tokens, completion_tokens, operation_id, user_id),
                )
                return
            cur.execute(
                "SELECT provider,model,outcome,prompt_tokens,completion_tokens,latency_ms "
                "FROM ai_usage_attempts WHERE operation_id=%s AND user_id=%s AND attempt_no=%s",
                (operation_id, user_id, attempt_no),
            )
            if tuple(cur.fetchone() or ()) != (provider, model, outcome, prompt_tokens, completion_tokens, latency_ms):
                raise ValueError("usage attempt idempotency conflict")

    def finish(self, user_id: str, operation_id: str, outcome: str, cache_hit: bool, finished_at: datetime) -> None:
        _required(user_id, "an owner")
        _required(outcome, "an operation outcome")
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE ai_usage SET outcome=%s,cache_hit=%s,finished_at=%s "
                "WHERE operation_id=%s AND user_id=%s AND finished_at IS NULL",
                (outcome, cache_hit, finished_at, operation_id, user_id),
            )
            if cur.rowcount == 0:
                cur.execute("SELECT 1 FROM ai_usage WHERE operation_id=%s AND user_id=%s", (operation_id, user_id))
                if cur.fetchone() is None:
                    raise ValueError("usage operation is unavailable for owner")


def utc_now() -> datetime:
    return datetime.now(UTC)
