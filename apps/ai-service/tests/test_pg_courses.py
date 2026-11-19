"""Optional course transaction tests on migrated disposable Postgres data.

Set STUDYVAULT_TEST_DATABASE_URL after applying the course schema migration.
Every fixture creates uniquely named owners/private courses and deletes only
those owners afterwards; shared catalog fixtures are never mutated.
"""

import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.courses.catalog import python_foundations
from app.courses.catalog_candidates import candidates
from app.courses.contracts import AssignmentDraftRequest, CourseRelease, LabRunRequest
from app.courses.store import PgCourseStore
from app.documents.pg_store import PgDocumentStore
from app.errors import InvalidInput, NotFound

URL = os.environ.get("STUDYVAULT_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="STUDYVAULT_TEST_DATABASE_URL not set")


@pytest.fixture()
def setup():
    docs = PgDocumentStore(URL)
    owner = docs.resolve_user(f"course-test-{uuid.uuid4().hex}")
    other = docs.resolve_user(f"course-test-{uuid.uuid4().hex}")
    store = PgCourseStore(URL)
    data = python_foundations().model_dump(mode="json")
    data.update(
        id=str(uuid.uuid4()),
        course_id=str(uuid.uuid4()),
        slug=f"private-{uuid.uuid4().hex}",
        visibility="private",
        user_id=owner,
    )
    release = CourseRelease.model_validate(data)
    store.save_release(release)
    try:
        yield store, owner, other, release
    finally:
        with docs._conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id IN (%s,%s)", (owner, other))
        docs._conn.close()


def request(session, answer):
    return {
        "id": str(uuid.uuid4()),
        "exercise_id": session.lesson.checkpoint.id,
        "revision": session.revision,
        "answer": answer,
    }


def test_pg_private_enrollment_resume_idempotent_and_source_scope(setup):
    store, owner, other, release = setup
    with ThreadPoolExecutor(max_workers=4) as pool:
        sessions = list(pool.map(lambda _: store.enroll(owner, release.slug), range(8)))
    session = sessions[0]
    assert len({s.id for s in sessions}) == 1
    assert PgCourseStore(URL).get_session(owner, str(session.id)) == session
    assert len(store.list_sessions(owner)) == 1 and store.list_sessions(other) == []
    with pytest.raises(NotFound):
        store.enroll(other, release.slug)
    with pytest.raises(NotFound):
        store.get_session(other, str(session.id))
    with store._connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM documents WHERE user_id=%s", (owner,))
        assert cur.fetchone()[0] == 1
        cur.execute(
            "SELECT id,chapter_id,content FROM chunks WHERE document_id=%s AND user_id=%s",
            (str(session.document_id), owner),
        )
        chunks = {str(row[0]): row[1:] for row in cur.fetchall()}
        for ref in session.evidence:
            assert ref.quote in chunks[str(ref.chunk_id)][1]
            assert str(chunks[str(ref.chunk_id)][0]) == str(ref.chapter_id)


def test_pg_duplicate_actions_exact_replay_and_stale_rollback(setup):
    store, owner, _, release = setup
    session = store.enroll(owner, release.slug)
    action = request(session, -999)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: store.action(owner, str(session.id), "attempt", action), range(8)))
    assert sum(not result["replayed"] for result in results) == 1
    first = next(result for result in results if not result["replayed"])
    with pytest.raises(InvalidInput) as stale:
        store.action(owner, str(session.id), "attempt", request(session, 13))
    assert stale.value.status_code == 409
    fresh = store.get_session(owner, str(session.id))
    assert fresh.last_action.id == uuid.UUID(action["id"]) and fresh.last_action.answer == -999
    result = store.action(owner, str(session.id), "attempt", request(fresh, 13))
    assert result["lesson_complete"] and result["independent"]
    assert store.action(owner, str(session.id), "attempt", action) == {**first, "replayed": True}
    with store._connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM course_attempts WHERE user_id=%s", (owner,))
        assert cur.fetchone()[0] == 2


