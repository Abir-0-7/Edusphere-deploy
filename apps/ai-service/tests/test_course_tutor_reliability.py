"""Acceptance for quick prompts, sourced refusals and provider failure recovery."""

import json
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.courses.contracts import CourseChatRequest
from app.courses.router import create_course_router
from app.courses.store import MemoryCourseStore
from app.courses.tutor import (
    LESSON_DECLINE,
    answer_course_question,
    answer_with_router,
    is_lesson_decline,
    stream_answer_with_router,
)
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, api_error_handler
from app.llm.router import AllProvidersFailed

EXPLAIN = "Explain this lesson in simpler terms."
EXAMPLE = "Walk me through an example from this lesson."
FOLLOW_UP = "Why does that matter?"


@pytest.fixture
def store():
    return MemoryCourseStore(InMemoryDocumentStore())


def test_quick_prompts_and_follow_up_use_active_evidence(store):
    session = store.enroll("learner", "python-foundations")
    allowed = {identifier for block in session.lesson.blocks for identifier in block.evidence_ids}

    def ask(question):
        current = store.get_session("learner", str(session.id))
        request = CourseChatRequest(id=uuid4(), revision=current.revision, question=question)
        return store.ask_tutor("learner", str(session.id), request)

    assert ask(FOLLOW_UP).evidence_ids == []
    explanation = ask(EXPLAIN)
    assert explanation.evidence_ids and set(explanation.evidence_ids) <= allowed
    example = ask(EXAMPLE)
    assert example.evidence_ids and set(example.evidence_ids) <= allowed
    assert ask(FOLLOW_UP).evidence_ids == example.evidence_ids
    assert ask("Could you explain it?").evidence_ids == example.evidence_ids
    assert ask("What is quantum gravity?").answer == LESSON_DECLINE
    assert ask(FOLLOW_UP).evidence_ids == []


def _stream_fixture(store, behavior):
    class Provider:
        async def stream_complete(self, messages, *, scope):
            assert LESSON_DECLINE in messages[0]["content"]
            assert EXPLAIN not in messages[0]["content"]
            assert EXPLAIN in messages[1]["content"]
            if behavior == "down":
                raise AllProvidersFailed("provider fixture")
            if behavior == "quota":
                raise ApiError("Quota exhausted", status_code=429)
            if behavior == "decline":
                yield "I don’t know based on "
                yield "this lesson."
                return
            yield "A name "
            raise ApiError("Tutor stream ended before completion", status_code=503)

    def streamer(owner, session, question):
        source = store.documents.get_for_user(str(session.document_id), owner)
        return stream_answer_with_router(Provider(), session, question, source)

    def user():
        return "learner"

    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(create_course_router(user, store, course_tutor_streamer=streamer))
    session = store.enroll("learner", "python-foundations")
    path = f"/api/course-enrollments/{session.id}"
    request = {"id": str(uuid4()), "revision": session.revision, "question": EXPLAIN}
    return TestClient(app), session, path, request


def _events(response):
    return [(event.removeprefix("event: "), json.loads(data.removeprefix("data: ")))
            for event, data in (frame.splitlines() for frame in response.text.strip().split("\n\n"))]


@pytest.mark.parametrize("behavior", ["decline", "down"])
def test_completed_stream_refusal_or_excerpt_replays_and_survives_reload(store, behavior):
    client, session, path, request = _stream_fixture(store, behavior)
    with client:
        events = _events(client.post(f"{path}/tutor/stream", json=request))
        assert events[0][0] == "token"
        event, done = events[-1]
        assert event == "done"
        restored = client.get(path).json()
        assistant = restored["conversation"][-1]
        assert assistant["content"] == done["answer"]
        assert assistant["evidence_ids"] == done["evidence_ids"]
        assert restored["lesson"]["id"] == session.lesson.id
        assert restored["completed_lesson_ids"] == session.completed_lesson_ids
        _, replay = _events(client.post(f"{path}/tutor/stream", json=request))[-1]
        assert replay == {**done, "replayed": True}
        assert len(client.get(path).json()["conversation"]) == 2

    if behavior == "decline":
        assert is_lesson_decline(done["answer"]) and done["evidence_ids"] == []
        assert done["answer"] == "".join(payload["text"] for kind, payload in events if kind == "token")
    else:
        assert done["answer"].startswith("The AI tutor is temporarily unavailable. Related excerpt")
        assert done["evidence_ids"]
        evidence = {item.id: item.quote for item in session.evidence}
        assert all(evidence[identifier] in done["answer"] for identifier in done["evidence_ids"])


