"""LLM fallback router (task 1.12).

Provider order, models and keys come from Settings only — never hard-coded.
Features: timeouts, retries with backoff, circuit breaker, response cache,
usage logging. Feature code must call the router, never a provider directly.
"""

import hashlib
import json
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

logger = logging.getLogger("studyvault.llm")

RETRYABLE_STATUS = {408, 409, 429, 500, 502, 503, 504}


class ResponseCache(Protocol):
    def get(self, key: str) -> Any | None: ...
    def put(self, key: str, value: Any) -> None: ...


@dataclass
class UsageRecord:
    provider: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int
    cache_hit: bool = False
    fallback_event: bool = False


class UsageLog:
    """In-memory usage log; a real deployment swaps in Postgres/Logflare sink."""

    def __init__(self) -> None:
        self.records: list[UsageRecord] = []

    def add(self, record: UsageRecord) -> None:
        self.records.append(record)
        logger.info(
            "llm_usage",
            extra={
                "provider": record.provider,
                "model": record.model,
                "prompt_tokens": record.prompt_tokens,
                "completion_tokens": record.completion_tokens,
                "latency_ms": record.latency_ms,
                "cache_hit": record.cache_hit,
                "fallback": record.fallback_event,
            },
        )


@dataclass
class ProviderCircuit:
    failure_threshold: int
    cooldown_seconds: float
    consecutive_failures: int = 0
    open_until: float = 0.0

    def is_open(self, now: float) -> bool:
        return now < self.open_until

    def record_failure(self, now: float) -> None:
        self.consecutive_failures += 1
        if self.consecutive_failures >= self.failure_threshold:
            self.open_until = now + self.cooldown_seconds

    def record_success(self) -> None:
        self.consecutive_failures = 0
        self.open_until = 0.0


@dataclass
class Provider:
    name: str
    base_url: str
    model: str
    api_key: str | None

    @property
    def is_configured(self) -> bool:
        return bool(self.base_url and self.model)


class LLMError(Exception):
    pass


class AllProvidersFailed(LLMError):
    pass


@dataclass
class LLMRouter:
    providers: list[Provider]
    timeout_seconds: float = 30.0
    max_retries: int = 2
    circuit_failure_threshold: int = 3
    circuit_cooldown_seconds: float = 300.0
    cache: ResponseCache | None = None
    usage_log: UsageLog = field(default_factory=UsageLog)
    sleep: Any = staticmethod(time.sleep)  # injectable for tests
    client_factory: Any = staticmethod(httpx.Client)
    circuits: dict[str, ProviderCircuit] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        self.circuits = {
            p.name: ProviderCircuit(self.circuit_failure_threshold, self.circuit_cooldown_seconds)
            for p in self.providers
        }

    def _cache_key(self, payload: dict[str, Any]) -> str:
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()

    def complete(self, messages: list[dict[str, str]], temperature: float = 0.2) -> str:
        """Chat completion via the fallback chain. Raises AllProvidersFailed."""
        payload: dict[str, Any] = {"messages": messages, "temperature": temperature}
        if self.cache is not None:
            cached = self.cache.get(self._cache_key({"model_order": [p.name for p in self.providers], **payload}))
            if cached is not None:
                self.usage_log.add(UsageRecord("cache", "cache", 0, 0, 0, cache_hit=True))
                return str(cached)

        errors: list[str] = []
        now = time.monotonic()
        for provider in self.providers:
            if not provider.is_configured:
                errors.append(f"{provider.name}: not configured")
                continue
            circuit = self.circuits[provider.name]
            if circuit.is_open(now):
                errors.append(f"{provider.name}: circuit open")
                continue
            try:
                text = self._call_with_retries(provider, messages, temperature)
            except (httpx.HTTPError, LLMError) as exc:
                self.circuits[provider.name].record_failure(time.monotonic())
                errors.append(f"{provider.name}: {exc}")
                continue
            self.circuits[provider.name].record_success()
            if self.cache is not None:
                self.cache.put(
                    self._cache_key({"model_order": [p.name for p in self.providers], **payload}), text
                )
            return text
        raise AllProvidersFailed("; ".join(errors) or "no providers configured")

    def _call_with_retries(self, provider: Provider, messages: list[dict[str, str]], temperature: float) -> str:
        fallbacks_before = len(self.usage_log.records)
        last_error: Exception | None = None
        url = f"{provider.base_url.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {provider.api_key}"} if provider.api_key else {}
        body = {"model": provider.model, "messages": messages, "temperature": temperature}
        with self.client_factory(timeout=self.timeout_seconds) as client:
            for attempt in range(self.max_retries + 1):
                start = time.monotonic()
                try:
                    resp = client.post(url, json=body, headers=headers)
                    if resp.status_code in RETRYABLE_STATUS:
                        raise LLMError(f"retryable status {resp.status_code}")
                    resp.raise_for_status()
                    data = resp.json()
                    text = data["choices"][0]["message"]["content"]
                    usage = data.get("usage") or {}
                    self._record(
                        provider,
                        usage.get("prompt_tokens", 0),
                        usage.get("completion_tokens", 0),
                        start,
                        fallback_event=len(self.usage_log.records) > fallbacks_before,
                    )
                    return str(text)
                except (httpx.HTTPError, LLMError, KeyError, IndexError, ValueError) as exc:
                    last_error = exc
                    if attempt < self.max_retries:
                        self.sleep(min(2**attempt, 4) + random.uniform(0, 0.25))
        self._record_failure(provider, start)
        raise LLMError(f"{provider.name} failed after retries: {last_error}")

    def _record(self, provider: Provider, pt: int, ct: int, start: float, fallback_event: bool) -> None:
        latency_ms = int((time.monotonic() - start) * 1000)
        self.usage_log.add(
            UsageRecord(provider.name, provider.model, pt, ct, latency_ms, False, fallback_event)
        )

    def _record_failure(self, provider: Provider, start: float) -> None:
        latency_ms = int((time.monotonic() - start) * 1000)
        self.usage_log.add(UsageRecord(provider.name, provider.model, 0, 0, latency_ms))


def router_from_settings(settings: Any, cache: ResponseCache | None = None) -> LLMRouter:
    providers = [
        Provider(
            name=name,
            base_url=str(slot["base_url"] or ""),
            model=str(slot["model"] or ""),
            api_key=slot["api_key"],
        )
        for name, slot in settings.provider_slots().items()
    ]
    return LLMRouter(
        providers=providers,
        timeout_seconds=settings.llm_timeout_seconds,
        max_retries=settings.llm_max_retries,
        circuit_failure_threshold=settings.circuit_failure_threshold,
        circuit_cooldown_seconds=settings.circuit_cooldown_seconds,
        cache=cache,
    )
