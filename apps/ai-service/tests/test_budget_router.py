"""Router integration for token holds, settlement and capacity release."""

import httpx
import pytest
import respx

from app.errors import RateLimited
from app.llm.admission import AdmissionGuard, MemoryDailyQuota, MemoryMinuteLimiter, ai_scope
from app.llm.budgets import BudgetLimits, MemoryBudgetStore
from app.llm.cache_scope import response_scope
from app.llm.router import AllProvidersFailed, LLMRouter, Provider


def make_limits(**changes):
    values = {
        "user_daily_tokens": 100_000,
        "global_daily_tokens": 1_000_000,
        "feature_daily_tokens": 100_000,
        "user_active": 2,
        "global_active": 5,
        "lease_seconds": 60,
    }
    return BudgetLimits(**(values | changes))


def make_router(store, **changes):
    return LLMRouter(
        [Provider("primary", "https://p.test/v1", "model", None)],
        max_retries=0,
        max_provider_attempts=1,
        max_output_tokens=10,
        budget_store=store,
        budget_limits=make_limits(**changes),
    )


class TinyCache:
    def __init__(self):
        self.entries = {}

    def get(self, key):
        return self.entries.get(key)

    def put(self, key, value):
        self.entries[key] = value


@respx.mock
def test_success_settles_known_usage_and_frees_slot():
    route = respx.post("https://p.test/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={"choices": [{"message": {"content": "ok"}}], "usage": {"prompt_tokens": 5, "completion_tokens": 3}},
        )
    )
    store = MemoryBudgetStore()
    router = make_router(store)

    with ai_scope("alice"), response_scope("chat"):
        assert router.complete([{"role": "user", "content": "hi"}]) == "ok"

    row = next(iter(store.rows.values()))
    assert route.call_count == 1
    assert row.state == "settled" and row.actual_tokens == 8


@respx.mock
def test_provider_failure_charges_reserved_bound_and_releases_generation_slot():
    route = respx.post("https://p.test/v1/chat/completions").mock(return_value=httpx.Response(503))
    store = MemoryBudgetStore()
    router = make_router(store)

    with ai_scope("alice"), response_scope("chat"), pytest.raises(AllProvidersFailed):
        router.complete([{"role": "user", "content": "hi"}])

    row = next(iter(store.rows.values()))
    assert route.call_count == 1
    assert row.state == "settled" and row.actual_tokens == row.reserved_tokens
    assert row.reserved_tokens >= 20


@respx.mock
def test_daily_admission_denial_releases_unused_budget_reservation():
    route = respx.post("https://p.test/v1/chat/completions")
    quota = MemoryDailyQuota()
    quota.reserve("alice", 1)
    router = make_router(MemoryBudgetStore())
    router.admission = AdmissionGuard(quota, MemoryMinuteLimiter(10), 1)

    with ai_scope("alice"), response_scope("chat"), pytest.raises(RateLimited):
        router.complete([{"role": "user", "content": "hi"}])

    assert route.call_count == 0
    assert next(iter(router.budget_store.rows.values())).state == "released"


@respx.mock
def test_budget_cap_denial_happens_before_provider_request():
    route = respx.post("https://p.test/v1/chat/completions")
    store = MemoryBudgetStore()
    router = make_router(store, feature_daily_tokens=1)

    with ai_scope("alice"), response_scope("chat"), pytest.raises(RateLimited):
        router.complete([{"role": "user", "content": "hi"}])

    assert route.call_count == 0
    assert not store.rows


@respx.mock
def test_cache_hit_does_not_reserve_additional_token_budget():
    route = respx.post("https://p.test/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={"choices": [{"message": {"content": "ok"}}], "usage": {"prompt_tokens": 5, "completion_tokens": 3}},
        )
    )
    store = MemoryBudgetStore()
    router = make_router(store)
    router.cache = TinyCache()

    with ai_scope("alice"), response_scope("chat"):
        assert router.complete([{"role": "user", "content": "hi"}]) == "ok"
        assert router.complete([{"role": "user", "content": "hi"}]) == "ok"

    assert route.call_count == 1
    assert len(store.rows) == 1
