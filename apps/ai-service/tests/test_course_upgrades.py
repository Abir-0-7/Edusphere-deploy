"""F06 course releases keep independent enrollments and immutable history."""

from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import psycopg
import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient

from app.courses.catalog import DIAGNOSTIC, pytorch_fundamentals
from app.courses.contracts import CourseRelease, StudyNotesRequest
from app.courses.router import create_course_router
from app.courses.store import MemoryCourseStore, PgCourseStore
from app.courses.upgrade_contracts import CourseUpgradeApplyRequest, CourseUpgradePreviewRequest
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, Conflict, InvalidInput, NotFound, Unauthorized, api_error_handler
from tests.test_full_course_progress import finish_lessons, full_release, submission
from tests.test_full_course_progress import full_course_database as full_course_database
from tests.test_source_versions_pg import source_database as source_database


def new_release(original, *, changed=True, **changes):
    data = original.model_dump(mode="json")
    data.update({"id": str(uuid4()), "version": str(int(original.version) + 1), **changes})
    if changed:
        data["lessons"][1]["blocks"][0]["content"] += "\nCompare both outcomes before reading the next example."
    return CourseRelease.model_validate(data)


def target_request(target):
    return CourseUpgradePreviewRequest(target_release_id=target.id)


def acceptance(preview):
    return CourseUpgradeApplyRequest(
        id=uuid4(),
        expected_revision=preview.from_revision,
        target_release_id=preview.target_release_id,
        target_content_hash=preview.target_content_hash,
        preview_hash=preview.preview_hash,
        accept_upgrade=True,
    )


def save_old_work(store, owner, original, session):
    session = finish_lessons(store, owner, original, session)
    store.save_assignment(owner, str(session.id), submission(session, original))
    session = store.get_session(owner, str(session.id))
    return store.update_study_notes(
        owner,
        str(session.id),
        StudyNotesRequest.model_validate(
            {
                "revision": session.revision,
                "notes": [
                    {"id": str(uuid4()), "lesson_id": lesson.id, "text": f"My {lesson.title} work"}
                    for lesson in original.lessons[:2]
                ],
                "bookmarks": [
                    {"lesson_id": lesson.id, "evidence_id": lesson.blocks[0].evidence_ids[0]}
                    for lesson in original.lessons[:2]
                ],
            }
        ),
    )


def memory_case():
    original = full_release()
    store = MemoryCourseStore(InMemoryDocumentStore(), [original])
    session = store.enroll("owner", original.slug)
    return store, original, session


def test_mapping_retains_unchanged_checkpoints_and_preserves_all_original_user_work():
    store, original, session = memory_case()
    old = save_old_work(store, "owner", original, session)
    target = new_release(original)
    store.save_release(target)
    preview = store.preview_upgrade("owner", str(old.id), target_request(target))
    assert store.list_sessions("owner") == [old]
    assert preview.retained_lesson_ids == [original.lessons[0].id]
    assert preview.retained_objective_ids == original.lessons[0].objective_ids
    assert [item.reason for item in preview.reset_reasons] == ["changed_teaching_or_assessment"] + [
        "changed_prerequisite"
    ] * (len(target.lessons) - 2)
    assert preview.retained_note_count == preview.retained_bookmark_count == 1

    request = acceptance(preview)
    result = store.apply_upgrade("owner", str(old.id), request)
    assert not result.replayed and result.session.id != old.id and result.session.document_id != old.document_id
    assert result.receipt.preview_hash == preview.preview_hash == preview.fingerprint()
    assert result.receipt.from_release_id == original.id and result.receipt.target_release_id == target.id
    assert result.session.notes == old.notes[:1] and result.session.bookmarks == old.bookmarks[:1]
    assert result.session.lesson.id == target.lessons[1].id and result.session.lesson.checkpoint is not None
    assert result.session.assignment_status == {"capstone": "draft"}
    assert not result.session.assignment_sections and not result.session.assignment_evidence_ids
    assert store.get_session("owner", str(old.id)) == old and old.assignment_status == {"capstone": "submitted"}
    assert store.pinned_course_detail("owner", str(old.id)).content_hash() == original.content_hash()
    assert store.pinned_course_detail("owner", str(result.session.id)).content_hash() == target.content_hash()
    assert store.enroll("owner", target.slug).id == result.session.id
    assert store.apply_upgrade("owner", str(old.id), request).receipt == result.receipt
    assert store.apply_upgrade("owner", str(old.id), request).replayed
    with pytest.raises(Conflict, match="different input"):
        store.apply_upgrade("owner", str(old.id), request.model_copy(update={"preview_hash": "0" * 64}))
    with pytest.raises(Conflict, match="already have"):
        store.apply_upgrade("owner", str(old.id), request.model_copy(update={"id": uuid4()}))


