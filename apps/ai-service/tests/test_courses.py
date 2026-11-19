"""Course publication, ownership, exact replay and independent learning gates."""

import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.ai.sm2 import Sm2State, due_date
from app.ai.sm2 import review as review_sm2
from app.courses import engine
from app.courses.catalog import DIAGNOSTIC, catalog, python_foundations, stable_id
from app.courses.contracts import CourseChatRequest, CourseRelease, ExerciseKey
from app.courses.router import create_course_router
from app.courses.store import MemoryCourseStore
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, InvalidInput, NotFound, api_error_handler


@pytest.fixture()
def store():
    return MemoryCourseStore(InMemoryDocumentStore())


def payload(session, answer, exercise_id=None, **extra):
    return {
        "id": str(uuid.uuid4()),
        "revision": session.revision,
        "exercise_id": exercise_id or session.lesson.checkpoint.id,
        "answer": answer,
        **extra,
    }


def key_for(store, session, identifier=None):
    release = store._releases[str(session.release_id)]
    return next(ex for ex in release.exercises if ex.id == (identifier or session.lesson.checkpoint.id))


def complete(store, user, slug):
    session = store.enroll(user, slug)
    while True:
        result = store.action(user, str(session.id), "attempt", payload(session, key_for(store, session).answer))
        session = store.get_session(user, str(session.id))
        if result["course_complete"]:
            return session
        session = store.advance(user, str(session.id), session.revision)


def test_original_catalog_is_static_valid_and_keys_do_not_reach_learner(store):
    assert [course.slug for course in store.list_courses("new")] == [
        "python-foundations",
        "pytorch-fundamentals",
        "sql-query-foundations",
        "git-foundations",
        "practical-python-foundations",
    ]
    for course in catalog():
        if course.size == "full":
            assert len(course.lessons) == 16
            assert len(course.exercises) == 80
            continue
        assert course.size == "mini" and course.origin == "prebuilt"
        assert len(course.lessons) == 5
        assert len({ex.id for ex in course.exercises}) == 85
    session = store.enroll("new", "python-foundations")
    raw = session.model_dump(mode="json")
    assert raw["lesson"]["checkpoint"]["kind"] == "number"
    assert not ({"answer", "explanation", "hint", "correct"} & raw["lesson"]["checkpoint"].keys())
    assert "exercises" not in raw and "sources" not in raw


def test_enrollment_materializes_private_evidence_idempotently(store):
    first = store.enroll("a", "python-foundations")
    assert store.enroll("a", "python-foundations") == first
    other = store.enroll("b", "python-foundations")
    assert other.id != first.id and other.document_id != first.document_id
    doc = store.documents.get_for_user(str(first.document_id), "a")
    assert doc.status == "parsed" and len(doc.chapters) == len(doc.chunks) == 5
    assert store.documents.get_for_user(str(first.document_id), "b") is None
    for ref in first.evidence:
        chunk = next(chunk for chunk in doc.chunks if chunk.id == str(ref.chunk_id))
        assert ref.quote in chunk.content and chunk.chapter_id == str(ref.chapter_id)
        assert str(ref.document_id) == doc.id
    with pytest.raises(NotFound):
        store.get_session("b", str(first.id))


def test_new_release_does_not_change_pinned_enrollment():
    legacy = python_foundations().model_dump(mode="json")
    legacy.update(
        id=str(stable_id("python-foundations/release/1")),
        version="1",
        labs=[],
        assignments=[],
    )
    legacy_release = CourseRelease.model_validate(legacy)
    store = MemoryCourseStore(InMemoryDocumentStore(), releases=[legacy_release])
    store.save_release(legacy_release)
    first = store.enroll("a", "python-foundations")
    release = python_foundations()
    store.save_release(release)
    assert store.get_session("a", str(first.id)).course_title == "Python Foundations"
    second = store.enroll("a", "python-foundations")
    assert second.release_id != first.release_id
    assert second.release_id == release.id
    assert store.get_session("a", str(first.id)).release_id == first.release_id
    assert len(store.list_courses("a")) == 1


def test_published_content_and_release_identity_cannot_change(store):
    release = python_foundations().model_dump(mode="json")
    release["title"] = "Rewritten"
    with pytest.raises(InvalidInput, match="immutable"):
        store.save_release(CourseRelease.model_validate(release))
    release["version"] = "3"
    with pytest.raises(InvalidInput, match="identity"):
        store.save_release(CourseRelease.model_validate(release))


