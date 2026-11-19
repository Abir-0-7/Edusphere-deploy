"""Pinned examples, repeat-error remediation, and independent assessment."""

import os
import uuid

import pytest
from fastapi.testclient import TestClient

from app.courses.adaptation import adaptation_for_session
from app.courses.catalog import python_foundations
from app.courses.contracts import CourseChatRequest
from app.courses.store import MemoryCourseStore, PgCourseStore
from app.documents.pg_store import PgDocumentStore
from app.documents.store import InMemoryDocumentStore
from app.errors import InvalidInput, NotFound
from app.main import app


@pytest.fixture()
def store():
    return MemoryCourseStore(InMemoryDocumentStore())


def _request(session, exercise, answer):
    return {"id": str(uuid.uuid4()), "revision": session.revision, "exercise_id": exercise.id, "answer": answer}


def _session(store, session):
    return store.get_session("learner", str(session.id))


def _submit(store, session, request):
    return store.action("learner", str(session.id), "attempt", request)


def test_role_depth_and_pace_leave_pinned_objectives_evidence_and_rubrics_unchanged(store):
    release = python_foundations()
    canonical_hash = release.content_hash()
    canonical = store.enroll("learner", release.slug)
    while True:
        analyst = adaptation_for_session(canonical, role="analyst", explanation_depth="guided", pace="short_sessions")
        developer = adaptation_for_session(canonical, role="developer", explanation_depth="concise")
        assert canonical.adaptation is None
        for session in (analyst, developer):
            assert session.model_dump(exclude={"adaptation"}) == canonical.model_dump(exclude={"adaptation"})
            assert session.adaptation
            assert [item.objective_id for item in session.adaptation.variants] == canonical.lesson.objective_ids
            source_ids = {item.id for item in canonical.evidence}
            assert all(set(item.evidence_ids) <= source_ids for item in session.adaptation.variants)
        analyst_variant, developer_variant = analyst.adaptation.variants[0], developer.adaptation.variants[0]
        assert analyst_variant.example_title != developer_variant.example_title
        assert analyst_variant.example != developer_variant.example
        assert analyst_variant.depth_note != developer_variant.depth_note
        assert analyst_variant.pace_note != developer_variant.pace_note
        # Both contexts use the same small calculation or logic and same checkpoint.
        checkpoint = canonical.lesson.checkpoint
        assert checkpoint == analyst.lesson.checkpoint == developer.lesson.checkpoint
        key = next(exercise for exercise in release.exercises if exercise.id == checkpoint.id)
        result = _submit(store, canonical, _request(canonical, checkpoint, key.answer))
        assert result["correct"] and result["independent"]
        assert release.content_hash() == canonical_hash
        if result["course_complete"]:
            break
        canonical = store.advance("learner", str(canonical.id), result["revision"])


def test_role_variant_does_not_reinterpret_another_pinned_release(store):
    canonical = store.enroll("learner", "python-foundations")
    other_release = canonical.model_copy(update={"release_id": uuid.uuid4()})
    assert adaptation_for_session(other_release, role="analyst") == other_release


def test_profile_preferences_change_the_session_overlay_without_reenrolling():
    headers = {"Authorization": f"Bearer adaptation-profile-{uuid.uuid4()}"}
    profile = {
        "goal_kind": "career",
        "goal": "Data analyst",
        "familiarity": "new",
        "weekly_minutes": 120,
        "deadline": None,
        "language": "en",
        "accessibility": {"reduced_motion": False, "larger_text": False, "text_alternative": True},
        "explanation_depth": "guided",
        "pace": "short_sessions",
    }
    client = TestClient(app, headers=headers)
    response = client.post("/api/courses/python-foundations/enroll", json={"diagnostic_answers": None})
    assert response.status_code == 200
    base = response.json()
    assert base["adaptation"] is None
    url = f"/api/course-enrollments/{base['id']}"

    assert client.put("/api/learner-profile", json=profile).status_code == 200
    response = client.get(url)
    assert response.status_code == 200
    analyst = response.json()
    assert analyst["adaptation"]["role"] == "analyst"
    assert analyst["adaptation"]["explanation_depth"] == "guided"
    assert analyst["adaptation"]["pace"] == "short_sessions"

    edited = {**profile, "role_variant": "developer", "explanation_depth": "concise", "pace": "standard"}
    assert client.put("/api/learner-profile", json=edited).status_code == 200
    response = client.get(url)
    assert response.status_code == 200
    developer = response.json()
    assert developer["adaptation"]["role"] == "developer"
    assert developer["adaptation"]["explanation_depth"] == "concise"
    assert developer["adaptation"]["pace"] == "standard"
    for session in (analyst, developer):
        assert {key: value for key, value in session.items() if key != "adaptation"} == {
            key: value for key, value in base.items() if key != "adaptation"
        }