def test_upgrade_api_requires_exact_explicit_acceptance_and_rejects_foreign_or_stale_requests():
    store, original, session = memory_case()
    target = new_release(original)
    store.save_release(target)
    foreign = full_release("other")
    store.save_release(foreign)

    def authenticate(x_owner: str | None = Header(default=None)):
        if x_owner is None:
            raise Unauthorized()
        return x_owner

    def api(enabled):
        app = FastAPI()
        app.add_exception_handler(ApiError, api_error_handler)
        app.include_router(create_course_router(authenticate, store, upgrades_enabled=enabled))
        return TestClient(app)

    base = f"/api/course-enrollments/{session.id}"
    own = {"X-Owner": "owner"}
    other = {"X-Owner": "other"}
    selected = target_request(target).model_dump(mode="json")
    with api(False) as client:
        assert client.get(f"{base}/course", headers=own).json()["release_id"] == str(original.id)
        assert client.post(f"{base}/upgrade-preview", headers=own, json=selected).status_code == 404
    with api(True) as client:
        assert client.get(f"{base}/course").status_code == 401
        assert client.get(f"{base}/course", headers=other).status_code == 404
        assert client.post(f"{base}/upgrade-preview", headers=other, json=selected).status_code == 404
        assert (
            client.post(
                f"{base}/upgrade-preview", headers=own, json=target_request(foreign).model_dump(mode="json")
            ).status_code
            == 404
        )
        preview = store.preview_upgrade("owner", str(session.id), target_request(target))
        preview_response = client.post(f"{base}/upgrade-preview", headers=own, json=selected)
        assert preview_response.json() == preview.model_dump(mode="json")
        request = acceptance(preview).model_dump(mode="json")
        assert client.post(f"{base}/upgrade", headers=other, json=request).status_code == 404
        assert client.post(f"{base}/upgrade", headers=own, json={**request, "accept_upgrade": False}).status_code == 422
        assert (
            client.post(f"{base}/upgrade", headers=own, json={**request, "target_content_hash": "0" * 64}).status_code
            == 409
        )
        store.update_study_notes("owner", str(session.id), StudyNotesRequest(revision=0, notes=[], bookmarks=[]))
        assert client.post(f"{base}/upgrade", headers=own, json=request).status_code == 409
        assert len(store.list_sessions("owner")) == 1
        current = store.preview_upgrade("owner", str(session.id), target_request(target))
        applied = client.post(f"{base}/upgrade", headers=own, json=acceptance(current).model_dump(mode="json"))
        assert applied.status_code == 200, applied.text
        assert applied.json()["session"]["release_id"] == str(target.id)
        assert client.get(base, headers=own).json()["release_id"] == str(original.id)
        checkpoint = next(exercise for exercise in original.exercises if exercise.id == session.lesson.checkpoint.id)
        old_attempt = client.post(
            f"{base}/attempts",
            headers=own,
            json={
                "id": str(uuid4()),
                "revision": current.from_revision,
                "exercise_id": checkpoint.id,
                "answer": checkpoint.answer,
            },
        )
        assert old_attempt.status_code == 200 and old_attempt.json()["lesson_complete"]
        upgrade_id = applied.json()["session"]["id"]
        assert client.get(f"/api/course-enrollments/{upgrade_id}", headers=own).json()["completed_lesson_ids"] == []


def test_upgrade_preview_rejects_same_unpublished_and_unrelated_targets():
    store, original, session = memory_case()
    draft = new_release(original, status="draft")
    unrelated = full_release()
    store.save_release(draft)
    store.save_release(unrelated)
    for target, reason in [
        (original, "different published release"),
        (draft, "not published"),
        (unrelated, "different published release"),
    ]:
        with pytest.raises(InvalidInput, match=reason):
            store.preview_upgrade("owner", str(session.id), target_request(target))


