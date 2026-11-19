"""Provider retries and cached results cannot bypass or double-debit admission."""

from datetime import UTC, datetime

import httpx
import pytest
import respx

from app.errors import ApiError, InvalidInput, RateLimited
from app.llm.admission import AdmissionGuard, MemoryDailyQuota, MemoryMinuteLimiter, ai_scope
from app.llm.router import AllProvidersFailed, LLMRouter, Provider

MSGS = [{"role": "user", "content": "hello"}]
BODY = {"choices": [{"message": {"content": "hello"}}]}


def make_router(limit=1, **kwargs):
    guard = AdmissionGuard(MemoryDailyQuota(), MemoryMinuteLimiter(100), limit)
    router = LLMRouter(
        [Provider("primary", "https://a.test/v1", "a", None), Provider("fallback", "https://b.test/v1", "b", None)],
        admission=guard,
        max_retries=1,
        sleep=lambda _: None,
        **kwargs,
    )
    return router


@respx.mock
def test_one_debit_covers_retries_and_fallback_then_next_call_is_denied():
    primary = respx.post("https://a.test/v1/chat/completions").mock(return_value=httpx.Response(503))
    fallback = respx.post("https://b.test/v1/chat/completions").mock(return_value=httpx.Response(200, json=BODY))
    router = make_router()
    with ai_scope("alice"):
        assert router.complete(MSGS) == "hello"
        with pytest.raises(RateLimited):
            router.complete(MSGS)
    assert primary.call_count == 2 and fallback.call_count == 1
    import json

    assert json.loads(fallback.calls[0].request.content)["max_tokens"] == 4096


@respx.mock
def test_attempted_provider_failure_is_not_refunded():
    respx.post("https://a.test/v1/chat/completions").mock(return_value=httpx.Response(503))
    respx.post("https://b.test/v1/chat/completions").mock(return_value=httpx.Response(503))
    router = make_router()
    with ai_scope("alice"):
        with pytest.raises(AllProvidersFailed):
            router.complete(MSGS)
        with pytest.raises(RateLimited):
            router.complete(MSGS)


@respx.mock
def test_total_attempt_cap_bounds_long_fallback_chains():
    primary = respx.post("https://a.test/v1/chat/completions").mock(return_value=httpx.Response(503))
    fallback = respx.post("https://b.test/v1/chat/completions").mock(return_value=httpx.Response(503))
    router = make_router(max_provider_attempts=3)
    with ai_scope("alice"), pytest.raises(AllProvidersFailed):
        router.complete(MSGS)
    assert primary.call_count + fallback.call_count == 3


@respx.mock
def test_cache_hits_are_free_and_owner_scoped_but_missing_owner_denied():
    class Cache:
        def __init__(self):
            self.values = {}

        def get(self, key):
            return self.values.get(key)

        def put(self, key, value):
            self.values[key] = value

    primary = respx.post("https://a.test/v1/chat/completions").mock(return_value=httpx.Response(200, json=BODY))
    router = make_router(cache=Cache())
    with ai_scope("alice"):
        assert router.complete(MSGS) == router.complete(MSGS) == "hello"
    with ai_scope("bob"):
        assert router.complete(MSGS) == "hello"
    with pytest.raises(ApiError):
        router.complete(MSGS)
    assert primary.call_count == 2


def test_no_configured_provider_does_not_debit():
    router = make_router()
    for provider in router.providers:
        provider.base_url = ""
    with ai_scope("alice"):
        with pytest.raises(AllProvidersFailed):
            router.complete(MSGS)
        assert router.admission.daily_store.reserve("alice", 1, datetime.now(UTC))


@respx.mock
def test_context_limit_rejects_before_debit_or_provider_request():
    router = make_router(max_input_chars=4)
    with ai_scope("alice"):
        with pytest.raises(InvalidInput):
            router.complete(MSGS)
        assert router.admission.daily_store.reserve("alice", 1, datetime.now(UTC))
    assert len(respx.calls) == 0
