import httpx
import pytest
import respx

from app.llm.router import AllProvidersFailed, LLMRouter, Provider

OK_BODY = {
    "choices": [{"message": {"content": "hello"}}],
    "usage": {"prompt_tokens": 5, "completion_tokens": 3},
}


def make_router(providers: list[Provider], sleep=lambda s: None, **kw: object) -> LLMRouter:
    options: dict[str, object] = {"timeout_seconds": 1, "max_retries": 0}
    options.update(kw)
    return LLMRouter(providers=providers, sleep=sleep, **options)  # type: ignore[arg-type]


MSGS = [{"role": "user", "content": "hi"}]


@respx.mock
def test_failover_on_429_then_5xx() -> None:
    a = Provider("primary", "https://a.test/v1", "m-a", "k")
    b = Provider("groq", "https://b.test/v1", "m-b", "k")
    respx.post("https://a.test/v1/chat/completions").mock(return_value=httpx.Response(429))
    respx.post("https://b.test/v1/chat/completions").mock(return_value=httpx.Response(200, json=OK_BODY))
    router = make_router([a, b])
    assert router.complete(MSGS) == "hello"
    # usage logged for the successful provider
    assert any(r.provider == "groq" and not r.fallback_event for r in router.usage_log.records)


@respx.mock
def test_all_fail_429_and_5xx_raises() -> None:
    a = Provider("primary", "https://a.test/v1", "m-a", None)
    b = Provider("groq", "https://b.test/v1", "m-b", None)
    respx.post("https://a.test/v1/chat/completions").mock(return_value=httpx.Response(500))
    respx.post("https://b.test/v1/chat/completions").mock(return_value=httpx.Response(429))
    router = make_router([a, b])
    with pytest.raises(AllProvidersFailed):
        router.complete(MSGS)


@respx.mock
def test_timeout_fails_over() -> None:
    a = Provider("primary", "https://a.test/v1", "m-a", None)
    b = Provider("groq", "https://b.test/v1", "m-b", None)
    respx.post("https://a.test/v1/chat/completions").mock(side_effect=httpx.ConnectTimeout("timeout"))
    respx.post("https://b.test/v1/chat/completions").mock(return_value=httpx.Response(200, json=OK_BODY))
    router = make_router([a, b])
    assert router.complete(MSGS) == "hello"


@respx.mock
def test_configured_huggingface_fallback_runs_only_after_primary_and_groq_fail() -> None:
    primary = Provider("logfare:model-a", "https://a.test/v1", "model-a", "a-key")
    groq = Provider("groq", "https://b.test/v1", "model-b", "b-key")
    huggingface = Provider("huggingface", "https://hf.test/v1", "org/model", "hf-key")
    primary_route = respx.post("https://a.test/v1/chat/completions").mock(return_value=httpx.Response(503))
    groq_route = respx.post("https://b.test/v1/chat/completions").mock(return_value=httpx.Response(429))
    hf_route = respx.post("https://hf.test/v1/chat/completions").mock(
        return_value=httpx.Response(200, json=OK_BODY)
    )

    router = make_router([primary, groq, huggingface])

    assert router.complete(MSGS) == "hello"
    assert primary_route.call_count == groq_route.call_count == hf_route.call_count == 1


@respx.mock
def test_retries_then_fails_over_on_5xx() -> None:
    a = Provider("primary", "https://a.test/v1", "m-a", None)
    b = Provider("groq", "https://b.test/v1", "m-b", None)
    route = respx.post("https://a.test/v1/chat/completions").mock(return_value=httpx.Response(503))
    respx.post("https://b.test/v1/chat/completions").mock(return_value=httpx.Response(200, json=OK_BODY))
    router = make_router([a, b], max_retries=2)
    assert router.complete(MSGS) == "hello"
    assert route.call_count == 3  # initial + 2 retries


def test_circuit_opens_after_consecutive_failures() -> None:
    router = make_router([Provider("primary", "https://a.test/v1", "m-a", None)], max_retries=0)
    circuit = router.circuits["primary"]
    for _ in range(router.circuit_failure_threshold):
        circuit.record_failure(0.0)
    assert circuit.is_open(0.0)
    assert circuit.is_open(router.circuit_cooldown_seconds - 1)
    assert not circuit.is_open(router.circuit_cooldown_seconds + 1)
    circuit.record_success()
    assert not circuit.is_open(0.0)


class DictCache:
    def __init__(self) -> None:
        self.data: dict[str, object] = {}

    def get(self, key: str) -> object | None:
        return self.data.get(key)

    def put(self, key: str, value: object) -> None:
        self.data[key] = value


@respx.mock
def test_cache_hit_skips_providers() -> None:
    a = Provider("primary", "https://a.test/v1", "m-a", None)
    route = respx.post("https://a.test/v1/chat/completions").mock(return_value=httpx.Response(200, json=OK_BODY))
    cache = DictCache()
    router = make_router([a], cache=cache)
    assert router.complete(MSGS) == "hello"
    assert route.call_count == 1
    assert router.complete(MSGS) == "hello"  # from cache
    assert route.call_count == 1
    assert router.usage_log.records[-1].cache_hit is True


def test_unconfigured_provider_is_skipped() -> None:
    router = make_router([Provider("primary", "", "", None), Provider("groq", "https://b.test/v1", "m-b", None)])
    with pytest.raises(AllProvidersFailed) as exc_info:
        router.complete(MSGS)
    # no HTTP was attempted (respx inactive would raise a real connection error otherwise)
    assert "not configured" in str(exc_info.value)


@respx.mock
def test_fallback_chain_survives_a_bounded_load_burst() -> None:
    """A small deterministic burst proves the circuit limits repeated calls to
    a failing provider and shifts requests to the configured fallback."""
    primary = Provider("primary", "https://a.test/v1", "m-a", "k")
    fallback = Provider("groq", "https://b.test/v1", "m-b", "k")
    primary_route = respx.post("https://a.test/v1/chat/completions").mock(return_value=httpx.Response(503))
    fallback_route = respx.post("https://b.test/v1/chat/completions").mock(
        return_value=httpx.Response(200, json=OK_BODY)
    )
    router = make_router([primary, fallback], max_retries=0)

    results = [router.complete([{"role": "user", "content": f"request {number}"}]) for number in range(25)]

    assert results == ["hello"] * 25
    assert primary_route.call_count == router.circuit_failure_threshold
    assert fallback_route.call_count == 25
