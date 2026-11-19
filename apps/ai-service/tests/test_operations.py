from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx

from app.errors import RateLimited
from app.llm.admission import AdmissionGuard, MemoryDailyQuota, MemoryMinuteLimiter, ai_scope
from app.llm.operations import MemoryOperations, operation_scope
from app.llm.router import AllProvidersFailed, LLMRouter, Provider


def test_concurrent_claims_have_one_effect_and_release_unused_reservation():
    store = MemoryOperations()

    def claim(_):
        try:
            return store.claim("alice", "a" * 64)[0]
        except RateLimited:
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(claim, range(30))) == 1
    store.settle("alice", "a" * 64, None, False)
    assert store.claim("alice", "a" * 64)[0]
    store.settle("alice", "a" * 64, "result", True)
    assert store.claim("alice", "a" * 64) == (False, "result")
    assert store.claim("bob", "a" * 64)[0]


def test_expired_claim_is_uncertain_and_settlement_is_one_effect():
    store = MemoryOperations()
    store.claim("alice", "key")
    store.rows[("alice", "key")]["expires"] = datetime.now(UTC) - timedelta(seconds=1)
    with pytest.raises(RateLimited) as denied:
        store.claim("alice", "key")
    assert denied.value.details["reason"] == "operation_uncertain"
    store.settle("alice", "key", "late result", True)
    assert store.rows[("alice", "key")]["state"] == "uncertain"

    store.claim("alice", "new")
    store.settle("alice", "new", "committed", True)
    store.settle("alice", "new", "overwrite", True)
    assert store.claim("alice", "new") == (False, "committed")


@respx.mock
def test_retry_of_same_logical_request_reuses_result_and_only_one_daily_debit():
    route = respx.post("https://p.test/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": "result"}}]})
    )
    router = LLMRouter(
        [Provider("p", "https://p.test", "m", None)],
        operations=MemoryOperations(),
        admission=AdmissionGuard(MemoryDailyQuota(), MemoryMinuteLimiter(100), 1),
    )
    with ai_scope("alice"), operation_scope("same-request"):
        assert router.complete([{"role": "user", "content": "one"}]) == "result"
        assert router.complete([{"role": "user", "content": "one"}]) == "result"
    assert route.call_count == 1


@respx.mock
def test_uncertain_provider_failure_is_not_automatically_replayed():
    route = respx.post("https://p.test/chat/completions").mock(side_effect=httpx.ReadTimeout("unknown outcome"))
    router = LLMRouter([Provider("p", "https://p.test", "m", None)], operations=MemoryOperations(), max_retries=0)
    with ai_scope("alice"), operation_scope("same-request"):
        with pytest.raises(AllProvidersFailed):
            router.complete([{"role": "user", "content": "one"}])
        with pytest.raises(RateLimited) as denied:
            router.complete([{"role": "user", "content": "one"}])
        assert denied.value.details["reason"] == "operation_uncertain"
    assert route.call_count == 1
