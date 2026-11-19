"""SQL/Git publication, isolated draft gates, and complete course acceptance."""

import hashlib
import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.ai.sm2 import Sm2State, due_date
from app.ai.sm2 import review as review_sm2
from app.courses import engine
from app.courses.catalog import catalog
from app.courses.catalog_candidates import candidates
from app.courses.store import MemoryCourseStore
from app.documents.store import InMemoryDocumentStore
from app.errors import NotFound


def _session(store, user, enrollment_id):
    return store.get_session(user, str(enrollment_id))


def _submit(store, user, session, exercise_id, answer, action_id):
    return store.action(
        user,
        str(session.id),
        "attempt",
        {
            "id": action_id,
            "revision": session.revision,
            "exercise_id": exercise_id,
            "answer": answer,
        },
    )


def test_candidates_are_valid_five_lesson_static_drafts_with_server_keys():
    drafts = candidates()
    assert [item.slug for item in drafts] == ["sql-query-foundations", "git-foundations"]
    for release in drafts:
        assert release.status == "draft"
        assert release.visibility == "catalog"
        assert release.size == "mini" and release.origin == "prebuilt"
        assert len(release.lessons) == 5
        assert len(release.exercises) == 85
        assert len(release.sources) == len(release.evidence) == 5
        for source in release.sources:
            assert source.reference_urls and all(url.startswith("https://") for url in source.reference_urls)
        for exercise in release.exercises:
            assert engine.grade(exercise, exercise.answer)
            public = engine.public_exercise(exercise).model_dump(mode="json")
            assert not {"answer", "explanation", "hint", "correct"} & public.keys()
        for lesson in release.lessons:
            language = lesson.blocks[1].language
            assert language == ("sql" if release.slug.startswith("sql-") else "shell")
            assert all(block.evidence_ids for block in lesson.blocks)
            exercises = {exercise.id: exercise for exercise in release.exercises}
            checkpoints = {exercises[identifier].prompt for identifier in lesson.checkpoint_ids}
            assert len(checkpoints) == len(lesson.checkpoint_ids)
            assert not checkpoints.intersection(exercises[identifier].prompt for identifier in lesson.practice_ids)
    published = {item.slug: item for item in catalog()}
    for draft in drafts:
        assert published[draft.slug].status == "published"
        assert published[draft.slug].id == draft.id
        assert published[draft.slug].model_dump(exclude={"status"}) == draft.model_dump(exclude={"status"})


def test_published_catalog_releases_include_versioned_practice_in_content_hashes():
    release = catalog()[0]
    assert release.version == "2"
    assert release.labs and release.assignments
    payload = release.model_dump(mode="json")
    assert payload["labs"] and payload["assignments"]
    assert release.content_hash() == hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


@pytest.mark.parametrize("candidate", candidates(), ids=lambda item: item.slug)
def test_candidate_requires_recorded_editorial_publication_before_enrollment(candidate):
    store = MemoryCourseStore(InMemoryDocumentStore(), releases=[candidate])
    assert store.list_courses("learner") == []
    with pytest.raises(NotFound):
        store.get_release(candidate.slug, "learner")
    with pytest.raises(NotFound):
        store.enroll("learner", candidate.slug)
    store.save_release(candidate.model_copy(update={"status": "reviewed"}, deep=True))
    assert store.list_courses("learner") == []
    with pytest.raises(NotFound):
        store.enroll("learner", candidate.slug)
    # Isolated draft stores must still enforce publication explicitly, even
    # after catalog() ships published copies of the authored definitions.
    published = candidate.model_copy(update={"status": "published"}, deep=True)
    store.save_release(published)
    assert store.list_courses("learner")[0].slug == candidate.slug
    assert store.enroll("learner", candidate.slug).course_slug == candidate.slug