def test_upgrade_honors_original_diagnostic_admission_and_checks_new_prerequisites():
    original = pytorch_fundamentals()
    store = MemoryCourseStore(InMemoryDocumentStore(), [original])
    diagnostic = {key: answer for key, (_, answer) in DIAGNOSTIC.items()}
    session = store.enroll("owner", original.slug, diagnostic)
    target = new_release(original, changed=False)
    stricter = new_release(
        original, changed=False, version=str(int(original.version) + 2), prerequisites=["python-foundations", "sql"]
    )
    store.save_release(target)
    store.save_release(stricter)
    assert store.completed_slugs("owner") == set()

    preview = store.preview_upgrade("owner", str(session.id), target_request(target))
    assert store.apply_upgrade("owner", str(session.id), acceptance(preview)).session.release_id == target.id
    with pytest.raises(InvalidInput, match="newly required"):
        store.preview_upgrade("owner", str(session.id), target_request(stricter))


def test_pg_duplicate_upgrade_acceptance_creates_one_new_document_and_keeps_old_data(full_course_database):
    database, store, owner, other, original = full_course_database
    old = save_old_work(store, owner, original, store.enroll(owner, original.slug))
    target = new_release(original)
    store.save_release(target)
    card_id = uuid4()
    with psycopg.connect(database, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO flashcards(id,document_id,user_id,front,back,due_date) VALUES(%s,%s,%s,%s,%s,'2030-01-01')",
            (card_id, old.document_id, owner, "My edited card", "My edited answer"),
        )
    preview = store.preview_upgrade(owner, str(old.id), target_request(target))
    request = acceptance(preview)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: store.apply_upgrade(owner, str(old.id), request), range(6)))
    assert sum(not item.replayed for item in results) == 1
    assert len({item.session.id for item in results}) == 1
    assert len({item.receipt.created_at for item in results}) == 1
    new = results[0].session
    reopened = PgCourseStore(database)
    assert reopened.get_session(owner, str(old.id)) == old
    assert reopened.get_session(owner, str(new.id)) == new
    assert reopened.pinned_course_detail(owner, str(old.id)).content_hash() == original.content_hash()
    with pytest.raises(NotFound):
        reopened.apply_upgrade(other, str(old.id), request)
    with pytest.raises(Conflict, match="different input"):
        reopened.apply_upgrade(owner, str(old.id), request.model_copy(update={"expected_revision": 0}))
    with psycopg.connect(database, autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM documents WHERE user_id=%s", (owner,)).fetchone()[0] == 2
        assert conn.execute(
            "SELECT count(*) FROM chapters WHERE document_id=%s",
            (new.document_id,),
        ).fetchone()[0] == len(target.lessons)
        assert conn.execute(
            "SELECT count(*) FROM course_attempts WHERE enrollment_id=%s",
            (old.id,),
        ).fetchone()[0] == len(original.lessons)
        assert conn.execute(
            "SELECT front,due_date::text FROM flashcards WHERE id=%s AND document_id=%s AND user_id=%s",
            (card_id, old.document_id, owner),
        ).fetchone() == ("My edited card", "2030-01-01")
        assert (
            conn.execute(
                "SELECT count(*) FROM flashcards WHERE document_id=%s",
                (new.document_id,),
            ).fetchone()[0]
            == 0
        )


def test_pg_stale_and_quota_failure_leave_no_orphan_target_rows(full_course_database):
    database, store, owner, _, original = full_course_database
    old = store.enroll(owner, original.slug)
    target = new_release(original)
    store.save_release(target)
    preview = store.preview_upgrade(owner, str(old.id), target_request(target))
    changed = store.update_study_notes(owner, str(old.id), StudyNotesRequest(revision=0, notes=[], bookmarks=[]))
    with pytest.raises(Conflict, match="changed"):
        store.apply_upgrade(owner, str(old.id), acceptance(preview))
    latest = store.preview_upgrade(owner, str(old.id), target_request(target))
    capped = PgCourseStore(database, max_documents_per_user=1)
    with pytest.raises(InvalidInput, match="document limit"):
        capped.apply_upgrade(owner, str(old.id), acceptance(latest))
    assert store.list_sessions(owner) == [changed]
    with psycopg.connect(database, autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM documents WHERE user_id=%s", (owner,)).fetchone()[0] == 1
        assert (
            conn.execute(
                "SELECT count(*) FROM course_enrollments WHERE release_id=%s",
                (target.id,),
            ).fetchone()[0]
            == 0
        )