def test_private_draft_owner_access_and_publishing_cannot_cross_catalog(store):
    draft = python_foundations().model_dump(mode="json")
    draft.update(
        id=str(uuid.uuid4()),
        course_id=str(uuid.uuid4()),
        slug="my-python",
        user_id="a",
        visibility="private",
        status="draft",
        size="full",
        origin="hybrid",
    )
    release = CourseRelease.model_validate(draft)
    store.save_release(release)
    assert store.get_release("my-python", "a").size == "full"
    assert len(store.list_courses("a")) == 5
    with pytest.raises(NotFound):
        store.get_release("my-python", "b")
    with pytest.raises(InvalidInput, match="not published"):
        store.enroll("a", "my-python")
    draft["visibility"] = "catalog"
    with pytest.raises(ValidationError, match="ownership"):
        CourseRelease.model_validate(draft)
    draft["visibility"], draft["status"] = "private", "published"
    store.save_release(CourseRelease.model_validate(draft))
    assert store.enroll("a", "my-python").course_slug == "my-python"
    with pytest.raises(NotFound):
        store.enroll("b", "my-python")


@pytest.mark.parametrize(
    "mutation, message",
    [
        (lambda r: r["objectives"][0].update(prerequisites=[r["objectives"][-1]["id"]]), "cycle"),
        (lambda r: r["objectives"][0].update(prerequisites=["missing"]), "unknown objective"),
        (lambda r: r["evidence"][0].update(quote="Fabricated quotation"), "quote"),
        (lambda r: r["lessons"][0]["blocks"][0].update(evidence_ids=["missing"]), "evidence"),
        (lambda r: r["modules"][0].update(lesson_ids=["missing"]), "modules"),
    ],
)
def test_curriculum_validation_rejects_broken_links(mutation, message):
    data = python_foundations().model_dump(mode="json")
    mutation(data)
    with pytest.raises(ValidationError, match=message):
        CourseRelease.model_validate(data)


def test_practice_continue_and_wrong_answer_do_not_complete_lesson(store):
    session = store.enroll("a", "python-foundations")
    with pytest.raises(InvalidInput, match="independent"):
        store.advance("a", str(session.id), 0)
    practice = session.lesson.practice[0]
    result = store.action(
        "a",
        str(session.id),
        "attempt",
        payload(session, key_for(store, session, practice.id).answer, exercise_id=practice.id),
    )
    assert result["correct"] and not result["independent"] and not result["lesson_complete"]
    session = store.get_session("a", str(session.id))
    result = store.action("a", str(session.id), "attempt", payload(session, -12345))
    assert not result["correct"] and not result["lesson_complete"]
    assert store.get_session("a", str(session.id)).completed_lesson_ids == []


@pytest.mark.parametrize("kind", ["hint", "reveal"])
def test_assisted_checkpoint_is_replaced_and_cannot_complete_lesson(store, kind):
    session = store.enroll("a", "python-foundations")
    old = key_for(store, session)
    request = {"id": str(uuid.uuid4()), "revision": session.revision, "exercise_id": old.id, "kind": kind}
    assistance = store.action("a", str(session.id), "assistance", request)
    assert assistance["revision"] == 1
    fresh = store.get_session("a", str(session.id))
    assert fresh.lesson.checkpoint.id != old.id
    with pytest.raises(InvalidInput, match="active"):
        store.action("a", str(session.id), "attempt", payload(fresh, old.answer, exercise_id=old.id))
    assert not fresh.completed_lesson_ids
    result = store.action("a", str(session.id), "attempt", payload(fresh, key_for(store, fresh).answer))
    assert result["independent"] and result["lesson_complete"]
    assert store.action("a", str(session.id), "assistance", request) == {**assistance, "replayed": True}


def test_malformed_stale_and_future_exercises_do_not_mutate_progress(store):
    session = store.enroll("a", "python-foundations")
    for request in [
        payload(session, "13"),
        payload(session, True),
        payload(session, [], revision=1),
        payload(session, 1, exercise_id="py-functions-checkpoint-1"),
    ]:
        with pytest.raises(InvalidInput):
            store.action("a", str(session.id), "attempt", request)
        assert store.get_session("a", str(session.id)) == session


