"""Atomic limits, owner isolation, durable SQL and fail-closed admission."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx

from app.errors import ApiError, NotFound, RateLimited
from app.llm.admission import (
    AdmissionGuard,
    MemoryDailyQuota,
    MemoryMinuteLimiter,
    PgDailyQuota,
    UpstashMinuteLimiter,
    ai_scope,
    current_ai_owner,
)

NOW = datetime(2026, 11, 17, 12, 0, 30, tzinfo=UTC)


def test_concurrent_debits_stop_at_limit_and_are_per_owner():
    store = MemoryDailyQuota()
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda _: store.reserve("alice", 7, NOW), range(100)))
    assert sum(results) == 7
    assert store.reserve("bob", 7, NOW)
    assert store.reserve("alice", 7, NOW + timedelta(days=1))
    assert not store.reserve("alice", 7, NOW)  # old request cannot roll the day back


def test_fixed_minute_limit_rolls_over_and_does_not_leak_owners():
    limiter = MemoryMinuteLimiter(2)
    limiter.check("alice", NOW)
    limiter.check("alice", NOW)
    with pytest.raises(RateLimited) as error:
        limiter.check("alice", NOW)
    assert error.value.details["retryAfterSeconds"] == 30
    limiter.check("bob", NOW)
    limiter.check("alice", NOW + timedelta(minutes=1))


def test_scope_resets_and_to_thread_inherits_owner():
    async def check():
        with ai_scope("alice"):
            assert await asyncio.to_thread(current_ai_owner) == "alice"
            with ai_scope("bob"):
                assert current_ai_owner() == "bob"
            assert current_ai_owner() == "alice"
        assert current_ai_owner() is None

    asyncio.run(check())


def test_guard_denies_missing_owner_and_quota_unavailability():
    class Broken:
        def reserve(self, *args, **kwargs):
            raise ConnectionError("unavailable")

    guard = AdmissionGuard(Broken(), MemoryMinuteLimiter(100), 1, clock=lambda: NOW)
    with pytest.raises(ApiError) as error:
        guard.admit()
    assert error.value.status_code == 503
    with ai_scope("alice"), pytest.raises(ApiError) as error:
        guard.admit()
    assert error.value.status_code == 503


def test_daily_denial_reports_utc_retry_and_context_does_not_escape():
    guard = AdmissionGuard(MemoryDailyQuota(), MemoryMinuteLimiter(100), 1, clock=lambda: NOW)
    with ai_scope("alice"):
        guard.admit()
        with pytest.raises(RateLimited) as error:
            guard.admit()
        assert error.value.details == {"reason": "daily_quota", "retryAfterSeconds": 43170}
    assert current_ai_owner() is None


@respx.mock
def test_upstash_uses_one_atomic_rate_limit_command_and_hides_owner():
    endpoint = respx.post("https://redis.test").mock(return_value=httpx.Response(200, json={"result": 1}))
    limiter = UpstashMinuteLimiter("https://redis.test", "test-token", 2)
    limiter.check("private-owner", NOW)
    import json

    command = json.loads(endpoint.calls[0].request.content)
    assert command[0] == "EVAL" and command[2] == "1"
    assert "private-owner" not in command[3]
    assert command[-2:] == ["2", "30"]
    endpoint.mock(return_value=httpx.Response(200, json={"result": 0}))
    with pytest.raises(RateLimited):
        limiter.check("private-owner", NOW)


@respx.mock
@pytest.mark.parametrize("payload", [{"error": "denied"}, {}, {"result": True}, {"result": 12}])
def test_invalid_rate_backend_response_cannot_admit(payload):
    respx.post("https://redis.test").mock(return_value=httpx.Response(200, json=payload))
    guard = AdmissionGuard(MemoryDailyQuota(), UpstashMinuteLimiter("https://redis.test", "token", 2), 10)
    with ai_scope("alice"), pytest.raises(ApiError) as error:
        guard.admit()
    assert error.value.status_code == 503


def test_postgres_conditional_update_is_single_atomic_debit():
    queries = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def execute(self, sql, params):
            queries.append((sql, params))

        def fetchone(self):
            return (1,)

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def cursor(self):
            return Cursor()

    store = PgDailyQuota("unused", connection_factory=lambda *args, **kwargs: Connection())
    assert store.reserve("alice", 3, NOW)
    assert len(queries) == 1
    sql, params = queries[0]
    assert "daily_ai_quota_used < %s" in sql and "RETURNING" in sql
    assert params == ("2026-11-17", "2026-11-17", "alice", "2026-11-17", "2026-11-17", 3)


def test_missing_pg_user_cannot_be_created_by_admission():
    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def execute(self, *args):
            pass

        def fetchone(self):
            return None

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def cursor(self):
            return Cursor()

    with pytest.raises(NotFound):
        PgDailyQuota("unused", lambda *args, **kwargs: Connection()).reserve("missing", 3, NOW)
