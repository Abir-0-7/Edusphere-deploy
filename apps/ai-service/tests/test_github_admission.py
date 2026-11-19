"""Hourly GitHub import admission is atomic, private and fail-closed."""

import hashlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta, timezone

import httpx
import pytest

from app.errors import ApiError, RateLimited
from app.source_versions.github_admission import (
    GithubImportSlots,
    MemoryGithubImportLimiter,
    UpstashGithubImportLimiter,
)

NOW = datetime(2026, 11, 19, 12, 30, 0, 500000, tzinfo=UTC)


def test_memory_checks_both_limits_before_debiting_either_and_hides_owner():
    limiter = MemoryGithubImportLimiter(1, 2)
    limiter.check("private-alice", NOW)
    with pytest.raises(RateLimited) as error:
        limiter.check("private-alice", NOW)
    assert error.value.details == {"reason": "github_import_hourly_limit", "retryAfterSeconds": 1800}
    limiter.check("private-bob", NOW)
    with pytest.raises(RateLimited):
        limiter.check("private-charlie", NOW)
    assert limiter._global_count == 2
    assert len(limiter._counts) == 2
    assert "private-alice" not in repr(limiter._counts)


def test_memory_global_and_owner_caps_are_atomic_under_concurrency():
    limiter = MemoryGithubImportLimiter(3, 7)

    def admit(index):
        try:
            limiter.check(f"owner-{index % 4}", NOW)
            return True
        except RateLimited:
            return False

    with ThreadPoolExecutor(max_workers=16) as pool:
        admitted = list(pool.map(admit, range(100)))
    assert sum(admitted) == 7
    assert limiter._global_count == 7
    assert sum(limiter._counts.values()) == 7
    assert max(limiter._counts.values()) <= 3


def test_memory_prunes_expired_accounts_and_stale_timestamp_cannot_reopen_hour():
    limiter = MemoryGithubImportLimiter(1, 2)
    limiter.check("old-owner", NOW)
    next_hour = NOW + timedelta(hours=1)
    limiter.check("new-owner", next_hour)
    assert len(limiter._counts) == 1
    assert hashlib.sha256(b"old-owner").hexdigest() not in limiter._counts
    with pytest.raises(RateLimited):
        limiter.check("old-owner", NOW)
    limiter.check("remaining-owner", next_hour)
    assert limiter._global_count == 2


def test_hourly_reset_is_utc_and_retry_rounds_up_to_one_second():
    limiter = MemoryGithubImportLimiter(1, 1)
    offset = timezone(timedelta(hours=6))
    limiter.check("owner", NOW.astimezone(offset))
    boundary = NOW.replace(minute=59, second=59, microsecond=999999)
    with pytest.raises(RateLimited) as error:
        limiter.check("owner", boundary)
    assert error.value.details["retryAfterSeconds"] == 1
    limiter.check("owner", boundary + timedelta(microseconds=1))


@pytest.mark.parametrize("now", [datetime(2026, 11, 19), "2026-11-19"])
def test_timestamps_must_be_timezone_aware(now):
    with pytest.raises(ValueError, match="timezone"):
        MemoryGithubImportLimiter(1, 1).check("owner", now)
    with pytest.raises(ValueError, match="timezone"):
        UpstashGithubImportLimiter("https://redis.test", "token", 1, 1).check("owner", now)


@pytest.mark.parametrize("value", [0, -1, True, 1.5, 2_147_483_648])
def test_all_limits_reject_unbounded_or_coercible_values(value):
    with pytest.raises(ValueError):
        MemoryGithubImportLimiter(value, 1)
    with pytest.raises(ValueError):
        MemoryGithubImportLimiter(1, value)
    with pytest.raises(ValueError):
        UpstashGithubImportLimiter("https://redis.test", "token", value, 1)
    with pytest.raises(ValueError):
        UpstashGithubImportLimiter("https://redis.test", "token", 1, value)
    with pytest.raises(ValueError):
        GithubImportSlots(value)


def factory_for(handler, options=None):
    def factory(**kwargs):
        if options is not None:
            options.update(kwargs)
        return httpx.Client(transport=httpx.MockTransport(handler), **kwargs)

    return factory


def test_upstash_uses_one_atomic_two_counter_eval_with_private_expiring_keys():
    requests, options = [], {}

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"result": 1})

    limiter = UpstashGithubImportLimiter(
        "https://redis.test/", "test-token", 2, 3, client_factory=factory_for(handler, options),
    )
    limiter.check("private-owner", NOW)
    assert len(requests) == 1
    request = requests[0]
    command = json.loads(request.content)
    assert request.method == "POST" and str(request.url) == "https://redis.test"
    assert request.headers["authorization"] == "Bearer test-token"
    assert request.headers["accept-encoding"] == "identity"
    assert options == {"timeout": 5.0, "trust_env": False, "follow_redirects": False}
    assert command[:1] == ["EVAL"] and command[2] == "2"
    assert command[-3:] == ["2", "3", "1860"]
    user_key, global_key = command[3:5]
    assert user_key != global_key and "private-owner" not in repr(command)
    assert hashlib.sha256(b"private-owner").hexdigest() in user_key
    assert ":{github-import}:" in user_key and ":{github-import}:" in global_key
    script = command[1]
    assert script.index("if user_used >=") < script.index("redis.call('INCR'")
    assert "global_used >= tonumber(ARGV[2])" in script
    assert "counter(KEYS[1])" in script and "counter(KEYS[2])" in script
    assert "redis.call('EXPIRE', KEYS[1], ARGV[3])" in script
    assert "redis.call('EXPIRE', KEYS[2], ARGV[3])" in script