def test_repeat_errors_gate_a_fresh_unaided_checkpoint_and_are_replay_safe(store):
    canonical_release = python_foundations()
    session = store.enroll("learner", canonical_release.slug)
    first = session.lesson.checkpoint
    first_request = _request(session, first, -1)
    incorrect = _submit(store, session, first_request)
    assert not incorrect["correct"]
    assert _submit(store, session, first_request) == {**incorrect, "replayed": True}
    session = _session(store, session)
    assert session.remediation is None
    assert store.misconception_counts("learner") == {"py-values-objective": 1}

    with pytest.raises(InvalidInput):
        _submit(store, session, _request(session, first, "not a number"))
    assert _session(store, session) == session
    _submit(store, session, _request(session, first, -1))
    session = _session(store, session)
    assert session.remediation is not None and session.remediation.step == "bridge"
    assert session.remediation.objective_id == "py-values-objective"
    assert session.lesson.checkpoint is None and not session.lesson.practice
    assert session.lessons[0].objective_ids == ["py-values-objective"]
    assert session.lessons[0].demonstrated_objective_ids == []
    assert not {"answer", "explanation", "hint"} & session.remediation.exercise.model_dump().keys()
    assert set(session.remediation.evidence_ids) <= {item.id for item in session.evidence}
    assert _session(store, session) == session

    with pytest.raises(NotFound):
        store.get_session("other", str(session.id))
    assert store.misconception_counts("other") == {}
    assert store.misconception_counts("learner") == {"py-values-objective": 2}
    with pytest.raises(InvalidInput, match="remediation"):
        _submit(store, session, _request(session, first, 13))
    with pytest.raises(InvalidInput, match="independent"):
        store.advance("learner", str(session.id), session.revision)

    bridge = session.remediation.exercise
    wrong = _submit(store, session, _request(session, bridge, 1))
    assert not wrong["correct"] and not wrong["independent"]
    session = _session(store, session)
    assert session.remediation.step == "bridge"
    bridge_pass = _submit(store, session, _request(session, bridge, 13))
    assert bridge_pass["correct"] and not bridge_pass["independent"] and not bridge_pass["lesson_complete"]
    session = _session(store, session)
    assert session.remediation.step == "checkpoint"
    fresh = session.remediation.exercise
    assert fresh == session.lesson.checkpoint
    assert fresh.id != first.id and fresh.prompt != first.prompt
    assert session.lessons[0].demonstrated_objective_ids == []
    assert store.documents.list_flashcards(str(session.document_id), "learner") == []
    with pytest.raises(InvalidInput, match="without answer assistance"):
        store.action(
            "learner",
            str(session.id),
            "assistance",
            {"id": str(uuid.uuid4()), "revision": session.revision, "exercise_id": fresh.id, "kind": "reveal"},
        )
    tutor_request = CourseChatRequest(id=uuid.uuid4(), revision=session.revision, question=fresh.prompt)
    with pytest.raises(InvalidInput, match="without tutor assistance"):
        store.get_tutor_result("learner", str(session.id), tutor_request)
    with pytest.raises(InvalidInput, match="without tutor assistance"):
        store.ask_tutor("learner", str(session.id), tutor_request)
    assert _session(store, session) == session
    key = next(exercise for exercise in canonical_release.exercises if exercise.id == fresh.id)
    independent = _submit(store, session, _request(session, fresh, key.answer))
    assert independent["correct"] and independent["independent"] and independent["lesson_complete"]
    session = _session(store, session)
    assert session.remediation is None
    assert session.lessons[0].demonstrated_objective_ids == [session.lesson.objective_ids[0]]
    assert store.misconception_counts("learner") == {"py-values-objective": 2}
    assert len(store.documents.list_flashcards(str(session.document_id), "learner")) == 1
    available = tutor_request.model_copy(update={"revision": session.revision})
    assert store.ask_tutor("learner", str(session.id), available).answer


def test_pg_remediation_resumes_and_only_independent_checkpoint_creates_a_card():
    url = os.environ.get("STUDYVAULT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("STUDYVAULT_TEST_DATABASE_URL not set")
    documents = PgDocumentStore(url)
    store = PgCourseStore(url)
    owner = documents.resolve_user(f"adaptation-{uuid.uuid4()}")
    other = documents.resolve_user(f"adaptation-other-{uuid.uuid4()}")
    try:
        release = python_foundations()
        store.save_release(release)
        session = store.enroll(owner, release.slug)
        original = session.lesson.checkpoint
        wrong_action_ids = []
        for _ in range(2):
            first = _request(session, original, -1)
            wrong_action_ids.append(uuid.UUID(first["id"]))
            result = store.action(owner, str(session.id), "attempt", first)
            assert not result["correct"]
            assert store.action(owner, str(session.id), "attempt", first) == {**result, "replayed": True}
            session = PgCourseStore(url).get_session(owner, str(session.id))
        assert store.misconception_counts(owner) == {"py-values-objective": 2}
        assert store.misconception_counts(other) == {}
        with store._connect() as conn, conn.cursor() as cursor:
            cursor.execute(
                "SELECT id, created_at FROM course_attempts WHERE id = ANY(%s) ORDER BY created_at, id",
                (wrong_action_ids,),
            )
            persisted_attempts = cursor.fetchall()
        assert [row[0] for row in persisted_attempts] == wrong_action_ids
        assert all(row[1].tzinfo is not None for row in persisted_attempts)
        assert persisted_attempts[0][1] <= persisted_attempts[1][1]
        assert session.remediation.step == "bridge"
        bridge = store.action(owner, str(session.id), "attempt", _request(session, session.remediation.exercise, 13))
        assert bridge["correct"] and not bridge["independent"]
        session = PgCourseStore(url).get_session(owner, str(session.id))
        assert session.remediation.step == "checkpoint"
        fresh = session.remediation.exercise
        assert fresh.id != original.id
        assert documents.list_flashcards(str(session.document_id), owner) == []
        answer = next(item.answer for item in release.exercises if item.id == fresh.id)
        passed = store.action(owner, str(session.id), "attempt", _request(session, fresh, answer))
        assert passed["correct"] and passed["independent"] and passed["lesson_complete"]
        cards = documents.list_flashcards(str(session.document_id), owner)
        assert len(cards) == 1 and cards[0]["source_chunk_id"] == str(session.evidence[0].chunk_id)
        session = PgCourseStore(url).get_session(owner, str(session.id))
        assert session.remediation is None
        assert session.lessons[0].demonstrated_objective_ids == ["py-values-objective"]
    finally:
        with documents._conn.cursor() as cursor:
            cursor.execute("DELETE FROM users WHERE id IN (%s,%s)", (owner, other))
        documents._conn.close()