@pytest.mark.parametrize("behavior", ["interrupted", "quota"])
def test_failed_stream_does_not_save_or_advance(store, behavior):
    client, session, path, request = _stream_fixture(store, behavior)
    with client:
        events = _events(client.post(f"{path}/tutor/stream", json=request))
        assert [kind for kind, _ in events] == (["token", "error"] if behavior == "interrupted" else ["error"])
        restored = client.get(path).json()
    assert restored["revision"] == session.revision
    assert restored["lesson"]["id"] == session.lesson.id
    assert restored["conversation"] == []


@pytest.mark.parametrize("provider_response", [
    '{"answer":"I don’t know based on this lesson.","evidence_ids":["py-names-evidence"]}',
    '{"answer":"Invalid citation structure.","evidence_ids":[{"id":"py-names-evidence"}]}',
])
def test_sync_tutor_validates_refusals_and_citation_types(store, provider_response):
    session = store.enroll("learner", "python-foundations")

    class Provider:
        def complete(self, messages):
            del messages
            return provider_response

    answer, evidence_ids = answer_with_router(Provider(), session, EXPLAIN, None)
    if "don’t know" in provider_response:
        assert answer == LESSON_DECLINE and evidence_ids == []
    else:
        assert answer.startswith("From this lesson:") and evidence_ids


def test_sync_outage_shows_excerpt_but_quota_failure_is_preserved(store):
    session = store.enroll("learner", "python-foundations")

    class Provider:
        def complete(self, messages):
            del messages
            raise AllProvidersFailed("fixture failure")

    answer, evidence_ids = answer_with_router(Provider(), session, EXPLAIN, None)
    assert answer.startswith("The AI tutor is temporarily unavailable.") and evidence_ids

    class Quota:
        def complete(self, messages):
            del messages
            raise ApiError("Quota exhausted", status_code=429)

    with pytest.raises(ApiError, match="Quota exhausted"):
        answer_with_router(Quota(), session, EXPLAIN, None)


def test_long_lesson_excerpt_stays_within_saved_conversation_limit(store):
    session = store.enroll("learner", "python-foundations")
    evidence = [item.model_copy(update={"quote": "A name identifies a value. " * 400}) for item in session.evidence]
    session = session.model_copy(update={"evidence": evidence})
    answer, evidence_ids = answer_course_question(session, EXPLAIN, provider_unavailable=True)
    assert len(answer) <= 4000 and answer.endswith("…") and evidence_ids


def test_refusal_detection_does_not_replace_an_answer_that_merely_quotes_a_refusal():
    assert is_lesson_decline("  I don’t know   based on this lesson. ")
    assert not is_lesson_decline("I don't know based on this lesson is an example of a refusal.")


@pytest.mark.asyncio
async def test_example_prompt_includes_public_worked_example_without_assessment_material(store):
    session = store.enroll("learner", "python-foundations")
    example = next(block for block in session.lesson.blocks if block.type == "code")
    captured = []

    class Provider:
        def complete(self, messages):
            captured.append(messages)
            return json.dumps({"answer": "The lesson example groups boxes.", "evidence_ids": example.evidence_ids})

        async def stream_complete(self, messages, *, scope):
            captured.append(messages)
            yield "The lesson example groups boxes."

    answer_with_router(Provider(), session, EXAMPLE, None)
    _, ids, stream = stream_answer_with_router(Provider(), session, EXAMPLE, None)
    assert ids == example.evidence_ids
    assert [chunk async for chunk in stream] == ["The lesson example groups boxes."]
    for system, user in captured:
        assert example.content not in system["content"]
        assert json.dumps(example.content)[1:-1] in user["content"]
        assert session.lesson.checkpoint.prompt not in user["content"]
        assert all(exercise.prompt not in user["content"] for exercise in session.lesson.practice)
        assert "<<<UNTRUSTED_DOCUMENT_TEXT>>>" in user["content"]
