"""F05 required capstone activities remain ungraded and server authoritative."""

import copy
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.courses.catalog import python_foundations
from app.courses.catalog_candidates import candidates
from app.courses.contracts import AssignmentDraftRequest, CourseRelease
from app.courses.router import create_course_router
from app.courses.store import MemoryCourseStore, PgCourseStore
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, InvalidInput, NotFound, api_error_handler
from tests.test_source_versions_pg import source_database as source_database


def full_release(owner="owner"):
    data = python_foundations().model_dump(mode="json")
    objectives, evidence = data["objectives"], data["evidence"]
    data.update(id=str(uuid4()), course_id=str(uuid4()), slug=f"capstone-fixture-{uuid4().hex}",
                visibility="private", user_id=owner, size="full", required_assignment_ids=["capstone"],
                assignments=[{
                    "id": "capstone", "title": "Explain and check an algorithm", "prompt": "Design without execution.",
                    "deliverable": "A written analysis and test cases; human review is still required.",
                    "rubric": ["Explain a supported design.", "Use meaningful test cases."],
                    "objective_ids": [item["id"] for item in objectives[:2]],
                    "evidence_ids": [item["id"] for item in evidence[:2]],
                    "require_evidence": True,
                    "sections": [
                        {"id": identifier, "title": title, "prompt": f"Describe {title.lower()}.",
                         "min_chars": 20, "max_chars": 500}
                        for identifier, title in (("analysis", "Your analysis"), ("checks", "Your checks"))
                    ],
                    "criteria": [{
                        "id": "reasoning", "description": "The design follows the cited evidence.",
                        "objective_ids": [objectives[0]["id"]], "evidence_ids": [evidence[0]["id"]],
                        "review_guidance": "A human reviewer inspects the written reasoning; no code is executed.",
                    }],
                }])
    return CourseRelease.model_validate(data)


def setup_memory():
    release = full_release()
    documents = InMemoryDocumentStore()
    store = MemoryCourseStore(documents, releases=[release])
    session = store.enroll("owner", release.slug)
    return store, release, session


def finish_lessons(store, owner, release, session):
    for index, lesson in enumerate(release.lessons):
        assert session.lesson.id == lesson.id
        exercise = next(item for item in release.exercises if item.id == session.lesson.checkpoint.id)
        response = store.action(owner, str(session.id), "attempt", {
            "id": str(uuid4()), "revision": session.revision, "exercise_id": exercise.id, "answer": exercise.answer,
        })
        session = store.get_session(owner, str(session.id))
        if index + 1 < len(release.lessons):
            session = store.advance(owner, str(session.id), session.revision)
    assert response["course_complete"] is False
    assert session.status == "active" and len(session.completed_lesson_ids) == len(release.lessons)
    return session


def submission(session, release, **changes):
    return AssignmentDraftRequest.model_validate({
        "id": str(uuid4()), "revision": session.revision, "assignment_id": "capstone", "action": "submit",
        "sections": {"analysis": "Explain the supported algorithm and assumptions.",
                     "checks": "Describe normal, empty and boundary test cases."},
        "evidence_ids": [release.assignments[0].evidence_ids[0]], **changes,
    })


def test_required_capstone_completion_submission_replay_and_draft_reopen_are_not_grades():
    store, release, session = setup_memory()
    draft = submission(session, release, action="save", sections={"analysis": "An unfinished idea."})
    store.save_assignment("owner", str(session.id), draft)
    session = store.get_session("owner", str(session.id))
    assert session.assignment_sections["capstone"] == draft.sections and session.status == "active"
    session = finish_lessons(store, "owner", release, session)
    before_cards = copy.deepcopy(store.documents._flashcards)
    request = submission(session, release)
    result = store.save_assignment("owner", str(session.id), request)
    assert result.sections == request.sections and result.evidence_ids == request.evidence_ids
    assert result.status == "submitted" and not result.replayed
    completed = store.get_session("owner", str(session.id))
    assert completed.status == "completed" and completed.assignment_status["capstone"] == "submitted"
    assert completed.assignment_sections["capstone"] == request.sections
    assert store.save_assignment("owner", str(session.id), request).replayed
    assert store.get_session("owner", str(session.id)).revision == completed.revision
    assert store.documents._flashcards == before_cards
    assert not {"grade", "score", "passed", "xp", "executed"} & result.model_dump().keys()
    store.save_assignment("owner", str(session.id), submission(completed, release, action="save"))
    reopened = store.get_session("owner", str(session.id))
    assert reopened.status == "active" and reopened.assignment_status["capstone"] == "draft"