def test_upstash_denial_has_hourly_hint_and_is_not_retried():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"result": 0})

    limiter = UpstashGithubImportLimiter("https://redis.test", "token", 1, 1, client_factory=factory_for(handler))
    with pytest.raises(RateLimited) as error:
        limiter.check("owner", NOW)
    assert error.value.details["retryAfterSeconds"] == 1800
    assert len(requests) == 1


@pytest.mark.parametrize("body", [
    b'{}', b'[]', b'{"error":"denied","result":1}', b'{"result":true}', b'{"result":"1"}',
    b'{"result":1.0}', b'{"result":-1}', b'{"result":42}', b'{"result":0,"result":1}', b'not JSON',
    b'{"result":1,"padding":"' + b'x' * 4096 + b'"}',
    b'[' * 1500 + b'0' + b']' * 1500,
])
def test_upstash_malformed_or_oversized_response_never_admits(body):
    limiter = UpstashGithubImportLimiter(
        "https://redis.test", "private-token", 1, 1,
        client_factory=factory_for(lambda _: httpx.Response(200, content=body)),
    )
    with pytest.raises(ApiError) as error:
        limiter.check("private-owner", NOW)
    assert error.value.status_code == 503
    assert "private" not in error.value.message


@pytest.mark.parametrize("status", [301, 401, 403, 429, 500, 503])
def test_upstash_http_failure_and_redirect_do_not_admit_or_follow(status):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(status, headers={"location": "https://other.test/"}, text="private-token")

    limiter = UpstashGithubImportLimiter("https://redis.test", "private-token", 1, 1,
                                        client_factory=factory_for(handler))
    with pytest.raises(ApiError) as error:
        limiter.check("private-owner", NOW)
    assert error.value.status_code == 503 and len(requests) == 1
    assert "private-token" not in error.value.message


def test_upstash_transport_outage_is_a_sanitized_503(caplog):
    def handler(request):
        raise httpx.ConnectTimeout("private-token private-owner", request=request)

    limiter = UpstashGithubImportLimiter("https://redis.test", "private-token", 1, 1,
                                        client_factory=factory_for(handler))
    with pytest.raises(ApiError) as error:
        limiter.check("private-owner", NOW)
    assert error.value.status_code == 503
    assert "private" not in error.value.message and "private" not in caplog.text


def test_upstash_rejects_encoded_responses_before_decoding():
    def handler(_):
        return httpx.Response(200, headers={"content-encoding": "br"}, stream=httpx.ByteStream(b"compressed"))

    limiter = UpstashGithubImportLimiter("https://redis.test", "token", 1, 1, client_factory=factory_for(handler))
    with pytest.raises(ApiError) as error:
        limiter.check("owner", NOW)
    assert error.value.status_code == 503


@pytest.mark.parametrize("user_id", ["", "   ", None])
def test_missing_owner_cannot_start_rate_limit_network_work(user_id):
    def no_request(_):
        pytest.fail("an anonymous import must not contact Redis")

    with pytest.raises(ValueError, match="authenticated"):
        MemoryGithubImportLimiter(1, 1).check(user_id, NOW)
    limiter = UpstashGithubImportLimiter("https://redis.test", "token", 1, 1, client_factory=factory_for(no_request))
    with pytest.raises(ValueError, match="authenticated"):
        limiter.check(user_id, NOW)


def test_slots_are_nonblocking_nested_and_released_after_success_or_exception():
    slots = GithubImportSlots(2)
    with slots.acquire(), slots.acquire():
        with pytest.raises(RateLimited) as error, slots.acquire():
            pytest.fail("busy work must never run")
        assert error.value.details == {"reason": "github_import_busy", "retryAfterSeconds": 1}
    with pytest.raises(RuntimeError), slots.acquire():
        raise RuntimeError("failed import")
    with slots.acquire(), slots.acquire():
        pass


def test_slots_cannot_exceed_process_bound_under_concurrency():
    slots = GithubImportSlots(2)
    occupied = threading.Barrier(3)
    release = threading.Event()

    def hold():
        with slots.acquire():
            occupied.wait(timeout=5)
            assert release.wait(timeout=5)

    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = [pool.submit(hold), pool.submit(hold)]
        try:
            occupied.wait(timeout=5)
            with pytest.raises(RateLimited), slots.acquire():
                pytest.fail("third concurrent importer must not start")
        finally:
            release.set()
        for result in pending:
            result.result(timeout=5)
    with slots.acquire(), slots.acquire():
        pass
