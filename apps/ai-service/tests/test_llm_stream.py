"""Provider token streams preserve admission, budgets, usage and uncertainty."""

import asyncio
import json

import httpx
import pytest

from app.errors import ApiError
from app.llm.admission import AdmissionGuard, MemoryDailyQuota, MemoryMinuteLimiter, ai_scope
from app.llm.budgets import BudgetLimits, MemoryBudgetStore
from app.llm.cache_scope import response_scope
from app.llm.operations import MemoryOperations, operation_scope
from app.llm.router import LLMRouter, Provider
from app.llm.usage_ledger import MemoryUsageLedger


def limits():
    return BudgetLimits(100_000, 100_000, 100_000, 2, 4, 60)


def event(value):
    return ("data: " + json.dumps(value) + "\n\n").encode()


class WaitingStream(httpx.AsyncByteStream):
    def __init__(self, resume):
        self.resume = resume

    async def __aiter__(self):
        yield event({"choices": [{"delta": {"content": "Tutor "}}]})
        await self.resume.wait()
        yield event({"choices": [{"delta": {"content": "answer."}}]})
        yield event({"choices": [], "usage": {"prompt_tokens": 8, "completion_tokens": 3}})
        yield b"data: [DONE]\n\n"

    async def aclose(self):
        return None


def make_router(stream):
    budget = MemoryBudgetStore()
    ledger = MemoryUsageLedger()
    operations = MemoryOperations()
    quota = MemoryDailyQuota()
    admission = AdmissionGuard(quota, MemoryMinuteLimiter(10), 10)
    transport = httpx.MockTransport(lambda request: httpx.Response(200, stream=stream))
    router = LLMRouter(
        [Provider("primary", "https://p.test/v1", "model", None)],
        max_retries=0,
        max_provider_attempts=1,
        max_output_tokens=20,
        budget_store=budget,
        budget_limits=limits(),
        usage_ledger=ledger,
        operations=operations,
        admission=admission,
        async_client_factory=lambda **kwargs: httpx.AsyncClient(transport=transport, **kwargs),
    )
    return router, budget, ledger, operations, quota


@pytest.mark.asyncio
async def test_provider_tokens_are_yielded_incrementally_and_accounted():
    resume = asyncio.Event()
    router, budgets, ledger, operations, quota = make_router(WaitingStream(resume))
    with ai_scope("learner"), response_scope("course_tutor"), operation_scope("request-1"):
        stream = router.stream_complete([{"role": "user", "content": "explain the lesson"}])
        first = await anext(stream)
        assert first == "Tutor "
        assert len(operations.rows) == 1
        resume.set()
        rest = [chunk async for chunk in stream]
    assert "".join([first, *rest]) == "Tutor answer."
    reservation = next(iter(budgets.rows.values()))
    assert reservation.state == "settled" and reservation.actual_tokens == 11
    operation = next(iter(ledger.operations.values()))
    assert operation.finished_at is not None and operation.prompt_tokens == 8
    assert operation.completion_tokens == 3 and operation.attempts[1].outcome == "succeeded"
    assert next(iter(operations.rows.values()))["state"] == "succeeded"
    assert quota._counts["learner"][1] == 1


@pytest.mark.asyncio
async def test_consumer_cancellation_marks_operation_uncertain_and_charges_reserved_budget():
    resume = asyncio.Event()
    router, budgets, ledger, operations, _quota = make_router(WaitingStream(resume))
    with ai_scope("learner"), response_scope("course_tutor"), operation_scope("request-cancel"):
        stream = router.stream_complete([{"role": "user", "content": "explain the lesson"}])
        assert await anext(stream) == "Tutor "
        await stream.aclose()
    reservation = next(iter(budgets.rows.values()))
    assert reservation.state == "settled" and reservation.actual_tokens == reservation.reserved_tokens
    operation = next(iter(ledger.operations.values()))
    assert operation.outcome == "uncertain" and operation.attempts[1].outcome == "cancelled"
    assert next(iter(operations.rows.values()))["state"] == "uncertain"


@pytest.mark.asyncio
@pytest.mark.parametrize("suffix", [
    b"", event({"choices": [{"finish_reason": "length"}]}) + b"data: [DONE]\n\n",
    event({"choices": [None]}),
])
async def test_incomplete_provider_output_is_never_settled_as_a_success(suffix):
    class IncompleteStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield event({"choices": [{"delta": {"content": "Partial answer"}}]})
            yield suffix

    router, budgets, ledger, operations, _quota = make_router(IncompleteStream())
    with ai_scope("learner"), response_scope("course_tutor"), operation_scope("request-incomplete"):
        stream = router.stream_complete([{"role": "user", "content": "explain a topic"}])
        assert await anext(stream) == "Partial answer"
        with pytest.raises(ApiError, match="before completion") as failure:
            await anext(stream)
        assert failure.value.details == {"reason": "operation_uncertain"}
    operation = next(iter(ledger.operations.values()))
    assert operation.outcome == "uncertain" and operation.attempts[1].outcome == "failed"
    assert next(iter(operations.rows.values()))["state"] == "uncertain"
    reservation = next(iter(budgets.rows.values()))
    assert reservation.state == "settled" and reservation.actual_tokens == reservation.reserved_tokens


@pytest.mark.asyncio
@pytest.mark.parametrize(("status", "primary_attempts"), [(404, 2), (503, 5)])
async def test_stream_fallback_does_not_retry_missing_models_or_starve_groq(monkeypatch, status, primary_attempts):
    calls = []

    def respond(request):
        calls.append(request.url.host)
        if request.url.host == "primary.test":
            return httpx.Response(status)
        return httpx.Response(200, content=event({"choices": [{"delta": {"content": "Fallback answer"}}]})
                              + event({"choices": [], "usage": {"prompt_tokens": 3, "completion_tokens": 2}})
                              + b"data: [DONE]\n\n")

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr("app.llm.router.asyncio.sleep", no_wait)
    providers = [Provider("logfare:a", "https://primary.test/v1", "a", "key"),
                 Provider("logfare:b", "https://primary.test/v1", "b", "key"),
                 Provider("groq", "https://groq.test/v1", "configured-groq", "key")]
    router = LLMRouter(providers, max_retries=2, max_provider_attempts=6,
                       async_client_factory=lambda **kwargs: httpx.AsyncClient(
                           transport=httpx.MockTransport(respond), **kwargs))
    result = [token async for token in router.stream_complete([{"role": "user", "content": "Fixture"}])]
    assert result == ["Fallback answer"]
    assert calls == ["primary.test"] * primary_attempts + ["groq.test"]