def test_submit_requires_checkpoints_valid_complete_sections_and_linked_evidence_without_partial_writes():
    store, release, session = setup_memory()
    before = copy.deepcopy(store._enrollments[str(session.id)])
    with pytest.raises(InvalidInput, match="checkpoints"):
        store.save_assignment("owner", str(session.id), submission(session, release))
    assert store._enrollments[str(session.id)] == before
    session = finish_lessons(store, "owner", release, session)
    before = copy.deepcopy(store._enrollments[str(session.id)])
    cases = [
        {"sections": {"analysis": "short", "checks": "Also too short"}},
        {"sections": {"analysis": "Detailed enough analysis for this section."}},
        {"sections": {"unknown": "A section that does not belong to this assignment."}},
        {"sections": {"analysis": "x" * 501, "checks": "Meaningful test case discussion."}},
        {"evidence_ids": []}, {"evidence_ids": [release.evidence[-1].id]},
    ]
    for change in cases:
        with pytest.raises(InvalidInput):
            store.save_assignment("owner", str(session.id), submission(session, release, **change))
        assert store._enrollments[str(session.id)] == before


def test_owner_stale_revision_and_changed_action_fingerprint_do_not_overwrite_project():
    store, release, session = setup_memory()
    draft = submission(session, release, action="save")
    store.save_assignment("owner", str(session.id), draft)
    with pytest.raises(NotFound):
        store.save_assignment("other", str(session.id), draft)
    with pytest.raises(InvalidInput, match="already used"):
        store.save_assignment("owner", str(session.id), draft.model_copy(update={"sections": {"analysis": "Changed"}}))
    with pytest.raises(InvalidInput, match="changed"):
        store.save_assignment("owner", str(session.id), draft.model_copy(update={"id": uuid4()}))
    assert store.get_session("owner", str(session.id)).assignment_sections["capstone"] == draft.sections


def test_structured_work_is_inert_text_and_can_be_saved_before_checkpoints(tmp_path):
    store, release, session = setup_memory()
    marker = tmp_path / "never-created.txt"
    malicious = f"__import__('pathlib').Path({str(marker)!r}).write_text('unsafe')"
    store.save_assignment("owner", str(session.id), submission(
        session, release, action="save", sections={"analysis": malicious, "checks": "<script>alert(1)</script>"}))
    assert not marker.exists()
    saved = store.get_session("owner", str(session.id))
    assert saved.assignment_sections["capstone"]["analysis"] == malicious and saved.completed_lesson_ids == []


@pytest.mark.parametrize("change", [
    {"sections": {"analysis": 1}}, {"sections": {"analysis": "\x00"}},
    {"sections": {"analysis": "\ud800"}}, {"sections": {"analysis": "x" * 5001}},
    {"sections": {str(index): "x" * 3000 for index in range(8)}},
    {"evidence_ids": ["e", "e"]}, {"score": 100},
])
def test_submission_wire_rejects_unbounded_invalid_unicode_and_client_scores(change):
    with pytest.raises(ValidationError):
        AssignmentDraftRequest.model_validate({"id": str(uuid4()), "revision": 0,
                                               "assignment_id": "capstone", "action": "save", **change})


@pytest.mark.parametrize("mutate", [
    lambda data: data.update(required_assignment_ids=["missing"]),
    lambda data: data.update(required_assignment_ids=["capstone", "capstone"]),
    lambda data: data["assignments"][0]["criteria"][0].update(evidence_ids=["missing"]),
    lambda data: data["assignments"][0]["criteria"].append(data["assignments"][0]["criteria"][0]),
    lambda data: data["assignments"][0]["sections"].append(data["assignments"][0]["sections"][0]),
    lambda data: data["assignments"][0]["sections"][0].update(min_chars=500, max_chars=100),
    lambda data: data["assignments"][0].update(require_evidence=1),
])
def test_curriculum_contract_rejects_broken_required_project_rubric_and_section_links(mutate):
    data = full_release().model_dump(mode="json")
    mutate(data)
    with pytest.raises(ValidationError):
        CourseRelease.model_validate(data)


