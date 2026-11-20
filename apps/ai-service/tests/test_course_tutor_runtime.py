"""Regression coverage for the tutor imports required by the deployed app."""

import importlib.util
import json
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.courses.store import MemoryCourseStore
from app.courses.tutor import answer_course_question, answer_with_router, stream_answer_with_router
from app.documents.store import InMemoryDocumentStore
from app.llm.admission import ai_scope
from app.llm.cache_scope import PrivateResponseCache
from app.llm.response_cache import MemoryResponseCache
from app.llm.router import AllProvidersFailed, LLMRouter, Provider
from app.settings import Settings


def _lesson():
    documents = InMemoryDocumentStore()
    store = MemoryCourseStore(documents)
    session = store.enroll("tutor-test", "python-foundations")
    document = documents.get_for_user(str(session.document_id), "tutor-test")
    return session, document


@pytest.mark.parametrize(
    "output",
    [
        {"answer": "A name identifies a value.", "evidence_ids": [["nested-invalid-id"]]},
        {"answer": "A name identifies a value.", "evidence_ids": [{"id": "invalid"}]},
        {"answer": "A name identifies a value.", "evidence_ids": ["not-in-the-active-lesson"]},
        {"answer": 123, "evidence_ids": []},
        {"answer": " ", "evidence_ids": []},
        {"answer": "A name identifies a value.", "evidence_ids": [], "extra": "untrusted"},
        ["not", "an", "object"],
    ],
)
def test_invalid_provider_json_uses_grounded_fallback_without_accepting_cache(monkeypatch, output):
    session, document = _lesson()
    accepted = []
    monkeypatch.setattr("app.courses.tutor.accept_cache_candidate", lambda: accepted.append(True))

    class Router:
        def complete(self, messages):
            assert len(messages) == 2 and messages[0]["role"] == "system"
            assert "untrusted data" in messages[0]["content"]
            return json.dumps(output)

    with ai_scope("tutor-test"):
        result = answer_with_router(Router(), session, "Explain a name", document)
    assert result == answer_course_question(session, "Explain a name")
    assert not accepted


@respx.mock
def test_course_tutor_uses_shared_router_and_accepts_only_valid_private_cache_response():
    session, document = _lesson()
    evidence_id = session.evidence[0].id
    provider = respx.post("https://course-provider.test/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {"answer": "A name identifies a value.", "evidence_ids": [evidence_id]}
                            )
                        }
                    }
                ]
            },
        )
    )
    router = LLMRouter(
        [Provider("primary", "https://course-provider.test/v1", "fixture-model", None)],
        cache=PrivateResponseCache(MemoryResponseCache(max_content_chars=4000, max_entries_per_user=10), 60),
    )
    with ai_scope("tutor-test"):
        assert answer_with_router(router, session, "Explain a name", document) == (
            "A name identifies a value.",
            [evidence_id],
        )
        assert answer_with_router(router, session, "Explain a name", document)[0] == "A name identifies a value."
    assert provider.call_count == 1
    user_prompt = json.loads(provider.calls[0].request.content)["messages"][1]["content"]
    assert '"exercises"' not in user_prompt and '"checkpoint"' not in user_prompt


def test_course_tutor_provider_outage_is_explicit_and_does_not_erase_lesson():
    session, document = _lesson()

    class Router:
        def complete(self, messages):
            raise AllProvidersFailed("offline")

    with ai_scope("tutor-test"):
        answer, evidence_ids = answer_with_router(Router(), session, "Explain a name", document)
    assert answer.startswith("The AI tutor is temporarily unavailable. Related excerpt from this lesson:")
    assert evidence_ids and session.evidence[0].quote in answer
    assert session.conversation == [] and session.lesson.blocks


@pytest.mark.asyncio
async def test_course_tutor_stream_passes_active_source_scope_to_shared_router():
    session, document = _lesson()
    calls = []

    class Router:
        def stream_complete(self, messages, *, scope):
            calls.append((messages, scope))

            async def tokens():
                yield "A name "
                yield "identifies a value."

            return tokens()

    with ai_scope("tutor-test"):
        source, evidence_ids, stream = stream_answer_with_router(Router(), session, "Explain a name", document)
        assert "".join([token async for token in stream]) == "A name identifies a value."
    assert source == document and evidence_ids
    messages, scope = calls[0]
    assert scope.namespace == "course_tutor" and scope.document_id == document.id
    assert scope.variant == f"{session.release_id}:{session.lesson.id}"
    assert '"exercises"' not in messages[1]["content"] and '"checkpoint"' not in messages[1]["content"]


def test_deployment_entrypoint_starts_with_five_courses_and_learning_profile_in_safe_memory_mode(monkeypatch):
    # Execute the full entrypoint afresh, rather than only assembling a test
    # router. Explicit memory settings and a blocked connect prevent DB access.
    settings = Settings(
        _env_file=None,
        AI_SERVICE_DATABASE_URL="postgresql://test:test@127.0.0.1:1/test",
        AI_SERVICE_JOB_STORE="memory",
        AI_SERVICE_WORKER_ENABLED=False,
        AI_SERVICE_JWT_DEV_MODE=True,
        AI_SERVICE_JWT_JWKS_URL="http://127.0.0.1:1/test-jwks",
        AI_SERVICE_EMBEDDING_BACKEND="hash",
        AI_SERVICE_SENTRY_DSN=None,
        AI_SERVICE_OCR_ENABLED=False,
    )
    monkeypatch.setattr("app.settings.get_settings", lambda: settings)

    def no_database(*args, **kwargs):
        raise AssertionError("database access in memory smoke")

    monkeypatch.setattr("psycopg.connect", no_database)
    path = Path(__file__).resolve().parents[1] / "app" / "main.py"
    spec = importlib.util.spec_from_file_location("learning_runtime_smoke", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert isinstance(module.course_store, MemoryCourseStore)
    assert isinstance(module.documents, InMemoryDocumentStore)
    with TestClient(module.app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/api/learner-profile").status_code == 401
        headers = {"Authorization": "Bearer publication-smoke-test"}
        catalog = client.get("/api/courses", headers=headers)
        assert catalog.status_code == 200, catalog.text
        assert {course["slug"] for course in catalog.json()["courses"]} == {
            "python-foundations",
            "pytorch-fundamentals",
            "sql-query-foundations",
            "git-foundations",
            "practical-python-foundations",
        }
        profile = client.get("/api/learner-profile", headers=headers)
        assert profile.status_code == 200, profile.text
        assert profile.json() == {"profile": None}
