"""One private operation groups every actual retry/fallback HTTP attempt."""

import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock

import httpx
import pytest
import respx

from app.errors import ApiError
from app.llm.admission import ai_scope
from app.llm.cache_scope import PrivateResponseCache, response_scope
from app.llm.response_cache import MemoryResponseCache
from app.llm.router import LLMRouter, Provider
from app.llm.usage_ledger import MemoryUsageLedger, PgUsageLedger

NOW = datetime(2026, 11, 17, tzinfo=UTC)


def test_memory_attempt_replay_does_not_double_count_and_owner_is_checked():
    ledger = MemoryUsageLedger()
    op = str(uuid.uuid4())
    ledger.begin("alice", op, "summary", NOW)
    args = ("alice", op, 1, "primary", "model", "succeeded", 7, 3, 10, NOW)
    ledger.record_attempt(*args)
    ledger.record_attempt(*args)
    assert ledger.operations[op].prompt_tokens == 7
    assert len(ledger.operations[op].attempts) == 1
    with pytest.raises(ValueError, match="scope mismatch"):
        ledger.begin("bob", op, "summary", NOW)
    with pytest.raises(ValueError, match="owner"):
        ledger.record_attempt("bob", op, 2, "primary", "model", "failed", 0, 0, 10, NOW)
    ledger.finish("alice", op, "succeeded", False, NOW)
    ledger.finish("alice", op, "failed", False, NOW)
    assert ledger.operations[op].outcome == "succeeded"


@respx.mock
def test_router_groups_retries_fallback_and_cache_hit_as_distinct_operations():
    primary = respx.post("https://primary.test/chat/completions").mock(return_value=httpx.Response(503))
    fallback = respx.post("https://fallback.test/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "answer"}}],
                "usage": {"prompt_tokens": 9, "completion_tokens": 2},
            },
        )
    )
    ledger = MemoryUsageLedger()
    router = LLMRouter(
        [
            Provider("primary", "https://primary.test", "a", None),
            Provider("fallback", "https://fallback.test", "b", None),
        ],
        usage_ledger=ledger,
        max_retries=1,
        sleep=lambda _: None,
        cache=PrivateResponseCache(MemoryResponseCache(max_content_chars=100, max_entries_per_user=5), 60),
    )
    with ai_scope("alice"), response_scope("summary"):
        assert router.complete([{"role": "user", "content": "private prompt"}]) == "answer"
        router.accept_cache_candidate()
        assert router.complete([{"role": "user", "content": "private prompt"}]) == "answer"
    first, second = ledger.operations.values()
    assert primary.call_count == 2 and fallback.call_count == 1
    assert len(first.attempts) == 3 and first.prompt_tokens == 9 and first.completion_tokens == 2
    assert first.feature == "summary" and first.outcome == "succeeded"
    assert second.cache_hit and not second.attempts
    assert "private prompt" not in repr(ledger.operations)


@respx.mock
def test_ledger_begin_failure_prevents_unaccounted_provider_calls():
    ledger = MemoryUsageLedger()
    ledger.begin = MagicMock(side_effect=ConnectionError("offline"))
    router = LLMRouter([Provider("primary", "https://primary.test", "a", None)], usage_ledger=ledger)
    with ai_scope("alice"), pytest.raises(ApiError) as failure:
        router.complete([{"role": "user", "content": "private"}])
    assert failure.value.status_code == 503 and len(respx.calls) == 0


def test_postgres_begin_and_finish_scope_without_raw_content():
    cur = MagicMock()
    cur.__enter__.return_value = cur
    cur.fetchone.return_value = ("alice", "summary")
    conn = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value = cur
    ledger = PgUsageLedger("unused", connection_factory=lambda *args, **kwargs: conn)
    op = str(uuid.uuid4())
    ledger.begin("alice", op, "summary", NOW)
    assert cur.execute.call_args.args[1] == (op, "alice", "summary", NOW)
    ledger.finish("alice", op, "succeeded", False, NOW)
    sql, params = cur.execute.call_args.args
    assert "operation_id=%s AND user_id=%s AND finished_at IS NULL" in sql
    assert params[-2:] == (op, "alice")