def test_pg_immutable_release_and_parent_owner_check(setup):
    store, owner, other, release = setup
    changed = release.model_copy(update={"title": "Changed published release"})
    with pytest.raises(InvalidInput, match="immutable"):
        store.save_release(changed)
    draft = release.model_dump(mode="json")
    draft.update(id=str(uuid.uuid4()), version="2", user_id=other, status="draft")
    with pytest.raises(InvalidInput, match="owner"):
        store.save_release(CourseRelease.model_validate(draft))
    assert store.get_release(release.slug, owner).content_hash() == release.content_hash()


def test_pg_hint_rotates_checkpoint_without_mastery(setup):
    store, owner, _, release = setup
    session = store.enroll(owner, release.slug)
    old_id = session.lesson.checkpoint.id
    store.action(
        owner,
        str(session.id),
        "assistance",
        {"id": str(uuid.uuid4()), "exercise_id": old_id, "revision": 0, "kind": "reveal"},
    )
    fresh = PgCourseStore(URL).get_session(owner, str(session.id))
    assert fresh.lesson.checkpoint.id != old_id and fresh.completed_lesson_ids == []
    with pytest.raises(InvalidInput, match="active"):
        store.action(owner, str(session.id), "attempt", {**request(fresh, 13), "exercise_id": old_id})


def test_pg_course_materialization_obeys_account_document_limit(setup):
    store, owner, _, release = setup
    docs = PgDocumentStore(URL, max_documents_per_user=1)
    docs.create(user_id=owner, filename="already.pdf", mime_type="application/pdf", size_bytes=10)
    capped_store = PgCourseStore(URL, max_documents_per_user=1)

    with pytest.raises(InvalidInput, match="document limit"):
        capped_store.enroll(owner, release.slug)

    with docs._conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM documents WHERE user_id=%s", (owner,))
        assert cur.fetchone()[0] == 1


def test_pg_course_labs_and_assignment_drafts_persist_without_creating_mastery():
    docs = PgDocumentStore(URL)
    owner = docs.resolve_user(f"course-lab-test-{uuid.uuid4().hex}")
    other = docs.resolve_user(f"course-lab-test-{uuid.uuid4().hex}")
    store = PgCourseStore(URL)
    data = next(item for item in candidates() if item.slug == "sql-query-foundations").model_dump(mode="json")
    data.update(
        id=str(uuid.uuid4()),
        course_id=str(uuid.uuid4()),
        slug=f"private-lab-{uuid.uuid4().hex}",
        status="published",
        visibility="private",
        user_id=owner,
    )
    release = CourseRelease.model_validate(data)
    store.save_release(release)
    try:
        session = store.enroll(owner, release.slug)
        lab, task = release.labs[0], release.labs[0].tasks[0]
        run = LabRunRequest(
            id=uuid.uuid4(),
            revision=session.revision,
            lab_id=lab.id,
            task_id=task.id,
            text=task.expected_query or "",
        )
        first = store.run_lab(owner, str(session.id), run)
        replay = store.run_lab(owner, str(session.id), run)
        assert first.accepted and replay.replayed and first.revision == replay.revision

        saved = store.save_assignment(
            owner,
            str(session.id),
            AssignmentDraftRequest(
                id=uuid.uuid4(),
                revision=first.revision,
                assignment_id=release.assignments[0].id,
                action="save",
                text="SELECT category, COUNT(*) FROM products GROUP BY category;\n" + "Explanation. " * 15,
            ),
        )
        assert saved.status == "draft"
        resumed = PgCourseStore(URL).get_session(owner, str(session.id))
        assert resumed.lab_progress[lab.id] == 1
        assert len(resumed.lab_transcripts[lab.id]) == 1
        assert resumed.assignment_status[release.assignments[0].id] == "draft"
        with pytest.raises(NotFound):
            store.get_session(other, str(session.id))
        assert store.misconception_counts(owner) == {}
        assert store.track_attempt_counts(owner) == {}
        with store._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM course_attempts WHERE user_id=%s", (owner,))
            assert cur.fetchone()[0] == 0
            cur.execute("SELECT count(*) FROM flashcards WHERE user_id=%s", (owner,))
            assert cur.fetchone()[0] == 0
    finally:
        with docs._conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id IN (%s,%s)", (owner, other))
        docs._conn.close()