def test_action_replay_is_exact_after_later_actions_and_cross_payload_reuse_fails(store):
    session = store.enroll("a", "python-foundations")
    request = payload(session, -1)
    first = store.action("a", str(session.id), "attempt", request)
    session = store.get_session("a", str(session.id))
    store.action("a", str(session.id), "attempt", payload(session, key_for(store, session).answer))
    assert store.action("a", str(session.id), "attempt", request) == {**first, "replayed": True}
    with pytest.raises(InvalidInput, match="different"):
        store.action("a", str(session.id), "attempt", {**request, "answer": 999})
    assert store.get_session("a", str(session.id)).revision == 2


def test_concurrent_duplicate_enrollment_and_attempt_are_committed_once(store):
    with ThreadPoolExecutor(max_workers=6) as pool:
        sessions = list(pool.map(lambda _: store.enroll("a", "python-foundations"), range(12)))
    assert len({str(session.id) for session in sessions}) == 1 and len(store.documents._docs) == 1
    session = sessions[0]
    request = payload(session, key_for(store, session).answer)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: store.action("a", str(session.id), "attempt", request), range(12)))
    assert sum(not result["replayed"] for result in results) == 1
    assert store.get_session("a", str(session.id)).revision == 1


def test_python_completion_or_valid_diagnostic_unlocks_pytorch(store):
    with pytest.raises(InvalidInput, match="diagnostic"):
        store.enroll("a", "pytorch-fundamentals")
    assert complete(store, "a", "python-foundations").status == "completed"
    assert store.enroll("a", "pytorch-fundamentals").lesson.id == "pt-tensors"
    diagnostic = {key: answer for key, (_, answer) in DIAGNOSTIC.items()}
    assert store.enroll("b", "pytorch-fundamentals", diagnostic).lesson.id == "pt-tensors"
    assert "python-foundations" not in store.completed_slugs("b")
    with pytest.raises(InvalidInput):
        store.enroll("c", "pytorch-fundamentals", {**diagnostic, "expression": "14"})


def test_python_and_pytorch_catalog_complete_review_and_resume_flow(store):
    python = store.enroll("fresh-learner", "python-foundations")
    assert python.lesson.id == "py-values"
    python = complete(store, "fresh-learner", "python-foundations")
    assert python.status == "completed"

    pytorch = store.enroll("fresh-learner", "pytorch-fundamentals")
    assert pytorch.lesson.id == "pt-tensors"
    pytorch = complete(store, "fresh-learner", "pytorch-fundamentals")
    assert pytorch.status == "completed"

    cards = store.documents.list_flashcards(str(pytorch.document_id), "fresh-learner")
    assert len(cards) == 5
    today = datetime.now(UTC).date().isoformat()
    due = store.documents.due_flashcards("fresh-learner", today)
    assert len(due) == 10
    card = due[0]
    next_state = review_sm2(Sm2State(card["ease_factor"], card["interval_days"], card["repetitions"]), 5)
    assert store.documents.add_review(card_id=card["id"], user_id="fresh-learner", grade=5)
    store.documents.update_flashcard_sm2(
        card["id"],
        ease=next_state.ease_factor,
        interval_days=next_state.interval_days,
        reps=next_state.repetitions,
        due=due_date(datetime.now(UTC).date(), next_state.interval_days),
    )
    assert next_state.repetitions == 1
    assert len(store.documents.due_flashcards("fresh-learner", today)) == 9
    assert store.get_session("fresh-learner", str(pytorch.id)) == pytorch


def test_independent_checkpoint_hands_off_a_source_linked_review_card(store):
    session = store.enroll("learner", "python-foundations")
    exercise = key_for(store, session)
    result = store.action("learner", str(session.id), "attempt", payload(session, exercise.answer))
    assert result["independent"] and result["lesson_complete"]
    cards = store.documents.list_flashcards(str(session.document_id), "learner")
    assert len(cards) == 1
    assert cards[0]["chapter_id"] == str(session.evidence[0].chapter_id)
    assert cards[0]["source_chunk_id"] == str(session.evidence[0].chunk_id)


def test_notes_and_bookmarks_are_owner_scoped_revisioned_and_resume(store):
    from app.courses.contracts import StudyNotesRequest

    session = store.enroll("learner", "python-foundations")
    evidence = session.evidence[0]
    request = StudyNotesRequest(
        revision=session.revision,
        notes=[{"id": str(uuid.uuid4()), "lesson_id": session.lesson.id, "text": "Remember this."}],
        bookmarks=[{"lesson_id": session.lesson.id, "evidence_id": evidence.id}],
    )
    saved = store.update_study_notes("learner", str(session.id), request)
    assert saved.notes[0].text == "Remember this."
    assert saved.bookmarks[0].evidence_id == evidence.id
    assert store.get_session("learner", str(session.id)) == saved
    with pytest.raises(NotFound):
        store.get_session("another", str(session.id))
    with pytest.raises(InvalidInput, match="changed"):
        store.update_study_notes("learner", str(session.id), request)


