"""The fallback router reuses only a private owner/source/prompt policy match."""

from dataclasses import replace
from datetime import UTC, datetime

import httpx
import pytest
import respx

from app.ai.schemas import ChapterOutlineList, StructuredOutputError, complete_validated
from app.documents.store import ChapterRecord, ChunkRecord, InMemoryDocumentStore
from app.jobs.worker import InMemoryJobStore, Job, Worker
from app.llm.admission import ai_scope, current_ai_owner
from app.llm.cache_scope import PrivateResponseCache, current_response_scope, response_scope
from app.llm.response_cache import MemoryResponseCache
from app.llm.router import LLMRouter, Provider


class CountAdmission:
    def __init__(self) -> None:
        self.debits = 0

    def authorize(self) -> None:
        if not current_ai_owner():
            raise AssertionError("owner was not bound")

    def admit(self) -> None:
        self.debits += 1


def document(owner: str, suffix: str, text: str):
    store = InMemoryDocumentStore()
    doc = store.create(user_id=owner, filename=f"{suffix}.pdf", mime_type="application/pdf", size_bytes=1)
    chapter = ChapterRecord(f"chapter-{suffix}", doc.id, owner, "Concept", 1, 1, 1)
    store.replace_structure(doc.id, [chapter], [ChunkRecord(f"chunk-{suffix}", doc.id, owner, chapter.id, text, 1, 1)])
    return store.get_internal(doc.id)


@respx.mock
def test_router_cache_hits_are_free_and_scoped_to_owner_source_revision_prompt_and_policy():
    route = respx.post("https://provider.test/v1/chat/completions").mock(
        side_effect=[
            httpx.Response(200, json={"choices": [{"message": {"content": "first"}}]}),
            httpx.Response(200, json={"choices": [{"message": {"content": "second"}}]}),
            httpx.Response(200, json={"choices": [{"message": {"content": "third"}}]}),
            httpx.Response(200, json={"choices": [{"message": {"content": "fourth"}}]}),
        ]
    )
    admission = CountAdmission()
    cache = PrivateResponseCache(MemoryResponseCache(max_content_chars=1000, max_entries_per_user=50), 3600)
    router = LLMRouter(
        [Provider("primary", "https://provider.test/v1", "model-a", None)], cache=cache, admission=admission
    )
    first_doc = document("alice", "first", "source v1")
    updated_doc = replace(first_doc, chunks=[replace(first_doc.chunks[0], content="source v2")])
    messages = [{"role": "user", "content": "same request"}]

    with ai_scope("alice"), response_scope("chat", first_doc):
        assert router.complete(messages) == "first"
        router.accept_cache_candidate()
        assert router.complete(messages) == "first"
    assert admission.debits == 1 and route.call_count == 1

    # Identical prompts and source from a different account never share results.
    with ai_scope("bob"), response_scope("chat", document("bob", "other", "source v1")):
        assert router.complete(messages) == "second"
        router.accept_cache_candidate()
    assert admission.debits == 2 and route.call_count == 2

    with ai_scope("alice"), response_scope("chat", updated_doc):
        assert router.complete(messages) == "third"
        router.accept_cache_candidate()
    assert admission.debits == 3 and route.call_count == 3

    with ai_scope("alice"), response_scope("chat", first_doc, schema_version="2"):
        assert router.complete(messages) == "fourth"
        router.accept_cache_candidate()
    assert admission.debits == 4 and route.call_count == 4


@respx.mock
def test_cache_backend_outage_becomes_miss_but_still_uses_admission():
    class FailingStore:
        def get(self, *args):
            raise ConnectionError("offline")

        def put(self, *args):
            raise ConnectionError("offline")

        def invalidate_user(self, *args):
            raise ConnectionError("offline")

    route = respx.post("https://provider.test/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": "answer"}}]})
    )
    admission = CountAdmission()
    router = LLMRouter(
        [Provider("primary", "https://provider.test/v1", "model-a", None)],
        cache=PrivateResponseCache(FailingStore(), 60),
        admission=admission,
    )
    with ai_scope("alice"), response_scope("code-review"):
        assert router.complete([{"role": "user", "content": "code"}]) == "answer"
        router.accept_cache_candidate()
    assert route.call_count == 1 and admission.debits == 1