@pytest.mark.parametrize(
    "exercise_id,correct_answer,incorrect_answer",
    [
        ("sql-filter-checkpoint-1", "ge", "gt"),
        ("sql-null-checkpoint-1", "yes", "unknown"),
        ("sql-order-checkpoint-1", 1, 3),
        ("sql-group-checkpoint-1", 1, 3),
        ("sql-join-checkpoint-1", 3, 2),
        ("git-stage-checkpoint-1", "staged", "edited"),
        ("git-diff-checkpoint-1", "diff", "staged"),
        ("git-branch-checkpoint-1", "feature", "both"),
        ("git-merge-checkpoint-1", "stage", "show"),
        ("git-history-checkpoint-1", "show", "log"),
    ],
)
def test_first_unaided_checkpoint_matches_golden_answer(exercise_id, correct_answer, incorrect_answer):
    keys = {exercise.id: exercise for release in candidates() for exercise in release.exercises}
    assert engine.grade(keys[exercise_id], correct_answer)
    assert not engine.grade(keys[exercise_id], incorrect_answer)


@pytest.mark.parametrize("candidate", candidates(), ids=lambda item: item.slug)
def test_published_catalog_completes_independent_course_review_resume_progress_flow(candidate):
    """Run the shipped SQL/Git releases through the complete deterministic journey."""
    store = MemoryCourseStore(InMemoryDocumentStore())
    user = "c05-acceptance-learner"
    session = store.enroll(user, candidate.slug)
    assert session.lesson.blocks and session.evidence
    checkpoint = session.lesson.checkpoint.model_dump(mode="json")
    assert not {"answer", "hint", "explanation"} & checkpoint.keys()

    keys = {exercise.id: exercise for exercise in candidate.exercises}
    for index, lesson in enumerate(candidate.lessons):
        session = _session(store, user, session.id)
        assert session.lesson.id == lesson.id
        material = store.documents.get_for_user(str(session.document_id), user)
        assert material is not None
        for ref in session.evidence:
            chunk = next(chunk for chunk in material.chunks if chunk.id == str(ref.chunk_id))
            assert str(ref.chapter_id) == chunk.chapter_id and str(ref.document_id) == material.id
            assert ref.locator == f"lesson/{lesson.id}/explanation" and ref.quote in chunk.content
        exercise = keys[session.lesson.practice[0].id]
        practice = _submit(store, user, session, exercise.id, exercise.answer, str(uuid4()))
        assert practice["correct"] and not practice["independent"] and not practice["lesson_complete"]

        session = _session(store, user, session.id)
        exercise = keys[session.lesson.checkpoint.id]
        wrong_answer = (
            -1
            if exercise.kind == "number"
            else next(choice.id for choice in exercise.choices if choice.id != exercise.answer)
        )
        wrong = _submit(store, user, session, exercise.id, wrong_answer, str(uuid4()))
        assert not wrong["correct"] and not wrong["lesson_complete"] and wrong["feedback"]
        session = _session(store, user, session.id)
        result = _submit(store, user, session, exercise.id, exercise.answer, str(uuid4()))
        assert result["correct"] and result["independent"] and result["lesson_complete"]
        assert result["feedback"] == exercise.explanation
        session = _session(store, user, session.id)
        if index + 1 < len(candidate.lessons):
            session = store.advance(user, str(session.id), session.revision)

    assert session.status == "completed"
    cards = store.documents.list_flashcards(str(session.document_id), user)
    assert len(cards) == len(candidate.lessons)
    assert all(card["source_chunk_id"] and card["chapter_id"] for card in cards)
    now = datetime.now(UTC)
    today = now.date().isoformat()
    due = store.documents.due_flashcards(user, today)
    assert {card["id"] for card in due} == {card["id"] for card in cards}
    card = due[0]
    next_state = review_sm2(
        Sm2State(card["ease_factor"], card["interval_days"], card["repetitions"]),
        5,
    )
    assert store.documents.add_review(card_id=card["id"], user_id=user, grade=5)
    store.documents.update_flashcard_sm2(
        card["id"],
        ease=next_state.ease_factor,
        interval_days=next_state.interval_days,
        reps=next_state.repetitions,
        due=due_date(now.date(), next_state.interval_days),
    )
    assert next_state.repetitions == 1 and due_date(now.date(), next_state.interval_days) > today
    assert len(store.documents.due_flashcards(user, today)) == len(cards) - 1
    resumed = store.get_session(user, str(session.id))
    assert resumed == session
    assert store.completed_slugs(user) == {candidate.slug}
    assert store.documents.get_for_user(str(session.document_id), "another-user") is None
    with pytest.raises(NotFound):
        _session(store, "another-user", session.id)
