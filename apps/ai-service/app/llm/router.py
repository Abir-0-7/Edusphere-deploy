"""LLM fallback router (task 1.12).

Provider order, models and keys come from Settings only — never hard-coded.
Features: timeouts, retries with backoff, circuit breaker, response cache,
usage logging. Feature code must call the router, never a provider directly.
"""

import asyncio
import hashlib
import json
import logging
import random
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import asdict, dataclass, field
from typing import Any, Protocol

import httpx

from app.errors import ApiError, InvalidInput
from app.llm.admission import AdmissionGuard, current_ai_owner
from app.llm.budgets import BudgetLimits, BudgetStore
from app.llm.cache_scope import (
    ResponseScope,
    accept_cache_candidate,
    clear_cache_candidate,
    current_response_scope,
    stage_cache_candidate,
)
from app.llm.operations import MemoryOperations, PgOperations, operation_key, unavailable
from app.llm.usage_ledger import UsageLedger, utc_now

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


@dataclass
class BudgetTracking:
    reservation_id: str | None = None
    reserved_tokens: int = 0
    attempted: bool = False
    observed_tokens: int = 0
    uncertain: bool = False


class UsageLog:
    """Process-local monitoring records, alongside the separate durable ledger."""

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
    admission: AdmissionGuard | None = None  # main injects guard; isolated router unit tests may omit it
    usage_ledger: UsageLedger | None = None  # main always injects the selected durable/development store
    operations: MemoryOperations | PgOperations | None = None
    budget_store: BudgetStore | None = None
    budget_limits: BudgetLimits | None = None
    max_provider_attempts: int = 6
    max_output_tokens: int = 4096
    max_input_chars: int = 64000
    cache_policy_version: str = "1"
    usage_log: UsageLog = field(default_factory=UsageLog)
    sleep: Any = staticmethod(time.sleep)  # injectable for tests
    client_factory: Any = staticmethod(httpx.Client)
    async_client_factory: Any = staticmethod(httpx.AsyncClient)
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
        clear_cache_candidate()
        if self.admission is not None:
            self.admission.authorize()
        if sum(len(message.get("content", "")) for message in messages) > self.max_input_chars:
            raise InvalidInput("AI context exceeds the configured input limit")
        owner = current_ai_owner()
        scope = current_response_scope()
        key = (
            operation_key(
                owner,
                {
                    "messages": messages,
                    "temperature": temperature,
                    "scope": asdict(scope) if scope else None,
                    "providers": [{"name": p.name, "model": p.model, "url": p.base_url} for p in self.providers],
                    "policy": self.cache_policy_version,
                },
            )
            if owner
            else None
        )
        if self.operations is not None and key is not None:
            try:
                source = current_response_scope()
                fresh, prior = self.operations.claim(owner, key, source.document_id if source else None)
            except ApiError:
                raise
            except Exception as exc:
                raise unavailable(exc) from exc
            if not fresh:
                return prior or ""
        operation_id = str(uuid.uuid4())
        feature = scope.namespace if scope is not None else "unspecified"
        if self.usage_ledger is not None:
            try:
                self.usage_ledger.begin(owner or "", operation_id, feature, utc_now())
            except Exception as exc:  # noqa: BLE001 - ledger outages must prevent unaccounted calls
                if self.operations is not None and key is not None:
                    try:
                        self.operations.settle(owner, key, None, False)
                    except Exception as settle_error:  # noqa: BLE001 - visible unused reservation recovery
                        logger.error("AI unused reservation release failed: %s", type(settle_error).__name__)
                logger.error("AI usage begin unavailable: operation=%s error=%s", operation_id, type(exc).__name__)
                raise ApiError("AI usage accounting is temporarily unavailable", status_code=503) from exc
        outcome, cache_hit = "failed", False
        result: str | None = None
        attempted = [False]
        budget_tracking = BudgetTracking()
        try:
            text, cache_hit = self._complete_operation(
                messages, temperature, operation_id, owner, attempted, budget_tracking
            )
            outcome = "cache_hit" if cache_hit else "succeeded"
            result = text
            return text
        except ApiError as exc:
            outcome = exc.code
            raise
        finally:
            if budget_tracking.reservation_id is not None and self.budget_store is not None:
                try:
                    if budget_tracking.attempted:
                        charged_tokens = (
                            budget_tracking.reserved_tokens
                            if budget_tracking.uncertain
                            else budget_tracking.observed_tokens
                        )
                        self.budget_store.settle(owner or "", operation_id, charged_tokens)
                    else:
                        self.budget_store.release(owner or "", operation_id)
                except Exception as exc:  # noqa: BLE001 - reserved amount remains charged until lease expiry
                    logger.error(
                        "AI budget settlement unavailable: operation=%s error=%s", operation_id, type(exc).__name__
                    )
            if self.operations is not None and key is not None:
                try:
                    self.operations.settle(owner, key, result, attempted[0])
                except Exception as exc:  # noqa: BLE001 - preserve visible result, log unsettled operation
                    logger.error("AI operation settlement failed: %s", type(exc).__name__)
            if self.usage_ledger is not None:
                try:
                    self.usage_ledger.finish(owner or "", operation_id, outcome, cache_hit, utc_now())
                except Exception as exc:  # noqa: BLE001 - preserve the call result and make persistence failures visible
                    logger.error("AI usage finish unavailable: operation=%s error=%s", operation_id, type(exc).__name__)

    def stream_complete(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.2,
        *,
        scope: ResponseScope | None = None,
    ) -> AsyncIterator[str]:
        """Defer admission and provider work until the consumer starts reading."""
        scope = scope or current_response_scope()

        async def deferred() -> AsyncIterator[str]:
            stream = self._stream_complete_impl(messages, temperature, scope)
            try:
                async for token in stream:
                    yield token
            finally:
                await stream.aclose()

        return deferred()

    def _stream_complete_impl(
        self, messages: list[dict[str, str]], temperature: float, scope: Any
    ) -> AsyncIterator[str]:
        """Stream OpenAI-compatible SSE deltas under the same admission and budget controls.

        Once a provider has emitted a token, transport failure or consumer
        cancellation marks the operation uncertain and does not replay it on a
        fallback provider. This prevents duplicated partial answers and double
        provider work. The caller decides when a completed answer is accepted
        and persisted.
        """
        clear_cache_candidate()
        if self.admission is not None:
            self.admission.authorize()
        if sum(len(message.get("content", "")) for message in messages) > self.max_input_chars:
            raise InvalidInput("AI context exceeds the configured input limit")
        owner = current_ai_owner()
        key = (
            operation_key(
                owner,
                {
                    "messages": messages,
                    "temperature": temperature,
                    "scope": asdict(scope) if scope else None,
                    "providers": [{"name": p.name, "model": p.model, "url": p.base_url} for p in self.providers],
                    "policy": self.cache_policy_version,
                },
            )
            if owner
            else None
        )
        if self.operations is not None and key is not None:
            try:
                fresh, prior = self.operations.claim(owner, key, scope.document_id if scope else None)
            except ApiError:
                raise
            except Exception as exc:
                raise unavailable(exc) from exc
            if not fresh:

                async def replayed_result() -> AsyncIterator[str]:
                    if prior:
                        yield prior

                return replayed_result()

        operation_id = str(uuid.uuid4())
        feature = scope.namespace if scope is not None else "unspecified"
        if self.usage_ledger is not None:
            try:
                self.usage_ledger.begin(owner or "", operation_id, feature, utc_now())
            except Exception as exc:  # noqa: BLE001 - do not stream unaccounted provider work
                if self.operations is not None and key is not None:
                    self.operations.settle(owner, key, None, False)
                raise ApiError("AI usage accounting is temporarily unavailable", status_code=503) from exc

        tracking = BudgetTracking()
        attempted = False
        outcome = "failed"
        cache_hit = False
        result: str | None = None
        text_parts: list[str] = []
        attempt_no = 0
        remaining = self.max_provider_attempts
        admitted = False

        async def generate() -> AsyncIterator[str]:
            nonlocal attempted, outcome, result, attempt_no, remaining, admitted
            fallback_before = len(self.usage_log.records)
            errors: list[str] = []
            try:
                for provider in self.providers:
                    if remaining <= 0:
                        break
                    if not provider.is_configured:
                        errors.append(f"{provider.name}: not configured")
                        continue
                    circuit = self.circuits[provider.name]
                    if circuit.is_open(time.monotonic()):
                        errors.append(f"{provider.name}: circuit open")
                        continue
                    if not admitted:
                        if self.budget_store is not None:
                            if owner is None or self.budget_limits is None:
                                raise ApiError("AI budget tracking is not configured for this request", status_code=503)
                            upper_bound = (
                                sum(len(message.get("content", "").encode("utf-8")) + 8 for message in messages)
                                * self.max_provider_attempts
                                + self.max_output_tokens * self.max_provider_attempts
                            )
                            try:
                                reservation = self.budget_store.reserve(
                                    owner,
                                    operation_id,
                                    scope.namespace if scope is not None else "unspecified",
                                    upper_bound,
                                    self.budget_limits,
                                )
                            except ApiError:
                                raise
                            except Exception as exc:  # noqa: BLE001 - capacity errors fail closed
                                raise ApiError(
                                    "AI generation capacity is temporarily unavailable", status_code=503
                                ) from exc
                            if reservation.state != "reserved":
                                raise ApiError("AI budget reservation is no longer active", status_code=503)
                            tracking.reservation_id = operation_id
                            tracking.reserved_tokens = upper_bound
                        if self.admission is not None:
                            self.admission.admit()
                        admitted = True

                    for retry in range(self.max_retries + 1):
                        if remaining <= 0:
                            break
                        remaining -= 1
                        attempt_no += 1
                        attempted = True
                        tracking.attempted = True
                        start = time.monotonic()
                        prompt_tokens = completion_tokens = 0
                        usage_known = False
                        attempt_outcome = "failed"
                        emitted = False
                        response_text: list[str] = []
                        body = {
                            "model": provider.model,
                            "messages": messages,
                            "temperature": temperature,
                            "max_tokens": self.max_output_tokens,
                            "stream": True,
                            "stream_options": {"include_usage": True},
                        }
                        headers = {"Authorization": f"Bearer {provider.api_key}"} if provider.api_key else {}
                        url = f"{provider.base_url.rstrip('/')}/chat/completions"
                        try:
                            async with self.async_client_factory(timeout=self.timeout_seconds) as client:
                                async with client.stream("POST", url, json=body, headers=headers) as response:
                                    if response.status_code in RETRYABLE_STATUS:
                                        raise LLMError(f"retryable status {response.status_code}")
                                    response.raise_for_status()
                                    async for line in response.aiter_lines():
                                        if not line.startswith("data:"):
                                            continue
                                        data = line[5:].strip()
                                        if not data or data == "[DONE]":
                                            continue
                                        try:
                                            event = json.loads(data)
                                        except json.JSONDecodeError:
                                            continue
                                        raw_usage = event.get("usage") if isinstance(event, dict) else None
                                        if isinstance(raw_usage, dict):
                                            pt = raw_usage.get("prompt_tokens")
                                            ct = raw_usage.get("completion_tokens")
                                            if type(pt) is int and pt >= 0 and type(ct) is int and ct >= 0:
                                                prompt_tokens, completion_tokens, usage_known = pt, ct, True
                                        choices = event.get("choices", []) if isinstance(event, dict) else []
                                        if not choices:
                                            continue
                                        delta = choices[0].get("delta", {})
                                        token = delta.get("content") if isinstance(delta, dict) else None
                                        if isinstance(token, str) and token:
                                            emitted = True
                                            response_text.append(token)
                                            text_parts.append(token)
                                            yield token
                                            await asyncio.sleep(0)
                            if not emitted:
                                raise LLMError("provider returned an empty stream")
                            attempt_outcome = "succeeded"
                            tracking.observed_tokens += prompt_tokens + completion_tokens
                            tracking.uncertain = tracking.uncertain or not usage_known
                            circuit.record_success()
                            result = "".join(text_parts)
                            outcome = "succeeded"
                            self._record(
                                provider,
                                prompt_tokens,
                                completion_tokens,
                                start,
                                fallback_event=len(self.usage_log.records) > fallback_before,
                            )
                            return
                        except (GeneratorExit, asyncio.CancelledError):
                            attempt_outcome = "cancelled"
                            outcome = "uncertain"
                            tracking.uncertain = True
                            raise
                        except (httpx.HTTPError, LLMError, ValueError) as exc:
                            circuit.record_failure(time.monotonic())
                            errors.append(f"{provider.name}: {exc}")
                            tracking.uncertain = True
                            if emitted:
                                outcome = "uncertain"
                                raise ApiError(
                                    "Tutor stream ended before completion; retry with a new request", status_code=503
                                ) from exc
                            if retry < self.max_retries and remaining > 0:
                                await asyncio.sleep(min(2**retry, 4) + random.uniform(0, 0.25))
                        finally:
                            if self.usage_ledger is not None:
                                try:
                                    self.usage_ledger.record_attempt(
                                        owner or "",
                                        operation_id,
                                        attempt_no,
                                        provider.name,
                                        provider.model,
                                        attempt_outcome,
                                        prompt_tokens,
                                        completion_tokens,
                                        int((time.monotonic() - start) * 1000),
                                        utc_now(),
                                    )
                                except Exception as exc:  # noqa: BLE001 - accounting failure stops streaming
                                    raise ApiError(
                                        "AI usage accounting is temporarily unavailable", status_code=503
                                    ) from exc
                    self._record_failure(provider, time.monotonic())
                raise AllProvidersFailed("; ".join(errors) or "no providers configured")
            except (GeneratorExit, asyncio.CancelledError):
                outcome = "uncertain"
                tracking.uncertain = tracking.uncertain or attempted
                raise
            except ApiError as exc:
                outcome = exc.code
                raise
            except Exception:
                if outcome == "failed":
                    outcome = "uncertain" if attempted else "failed"
                raise
            finally:
                if tracking.reservation_id is not None and self.budget_store is not None:
                    try:
                        if tracking.attempted:
                            charge = tracking.reserved_tokens if tracking.uncertain else tracking.observed_tokens
                            self.budget_store.settle(owner or "", operation_id, charge)
                        else:
                            self.budget_store.release(owner or "", operation_id)
                    except Exception as exc:  # noqa: BLE001 - keep reservation charged until lease expiry
                        logger.error(
                            "AI budget settlement unavailable: operation=%s error=%s", operation_id, type(exc).__name__
                        )
                if self.operations is not None and key is not None:
                    try:
                        self.operations.settle(owner, key, result, attempted)
                    except Exception as exc:  # noqa: BLE001 - preserve uncertainty if durable settlement fails
                        logger.error("AI operation settlement failed: %s", type(exc).__name__)
                if self.usage_ledger is not None:
                    try:
                        self.usage_ledger.finish(owner or "", operation_id, outcome, cache_hit, utc_now())
                    except Exception as exc:  # noqa: BLE001 - report a final ledger write failure
                        logger.error(
                            "AI usage finish unavailable: operation=%s error=%s", operation_id, type(exc).__name__
                        )

        return generate()

    def _complete_operation(
        self,
        messages: list[dict[str, str]],
        temperature: float,
        operation_id: str,
        owner: str | None,
        attempted: list[bool],
        budget_tracking: BudgetTracking,
    ) -> tuple[str, bool]:
        payload: dict[str, Any] = {
            "messages": messages,
            "temperature": temperature,
            "owner": current_ai_owner(),
            "max_output_tokens": self.max_output_tokens,
            "scope": asdict(scope) if (scope := current_response_scope()) is not None else None,
            "cache_policy_version": self.cache_policy_version,
            "providers": [{"name": p.name, "base_url": p.base_url, "model": p.model} for p in self.providers],
        }
        if self.cache is not None:
            cached = self.cache.get(self._cache_key(payload))
            if cached is not None:
                self.usage_log.add(UsageRecord("cache", "cache", 0, 0, 0, cache_hit=True))
                return str(cached), True

        errors: list[str] = []
        admitted = False
        remaining = [self.max_provider_attempts]
        attempt_counter = [0]
        now = time.monotonic()
        for provider in self.providers:
            if not provider.is_configured:
                errors.append(f"{provider.name}: not configured")
                continue
            circuit = self.circuits[provider.name]
            if circuit.is_open(now):
                errors.append(f"{provider.name}: circuit open")
                continue
            if remaining[0] <= 0:
                break
            if not admitted:
                if self.budget_store is not None:
                    if owner is None or self.budget_limits is None:
                        raise ApiError("AI budget tracking is not configured for this request", status_code=503)
                    upper_bound = (
                        sum(len(message.get("content", "").encode("utf-8")) + 8 for message in messages)
                        * self.max_provider_attempts
                        + self.max_output_tokens * self.max_provider_attempts
                    )
                    try:
                        reservation = self.budget_store.reserve(
                            owner,
                            operation_id,
                            scope.namespace if scope is not None else "unspecified",
                            upper_bound,
                            self.budget_limits,
                        )
                    except ApiError:
                        raise
                    except Exception as exc:  # noqa: BLE001 - budget store failure must fail closed
                        logger.error("AI budget reservation unavailable: %s", type(exc).__name__)
                        raise ApiError("AI generation capacity is temporarily unavailable", status_code=503) from exc
                    if reservation.state != "reserved":
                        raise ApiError("AI budget reservation is no longer active", status_code=503)
                    budget_tracking.reservation_id = operation_id
                    budget_tracking.reserved_tokens = upper_bound
                if self.admission is not None:
                    self.admission.admit()
                admitted = True
            try:
                attempted[0] = True
                budget_tracking.attempted = True
                text = self._call_with_retries(
                    provider, messages, temperature, remaining, owner, operation_id, attempt_counter, budget_tracking
                )
            except (httpx.HTTPError, LLMError) as exc:
                self.circuits[provider.name].record_failure(time.monotonic())
                errors.append(f"{provider.name}: {exc}")
                continue
            self.circuits[provider.name].record_success()
            if self.cache is not None:
                key = self._cache_key(payload)
                if getattr(self.cache, "cache_after_validation", False):
                    stage_cache_candidate(self.cache.put, key, text)
                else:
                    self.cache.put(key, text)
            return text, False
        raise AllProvidersFailed("; ".join(errors) or "no providers configured")

    def accept_cache_candidate(self) -> None:
        """Cache the last response only after feature-level validation succeeds."""
        accept_cache_candidate()

    def _call_with_retries(
        self,
        provider: Provider,
        messages: list[dict[str, str]],
        temperature: float,
        remaining: list[int],
        owner: str | None,
        operation_id: str,
        attempt_counter: list[int],
        budget_tracking: BudgetTracking,
    ) -> str:
        fallbacks_before = len(self.usage_log.records)
        last_error: Exception | None = None
        url = f"{provider.base_url.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {provider.api_key}"} if provider.api_key else {}
        body = {
            "model": provider.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": self.max_output_tokens,
        }
        with self.client_factory(timeout=self.timeout_seconds) as client:
            for attempt in range(self.max_retries + 1):
                if remaining[0] <= 0:
                    break
                remaining[0] -= 1
                attempt_counter[0] += 1
                start = time.monotonic()
                pt, ct = 0, 0
                attempt_outcome = "failed"
                try:
                    resp = client.post(url, json=body, headers=headers)
                    if resp.status_code in RETRYABLE_STATUS:
                        raise LLMError(f"retryable status {resp.status_code}")
                    resp.raise_for_status()
                    data = resp.json()
                    text = data["choices"][0]["message"]["content"]
                    raw_usage = data.get("usage")
                    usage_is_known = (
                        isinstance(raw_usage, dict)
                        and type(raw_usage.get("prompt_tokens")) is int
                        and raw_usage["prompt_tokens"] >= 0
                        and type(raw_usage.get("completion_tokens")) is int
                        and raw_usage["completion_tokens"] >= 0
                    )
                    usage = raw_usage if isinstance(raw_usage, dict) else {}
                    pt = usage.get("prompt_tokens", 0)
                    ct = usage.get("completion_tokens", 0)
                    pt = pt if type(pt) is int and pt >= 0 else 0
                    ct = ct if type(ct) is int and ct >= 0 else 0
                    budget_tracking.observed_tokens += pt + ct
                    budget_tracking.uncertain = budget_tracking.uncertain or not usage_is_known
                    attempt_outcome = "succeeded"
                    self._record(
                        provider,
                        pt,
                        ct,
                        start,
                        fallback_event=len(self.usage_log.records) > fallbacks_before,
                    )
                    return str(text)
                except (httpx.HTTPError, LLMError, KeyError, IndexError, ValueError) as exc:
                    budget_tracking.uncertain = True
                    last_error = exc
                    if attempt < self.max_retries and remaining[0] > 0:
                        self.sleep(min(2**attempt, 4) + random.uniform(0, 0.25))
                finally:
                    if self.usage_ledger is not None:
                        try:
                            self.usage_ledger.record_attempt(
                                owner or "",
                                operation_id,
                                attempt_counter[0],
                                provider.name,
                                provider.model,
                                attempt_outcome,
                                pt,
                                ct,
                                int((time.monotonic() - start) * 1000),
                                utc_now(),
                            )
                        except Exception as exc:  # noqa: BLE001 - stop retries/fallback after unaccounted attempts
                            logger.error(
                                "AI usage attempt unavailable: operation=%s attempt=%s error=%s",
                                operation_id,
                                attempt_counter[0],
                                type(exc).__name__,
                            )
                            raise ApiError("AI usage accounting is temporarily unavailable", status_code=503) from exc
        self._record_failure(provider, start)
        raise LLMError(f"{provider.name} failed after retries: {last_error}")

    def _record(self, provider: Provider, pt: int, ct: int, start: float, fallback_event: bool) -> None:
        latency_ms = int((time.monotonic() - start) * 1000)
        self.usage_log.add(UsageRecord(provider.name, provider.model, pt, ct, latency_ms, False, fallback_event))

    def _record_failure(self, provider: Provider, start: float) -> None:
        latency_ms = int((time.monotonic() - start) * 1000)
        self.usage_log.add(UsageRecord(provider.name, provider.model, 0, 0, latency_ms))


def router_from_settings(
    settings: Any,
    cache: ResponseCache | None = None,
    admission: AdmissionGuard | None = None,
    usage_ledger: UsageLedger | None = None,
    operations: MemoryOperations | PgOperations | None = None,
    budget_store: BudgetStore | None = None,
    budget_limits: BudgetLimits | None = None,
) -> LLMRouter:
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
        admission=admission,
        usage_ledger=usage_ledger,
        operations=operations,
        budget_store=budget_store,
        budget_limits=budget_limits
        or BudgetLimits(
            settings.llm_user_daily_token_budget,
            settings.llm_global_daily_token_budget,
            settings.llm_feature_daily_token_budget,
            settings.llm_user_generation_slots,
            settings.llm_global_generation_slots,
            settings.llm_generation_lease_seconds,
        ),
        max_provider_attempts=settings.llm_max_provider_attempts,
        max_output_tokens=settings.llm_max_output_tokens,
        max_input_chars=settings.llm_max_input_chars,
        cache_policy_version=settings.llm_cache_policy_version,
    )
