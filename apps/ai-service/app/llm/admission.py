"""Atomic per-user admission immediately before a logical LLM provider call.

The existing users counter is conservatively debited before any provider request.
An attempted failure is not refunded: retries/fallbacks share that one debit.
Durable operation deduplication and token-level accounting are separate work.
"""

import hashlib
import logging
import math
import re
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

import httpx

from app.errors import ApiError, NotFound, RateLimited

logger = logging.getLogger("studyvault.llm.admission")
_owner: ContextVar[str | None] = ContextVar("ai_owner", default=None)


@contextmanager
def ai_scope(user_id: str | None) -> Iterator[None]:
    """Bind a trusted internal owner for one authenticated request/job execution."""
    token = _owner.set(user_id)
    try:
        yield
    finally:
        _owner.reset(token)


def current_ai_owner() -> str | None:
    return _owner.get()


def _utc_now(now: datetime | None = None) -> datetime:
    value = now or datetime.now(UTC)
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("quota timestamps must include a timezone")
    return value.astimezone(UTC)


def _positive_limit(limit: int) -> None:
    if type(limit) is not int or limit <= 0:
        raise ValueError("quota limit must be a positive integer")


def _minute_retry(now: datetime) -> int:
    return max(1, math.ceil(60 - now.timestamp() % 60))


def _daily_retry(now: datetime) -> int:
    tomorrow = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
    return max(1, math.ceil((tomorrow - now).total_seconds()))


def _minute_denied(now: datetime) -> RateLimited:
    return RateLimited(
        "Too many AI requests; try again shortly",
        {
            "reason": "minute_limit",
            "retryAfterSeconds": _minute_retry(now),
        },
    )


class DailyQuota(Protocol):
    def reserve(self, user_id: str, limit: int, now: datetime | None = None) -> bool: ...


class MinuteLimiter(Protocol):
    def check(self, user_id: str, now: datetime | None = None) -> None: ...


class MemoryDailyQuota:
    """Test/development counter; select only for explicit in-memory mode."""

    def __init__(self) -> None:
        self._counts: dict[str, tuple[date, int]] = {}
        self._lock = threading.Lock()

    def reserve(self, user_id: str, limit: int, now: datetime | None = None) -> bool:
        _positive_limit(limit)
        today = _utc_now(now).date()
        with self._lock:
            stored_day, used = self._counts.get(user_id, (today, 0))
            # An old in-flight call must not roll the counter back after midnight.
            if stored_day > today:
                return False
            if stored_day < today:
                used = 0
            if used >= limit:
                return False
            self._counts[user_id] = (today, used + 1)
            return True


class PgDailyQuota:
    """Debit the existing users counter with one atomic conditional UPDATE.

    Opens a short-lived connection per debit to avoid sharing transaction state
    between request/worker threads. The optional table is for disposable DB tests;
    runtime uses users. No table, schema or account is created by this class.
    """

    def __init__(
        self,
        database_url: str,
        connection_factory: Callable[..., Any] | None = None,
        *,
        table: str = "users",
    ) -> None:
        if re.fullmatch(r"[a-z_][a-z0-9_]*", table) is None:
            raise ValueError("quota table must be a simple lowercase identifier")
        self.database_url = database_url
        self.connection_factory = connection_factory
        self.table = table

    def reserve(self, user_id: str, limit: int, now: datetime | None = None) -> bool:
        _positive_limit(limit)
        today = _utc_now(now).date().isoformat()
        if self.connection_factory is None:
            import psycopg

            connect = psycopg.connect
        else:
            connect = self.connection_factory
        with connect(self.database_url, autocommit=True, connect_timeout=5) as conn, conn.cursor() as cur:
            # No check-then-increment race. PostgreSQL locks/rechecks the row for
            # concurrent updates before evaluating this WHERE clause.
            cur.execute(
                f"UPDATE {self.table} SET daily_ai_quota_used = CASE WHEN quota_reset_date = %s"
                " THEN daily_ai_quota_used + 1 ELSE 1 END, quota_reset_date = %s, updated_at = now()"
                " WHERE id = %s AND (quota_reset_date IS NULL OR quota_reset_date < %s"
                " OR (quota_reset_date = %s AND daily_ai_quota_used < %s))"
                " RETURNING daily_ai_quota_used",
                (today, today, user_id, today, today, limit),
            )
            if cur.fetchone() is not None:
                return True
            cur.execute(f"SELECT id FROM {self.table} WHERE id = %s", (user_id,))
            if cur.fetchone() is None:
                raise NotFound("AI quota owner no longer exists")
            return False