def test_source_scope_rejects_another_users_document_and_restores_nested_context():
    alice_doc = document("alice", "first", "private")
    bob_doc = document("bob", "second", "secret")
    with ai_scope("alice"), response_scope("outer", alice_doc):
        outer = current_response_scope()
        with response_scope("unscoped"):
            assert current_response_scope().document_id is None
        assert current_response_scope() == outer
        with pytest.raises(ValueError, match="does not belong"):
            with response_scope("wrong-owner", bob_doc):
                pass
        assert current_response_scope() == outer
    assert current_response_scope() is None and current_ai_owner() is None


@respx.mock
def test_invalid_schema_response_is_not_cached_and_fresh_request_can_recover():
    route = respx.post("https://provider.test/v1/chat/completions").mock(
        side_effect=[
            httpx.Response(200, json={"choices": [{"message": {"content": "not-json"}}]}),
            httpx.Response(
                200,
                json={
                    "choices": [
                        {"message": {"content": '{"chapters":[{"title":"Intro","start_page":1,"end_page":1}]}'}}
                    ]
                },
            ),
        ]
    )
    cache = PrivateResponseCache(MemoryResponseCache(max_content_chars=1000, max_entries_per_user=10), 60)
    router = LLMRouter([Provider("primary", "https://provider.test/v1", "model-a", None)], cache=cache)
    with ai_scope("alice"), response_scope("outline", schema_version="outline-v1"):
        with pytest.raises(StructuredOutputError):
            complete_validated(router, ChapterOutlineList, "system", "same request", max_attempts=1)
        parsed = complete_validated(router, ChapterOutlineList, "system", "same request")
        assert parsed.chapters[0].title == "Intro"
        assert complete_validated(router, ChapterOutlineList, "system", "same request").chapters[0].title == "Intro"
    assert route.call_count == 2


@respx.mock
def test_background_job_owner_and_source_scope_reuse_private_cache():
    route = respx.post("https://provider.test/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": "reviewed"}}]})
    )
    admission = CountAdmission()
    router = LLMRouter(
        [Provider("primary", "https://provider.test/v1", "model-a", None)],
        cache=PrivateResponseCache(MemoryResponseCache(max_content_chars=1000, max_entries_per_user=10), 60),
        admission=admission,
    )
    doc = document("alice", "job", "private source")
    jobs = InMemoryJobStore()

    def generate(payload):
        with response_scope("chapter-summary", doc, schema_version="summary-v1"):
            answer = router.complete([{"role": "user", "content": "same work"}])
            router.accept_cache_candidate()
            return {"answer": answer}

    worker = Worker(jobs, {"generate": generate})
    jobs.add(Job("one", "generate", {"user_id": "alice"}))
    jobs.add(Job("two", "generate", {"user_id": "alice"}))
    now = datetime.now(UTC)
    assert worker.process_one(now) and worker.process_one(now)
    assert route.call_count == 1 and admission.debits == 1
    assert current_ai_owner() is None and current_response_scope() is None


@pytest.mark.parametrize("dimension", ["model", "prompt", "namespace", "language", "variant", "policy"])
@respx.mock
def test_model_prompt_language_variant_and_policy_changes_miss(dimension):
    route = respx.post("https://provider.test/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": "answer"}}]})
    )
    router = LLMRouter(
        [Provider("primary", "https://provider.test/v1", "model-a", None)],
        cache=PrivateResponseCache(MemoryResponseCache(max_content_chars=1000, max_entries_per_user=10), 60),
    )
    messages = [{"role": "user", "content": "same request"}]
    with ai_scope("alice"), response_scope("code-review", language="python"):
        router.complete(messages)
        router.accept_cache_candidate()
    if dimension == "model":
        router.providers[0].model = "model-b"
    elif dimension == "prompt":
        messages = [{"role": "user", "content": "different request"}]
    elif dimension == "policy":
        router.cache_policy_version = "next-policy"
    with (
        ai_scope("alice"),
        response_scope(
            "new-feature" if dimension == "namespace" else "code-review",
            language="bangla" if dimension == "language" else "python",
            variant="eli5" if dimension == "variant" else "default",
        ),
    ):
        router.complete(messages)
        router.accept_cache_candidate()
    assert route.call_count == 2