def test_all_catalog_answer_keys_pass_their_declared_deterministic_rule():
    for release in catalog():
        for exercise in release.exercises:
            assert engine.grade(exercise, exercise.answer)


def test_ordered_and_partial_multi_answers():
    base = python_foundations().exercises[0].model_dump()
    base.update(kind="ordered", choices=[{"id": "a", "label": "A"}, {"id": "b", "label": "B"}], answer=["a", "b"])
    exercise = ExerciseKey.model_validate(base)
    assert engine.grade(exercise, ["a", "b"])
    assert not engine.grade(exercise, ["b", "a"])
    with pytest.raises(InvalidInput):
        engine.grade(exercise, ["a"])
    multiple = exercise.model_copy(update={"kind": "multiple"})
    assert not engine.grade(multiple, ["a"])


def test_routes_validate_requests_hide_keys_and_scope_sessions(store):
    def user(x_user: str = Header(default="a")):
        return x_user

    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(create_course_router(user, store))
    with TestClient(app) as client:
        response = client.get("/api/courses")
        assert response.status_code == 200
        assert {course["slug"] for course in response.json()["courses"]} == {
            "python-foundations",
            "pytorch-fundamentals",
            "sql-query-foundations",
            "git-foundations",
            "practical-python-foundations",
        }
        for slug in ["python-foundations", "pytorch-fundamentals", "sql-query-foundations", "git-foundations"]:
            public_detail = client.get(f"/api/courses/{slug}")
            assert public_detail.status_code == 200
            assert public_detail.json()["labs"] and public_detail.json()["assignments"]
            for lab in public_detail.json()["labs"]:
                assert not {"expected_columns", "expected_rows", "sql_targets"} & lab.keys()
        detail = client.get("/api/courses/pytorch-fundamentals").json()
        assert detail["prerequisites"] == ["python-foundations"] and not detail["prerequisite_met"]
        assert client.post("/api/courses/pytorch-fundamentals/enroll", json={}).status_code == 400
        questions = client.get("/api/courses/pytorch-fundamentals/diagnostic").json()["questions"]
        assert len(questions) == 5 and all(set(q) == {"id", "prompt", "kind"} for q in questions)
        session = client.post("/api/courses/python-foundations/enroll", json={}).json()
        base = f"/api/course-enrollments/{session['id']}"
        assert client.get(base, headers={"x-user": "b"}).status_code == 404
        assert client.post(base + "/advance", json={"revision": 0}).status_code == 400
        request = {
            "id": str(uuid.uuid4()),
            "revision": 0,
            "exercise_id": session["lesson"]["checkpoint"]["id"],
            "answer": 13,
        }
        assert client.post(base + "/attempts", json={**request, "answer": True}).status_code == 422
        assert client.post(base + "/attempts", json={**request, "revision": False}).status_code == 422
        result = client.post(base + "/attempts", json=request)
        assert result.status_code == 200 and result.json()["lesson_complete"]
        assert client.post(base + "/attempts", json=request).json()["replayed"]
        assert client.post(base + "/advance", json={"revision": 0}).status_code == 409
        restored = client.get(base).json()
        assert restored["revision"] == 1
        assert restored["last_action"]["answer"] == 13
        assert restored["last_action"]["id"] == request["id"]
        assert '"answer"' not in json.dumps(restored["lesson"]) and '"hint"' not in json.dumps(restored["lesson"])
        assert client.get("/api/course-enrollments").json()["sessions"] == [restored]
        assert client.get("/api/course-enrollments", headers={"x-user": "b"}).json()["sessions"] == []
        assert client.get("/openapi.json").json()["paths"][base.replace(session["id"], "{enrollment_id}")]