class MemoryMinuteLimiter:
    """Atomic fixed UTC-minute window for explicit in-memory mode only."""

    def __init__(self, limit: int) -> None:
        _positive_limit(limit)
        self.limit = limit
        self._counts: dict[str, tuple[int, int]] = {}
        self._lock = threading.Lock()

    def check(self, user_id: str, now: datetime | None = None) -> None:
        current = _utc_now(now)
        window = int(current.timestamp()) // 60
        with self._lock:
            stored_window, used = self._counts.get(user_id, (window, 0))
            if stored_window > window:
                raise _minute_denied(current)
            if stored_window < window:
                used = 0
            if used >= self.limit:
                raise _minute_denied(current)
            self._counts[user_id] = (window, used + 1)


_MINUTE_SCRIPT = """
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used >= tonumber(ARGV[1]) then return 0 end
local next = redis.call('INCR', KEYS[1])
if next == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return 1
""".strip()


class UpstashMinuteLimiter:
    """One atomic Redis EVAL command per admitted logical-call attempt."""

    def __init__(
        self,
        url: str,
        token: str,
        limit: int,
        client_factory: Callable[..., Any] = httpx.Client,
    ) -> None:
        _positive_limit(limit)
        if not url or not token:
            raise ValueError("Upstash rate-limit URL and token are required")
        self.url = url.rstrip("/")
        self.token = token
        self.limit = limit
        self.client_factory = client_factory

    def check(self, user_id: str, now: datetime | None = None) -> None:
        current = _utc_now(now)
        window = int(current.timestamp()) // 60
        owner_hash = hashlib.sha256(user_id.encode("utf-8")).hexdigest()
        key = f"rl:ai:service:minute:{owner_hash}:{window}"
        with self.client_factory(timeout=5.0) as client:
            response = client.post(
                self.url,
                headers={"Authorization": f"Bearer {self.token}"},
                json=["EVAL", _MINUTE_SCRIPT, "1", key, str(self.limit), str(_minute_retry(current))],
            )
            response.raise_for_status()
            payload = response.json()
        result = payload.get("result") if isinstance(payload, dict) and "error" not in payload else None
        if type(result) is not int or result not in {0, 1}:
            raise ValueError("invalid rate-limit service response")
        if not result:
            raise _minute_denied(current)


class PgMinuteLimiter:
    """Atomic minute admission using the durable PostgreSQL store."""

    def __init__(self, database_url: str, connection_factory: Callable[..., Any] | None = None) -> None:
        self.database_url = database_url
        self.connection_factory = connection_factory

    def check(self, user_id: str, now: datetime | None = None, *, limit: int) -> None:
        _positive_limit(limit)
        current = _utc_now(now)
        minute = datetime.fromtimestamp(int(current.timestamp()) // 60 * 60, tz=UTC)
        if self.connection_factory is None:
            import psycopg

            connect = psycopg.connect
        else:
            connect = self.connection_factory
        with connect(self.database_url, autocommit=True, connect_timeout=5) as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO ai_minute_limits (user_id, window_start, count) "
                "VALUES (%s,%s,1) ON CONFLICT (user_id,window_start) DO UPDATE "
                "SET count=ai_minute_limits.count+1 "
                "WHERE ai_minute_limits.count < %s RETURNING count",
                (user_id, minute, limit),
            )
            if cur.fetchone() is None:
                raise _minute_denied(current)
            # Keep owner/window counters bounded without relying on another service.
            cur.execute("DELETE FROM ai_minute_limits WHERE window_start < %s", (minute - timedelta(days=2),))


class AdmissionGuard:
    """Fail closed on missing ownership or unavailable durable quota services."""

    def __init__(
        self,
        daily_store: DailyQuota,
        minute_limiter: MinuteLimiter,
        daily_limit: int,
        minute_limit: int | None = None,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        _positive_limit(daily_limit)
        self.daily_store = daily_store
        self.minute_limiter = minute_limiter
        self.daily_limit = daily_limit
        self.minute_limit = minute_limit or daily_limit
        self.clock = clock

    def authorize(self) -> str:
        user_id = current_ai_owner()
        if not isinstance(user_id, str) or not user_id.strip():
            raise ApiError("AI request has no authenticated owner", status_code=503)
        return user_id

    def admit(self) -> None:
        user_id = self.authorize()
        now = _utc_now(self.clock())
        try:
            if isinstance(self.minute_limiter, PgMinuteLimiter):
                self.minute_limiter.check(user_id, now=now, limit=self.minute_limit)
            else:
                self.minute_limiter.check(user_id, now=now)
            admitted = self.daily_store.reserve(user_id, self.daily_limit, now=now)
        except (ApiError, NotFound):
            raise
        except Exception as exc:  # noqa: BLE001 - no quota backend failure permits a provider call
            logger.warning("AI admission backend unavailable: %s", type(exc).__name__)
            raise ApiError("AI usage checks are temporarily unavailable; try again later", status_code=503) from exc
        if not admitted:
            raise RateLimited(
                "Daily AI quota reached; resets at midnight UTC",
                {
                    "reason": "daily_quota",
                    "retryAfterSeconds": _daily_retry(now),
                },
            )