def test_legacy_release_serialization_and_hash_do_not_add_empty_full_course_metadata():
    for release in [python_foundations(), *candidates()]:
        data = release.model_dump(mode="json")
        assert "required_assignment_ids" not in data
        for assignment in data["assignments"]:
            assert not {"criteria", "sections", "require_evidence"} & assignment.keys()
        if not release.labs:
            data.pop("labs", None)
        if not release.assignments:
            data.pop("assignments", None)
        assert release.content_hash() == hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def test_public_api_exposes_rubric_and_owned_structured_draft_but_no_keys_or_grades():
    store, release, session = setup_memory()
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(create_course_router(lambda: "owner", store))
    client = TestClient(app)
    detail = client.get(f"/api/courses/{release.slug}").json()
    assert detail["required_assignment_ids"] == ["capstone"]
    assert detail["assignments"][0]["criteria"][0]["review_guidance"]
    assert "exercises" not in detail
    draft = submission(session, release, action="save")
    response = client.put(f"/api/course-enrollments/{session.id}/assignments", json=draft.model_dump(mode="json"))
    assert response.status_code == 200 and response.json()["sections"] == draft.sections
    restored = client.get(f"/api/course-enrollments/{session.id}").json()
    assert restored["assignment_evidence_ids"]["capstone"] == draft.evidence_ids
    assert not {"answer", "explanation", "hint", "correct"} & restored["lesson"]["checkpoint"].keys()


@pytest.fixture()
def full_course_database(source_database):
    # Reuse the real course migration's table/FK/index statements in this test's
    # generated schema only. No deployment schema or shared catalog is touched.
    migration = Path(__file__).resolve().parents[3] / "packages/db/drizzle/0009_phase8c.sql"
    with psycopg.connect(source_database, autocommit=True) as conn:
        for statement in migration.read_text().split("--> statement-breakpoint"):
            if any(f'"{name}"' in statement for name in (
                "courses", "course_releases", "course_enrollments", "course_attempts"
            )):
                conn.execute(statement.replace('"public".', ""))
        conn.execute("CREATE TABLE flashcards(id uuid PRIMARY KEY,document_id uuid REFERENCES documents(id) "
                     "ON DELETE CASCADE,chapter_id uuid,source_chunk_id uuid,user_id uuid REFERENCES users(id) "
                     "ON DELETE CASCADE,front text,back text,due_date date)")
        owner, other = str(uuid4()), str(uuid4())
        conn.execute("INSERT INTO users(id,clerk_id,email) VALUES(%s,'full-owner','full@example.test'),"
                     "(%s,'full-other','other@example.test')", (owner, other))
    release = full_release(owner)
    store = PgCourseStore(source_database)
    store.save_release(release)
    return source_database, store, owner, other, release


def test_pg_structured_project_resume_completion_and_exact_action_replay(full_course_database):
    database, store, owner, _, release = full_course_database
    session = store.enroll(owner, release.slug)
    session = finish_lessons(store, owner, release, session)
    request = submission(session, release)
    store.save_assignment(owner, str(session.id), request)
    restored = PgCourseStore(database).get_session(owner, str(session.id))
    assert restored.status == "completed" and restored.assignment_sections["capstone"] == request.sections
    assert PgCourseStore(database).save_assignment(owner, str(session.id), request).replayed
    assert store.get_session(owner, str(session.id)).revision == restored.revision


def test_pg_stale_and_concurrent_submissions_rollback_without_cross_owner_access(full_course_database):
    _, store, owner, other, release = full_course_database
    session = finish_lessons(store, owner, release, store.enroll(owner, release.slug))

    def submit(_):
        try:
            return store.save_assignment(owner, str(session.id), submission(session, release))
        except InvalidInput:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(result is not None for result in pool.map(submit, range(2))) == 1
    saved = store.get_session(owner, str(session.id))
    assert saved.status == "completed" and saved.revision == session.revision + 1
    with pytest.raises(NotFound):
        store.save_assignment(other, str(session.id), submission(saved, release))
    assert store.get_session(owner, str(session.id)) == saved


def test_pg_rejected_project_does_not_mutate_state_and_account_delete_cascades(full_course_database):
    database, store, owner, other, release = full_course_database
    session = store.enroll(owner, release.slug)
    with pytest.raises(InvalidInput, match="checkpoints"):
        store.save_assignment(owner, str(session.id), submission(session, release))
    assert store.get_session(owner, str(session.id)) == session
    with psycopg.connect(database) as conn:
        conn.execute("DELETE FROM users WHERE id=%s", (owner,))
    with pytest.raises(NotFound):
        store.get_session(owner, str(session.id))
    with psycopg.connect(database) as conn:
        assert conn.execute("SELECT count(*) FROM course_enrollments").fetchone()[0] == 0
        assert [str(row[0]) for row in conn.execute("SELECT id FROM users").fetchall()] == [other]