def test_tutor_is_grounded_owner_scoped_replay_safe_and_bounded(store):
    from app.courses.contracts import CourseChatRequest

    session = store.enroll("learner", "python-foundations")
    request = CourseChatRequest(
        id=uuid.uuid4(), revision=session.revision, question=f"Explain {session.evidence[0].quote}"
    )
    result = store.ask_tutor("learner", str(session.id), request)
    assert result.evidence_ids and "name identifies" in result.answer.lower()
    assert store.ask_tutor("learner", str(session.id), request).replayed
    restored = store.get_session("learner", str(session.id))
    assert len(restored.conversation) == 2 and restored.conversation[0].content == request.question
    follow_up = CourseChatRequest(id=uuid.uuid4(), revision=restored.revision, question="Why?")
    follow_up_result = store.ask_tutor("learner", str(session.id), follow_up)
    assert follow_up_result.evidence_ids and "name identifies" in follow_up_result.answer.lower()
    restored = store.get_session("learner", str(session.id))
    with pytest.raises(NotFound):
        store.ask_tutor("another", str(session.id), request)
    unsupported = CourseChatRequest(id=uuid.uuid4(), revision=restored.revision, question="What is quantum gravity?")
    declined = store.ask_tutor("learner", str(session.id), unsupported)
    assert declined.evidence_ids == [] and declined.answer.startswith("I don't know")
    current = store.get_session("learner", str(session.id))
    for _index in range(25):
        ask = CourseChatRequest(id=uuid.uuid4(), revision=current.revision, question="Explain names")
        store.ask_tutor("learner", str(session.id), ask)
        current = store.get_session("learner", str(session.id))
    assert len(current.conversation) <= 40


def test_tutor_route_persists_conversation_and_declines_unsupported(store):
    def user(x_user: str = Header(default="a")):
        return x_user

    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(create_course_router(user, store))
    with TestClient(app) as client:
        session = client.post("/api/courses/python-foundations/enroll", json={}).json()
        path = f"/api/course-enrollments/{session['id']}/tutor"
        request = {"id": str(uuid.uuid4()), "revision": 0, "question": "Explain a name"}
        response = client.post(path, json=request)
        assert response.status_code == 200 and response.json()["evidence_ids"]
        assert client.post(path, json=request).json()["replayed"]
        unsupported = {"id": str(uuid.uuid4()), "revision": 1, "question": "What is quantum gravity?"}
        assert client.post(path, json=unsupported).json()["evidence_ids"] == []
        stream = client.post(
            path + "/stream",
            json={"id": str(uuid.uuid4()), "revision": 2, "question": "What is a name?"},
        )
        assert stream.status_code == 200 and "event: done" in stream.text


def test_provider_stream_route_commits_only_after_provider_finishes(store):
    def user(x_user: str = Header(default="a")):
        return x_user

    async def tokens():
        yield "A name "
        yield "identifies a value."

    def streamer(owner, session, question):
        del owner, question
        document = store.documents.get_for_user(str(session.document_id), "a")
        return document, [session.evidence[0].id], tokens()

    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    course_router = create_course_router(user, store, course_tutor_streamer=streamer)
    app.include_router(course_router)
    with TestClient(app) as client:
        session = client.post("/api/courses/python-foundations/enroll", json={}).json()
        path = f"/api/course-enrollments/{session['id']}/tutor/stream"
        response = client.post(
            path,
            json={"id": str(uuid.uuid4()), "revision": 0, "question": "What does a name identify?"},
        )
        assert response.status_code == 200
        assert "event: token" in response.text and "event: done" in response.text
        saved = client.get(f"/api/course-enrollments/{session['id']}").json()
        assert len(saved["conversation"]) == 2 and saved["revision"] == 1


@pytest.mark.asyncio
async def test_canceled_course_provider_stream_is_not_saved(store):
    import asyncio

    def user(x_user: str = Header(default="a")):
        return x_user

    closed = []

    async def tokens():
        try:
            yield "A name "
            await asyncio.Event().wait()
            yield "identifies a value."
        finally:
            closed.append(True)

    def streamer(owner, session, question):
        del owner, question
        document = store.documents.get_for_user(str(session.document_id), "a")
        return document, [session.evidence[0].id], tokens()

    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    course_router = create_course_router(user, store, course_tutor_streamer=streamer)
    app.include_router(course_router)

    class ConnectedRequest:
        async def is_disconnected(self):
            return False

    session = store.enroll("a", "python-foundations")
    request = CourseChatRequest(id=uuid.uuid4(), revision=session.revision, question="What does a name identify?")
    route = next(route for route in course_router.routes if route.path.endswith("/tutor/stream"))
    response = await route.endpoint(session.id, request, ConnectedRequest(), "a")
    iterator = response.body_iterator
    first = await anext(iterator)
    assert "event: token" in first
    await iterator.aclose()
    assert store.get_session("a", str(session.id)).conversation == []
    assert closed == [True]
