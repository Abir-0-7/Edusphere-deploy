"""Expansion catalog acceptance, published hash protection and learner isolation."""

import json
from uuid import uuid4

import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient

from app.courses import engine
from app.courses.catalog import DIAGNOSTIC, catalog
from app.courses.contracts import AssignmentDraftRequest, CourseRelease, LabRunRequest
from app.courses.router import create_course_router
from app.courses.store import MemoryCourseStore
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, InvalidInput, NotFound, api_error_handler

EXPECTED = {
    "llm-rag-debugging": {
        "title": "LLM & RAG Pipeline Debugging",
        "minutes": 65,
        "prerequisite": "python-foundations",
        "lessons": [
            "Chunking Boundaries & Overlap Loss",
            "Embedding Similarity & Cosine Score Traps",
            "Lexical vs. Dense Hybrid Reranking",
            "Context-Window Budgeting & Truncation",
            "Tracing Ungrounded Citations & Hallucinations",
        ],
    },
    "ai-agents-tool-calling": {
        "title": "AI Agents & Tool-Calling Workflows",
        "minutes": 60,
        "prerequisite": "python-foundations",
        "lessons": [
            "ReAct Thought-Action-Observation Loops",
            "Strict Tool JSON Schema & Argument Validation",
            "Tool Error Recovery & Retry Loop Detection",
            "Multi-Turn Agent State & Memory Hygiene",
            "Untrusted Tool Output & Prompt-Injection Guards",
        ],
    },
    "neural-training-diagnostics": {
        "title": "Neural Training Diagnostics & Pitfalls",
        "minutes": 70,
        "prerequisite": "pytorch-fundamentals",
        "lessons": [
            "Train vs. Validation Loss Curve Diagnosis",
            "Exploding & Vanishing Gradient Signals",
            "Preprocessing & Target Data Leakage",
            "Class Imbalance & Metric Selection Traps",
            "model.train() vs. model.eval() & Determinism Bugs",
        ],
    },
    "web-security-exploit-tracing": {
        "title": "Web Security: Trace the Exploit",
        "minutes": 55,
        "prerequisite": None,
        "lessons": [
            "SQL String Concatenation vs. Parameterized Queries",
            "Broken Object-Level Authorization (IDOR) Flows",
            "JWT Signature, alg Header & Expiry Tampering",
            "Context-Aware Output Escaping & XSS Sinks",
            "Cookie SameSite, CORS & CSRF Request Forgery",
        ],
    },
    "concurrency-race-deadlocks": {
        "title": "Concurrency, Race Conditions & Deadlocks",
        "minutes": 60,
        "prerequisite": "python-foundations",
        "lessons": [
            "Check-Then-Act & Double-Spend Interleavings",
            "Atomic Operations & Mutex Critical Sections",
            "Lock Ordering & Circular Deadlock Cycles",
            "Async Event Loop Blocking & Starvation",
            "Idempotency Keys & Safe Concurrent Retries",
        ],
    },
    "system-design-caching": {
        "title": "System Design & Caching Under Load",
        "minutes": 65,
        "prerequisite": None,
        "lessons": [
            "Cache-Aside Hits, Misses & Stale Write Windows",
            "Cache Stampedes & Thundering Herd Mitigation",
            "Fixed-Window vs. Sliding-Window Rate Limiters",
            "Database Connection Pools & Queue Backpressure",
            "Exponential Backoff, Jitter & Retry Storms",
        ],
    },
    "regex-finite-state-parsing": {
        "title": "Regex & Finite-State Parsing",
        "minutes": 45,
        "prerequisite": None,
        "lessons": [
            "Character Classes, Anchors & Boundary Matching",
            "Greedy vs. Lazy Quantifier Backtracking",
            "Capture Groups, Alternation & Backreferences",
            "Positive & Negative Lookahead/Lookbehind Assertions",
            "Spotting Catastrophic Backtracking (ReDoS) Patterns",
        ],
    },
}

# Captured from the four published releases on origin/main before this batch.
LEGACY_HASHES = {
    "python-foundations": "d6153df079457c4bb6869e64e8fb38d20117ec41ef86d18f72f71baa20e826fe",
    "pytorch-fundamentals": "9d8a30d699edfaf5442ac73b75266873be9a86f9ee413cc5ed6175c4ff9dc2e2",
    "sql-query-foundations": "8e5742c1fcff8e07b53cf0b1a1a061f1bbd6f431d5c41736e332a062e6ce9457",
    "git-foundations": "7346dc5de406df45938e1381f12500d9164070f4931ea9b5122301f9f5c9a32b",
}

# Captured from Batch 1 before adding the remaining expansion courses.
BATCH_ONE_HASHES = {
    "llm-rag-debugging": "2fe13a95d6bd6c4a53c7dd409708d53dc5e1a9a339d0a790279e8ae390bccb2a",
    "ai-agents-tool-calling": "afe2a6cec6f354cdcc842c74c05ed07ce77b9bda5fbcc47ec74770705c0c24bb",
    "neural-training-diagnostics": "e5ac3bd89757fcd8eb3df15569b0dbd15f5e530529b39f278d5c0f8cca998e6e",
}


@pytest.fixture(params=EXPECTED)
def release(request):
    return next(item for item in catalog() if item.slug == request.param)


@pytest.fixture(params=[slug for slug, expected in EXPECTED.items() if expected["prerequisite"]])
def prerequisite_release(request):
    return next(item for item in catalog() if item.slug == request.param)


@pytest.fixture(params=[slug for slug, expected in EXPECTED.items() if expected["prerequisite"] is None])
def open_release(request):
    return next(item for item in catalog() if item.slug == request.param)


def _answers(release):
    return {key: answer for key, (_, answer) in engine.prerequisite_diagnostic(release).items()}


def _request(session, answer, exercise_id=None):
    return {
        "id": str(uuid4()),
        "revision": session.revision,
        "exercise_id": exercise_id or session.lesson.checkpoint.id,
        "answer": answer,
    }


def _key(release, identifier):
    return next(item for item in release.exercises if item.id == identifier)


def _wrong_answer(exercise):
    if exercise.kind == "number":
        return exercise.answer + 1
    if exercise.kind == "choice":
        return next(choice.id for choice in exercise.choices if choice.id != exercise.answer)
    if exercise.kind == "ordered":
        return list(reversed(exercise.answer))
    return [] if exercise.answer else [exercise.choices[0].id]


def _complete(store, owner, release):
    session = store.enroll(owner, release.slug, _answers(release) if release.prerequisites else None)
    while session.status != "completed":
        exercise = _key(release, session.lesson.checkpoint.id)
        store.action(owner, str(session.id), "attempt", _request(session, exercise.answer))
        session = store.get_session(owner, str(session.id))
        if session.status != "completed":
            session = store.advance(owner, str(session.id), session.revision)
    return session


def _no_private_keys(payload):
    if isinstance(payload, dict):
        assert not {"answer", "hint", "explanation", "correct", "expected_query", "expected_output"} & payload.keys()
        for value in payload.values():
            _no_private_keys(value)
    elif isinstance(payload, list):
        for value in payload:
            _no_private_keys(value)


def test_expansion_retains_all_seven_published_release_hashes():
    releases = catalog()
    assert {item.slug for item in releases} == LEGACY_HASHES.keys() | EXPECTED.keys()
    assert len(releases) == len({item.id for item in releases}) == len({item.course_id for item in releases}) == 11
    for item in releases:
        if item.slug in LEGACY_HASHES:
            assert item.version == "2"
            assert item.content_hash() == LEGACY_HASHES[item.slug]
        elif item.slug in BATCH_ONE_HASHES:
            assert item.version == "1"
            assert item.content_hash() == BATCH_ONE_HASHES[item.slug]


def test_expansion_has_valid_five_lesson_releases_and_fresh_keyed_assessments(release):
    from app.courses.catalog_expansion import expansion_courses

    expected = EXPECTED[release.slug]
    assert {item.slug for item in expansion_courses()} == EXPECTED.keys()
    assert CourseRelease.model_validate_json(release.model_dump_json()) == release
    rebuilt = next(item for item in expansion_courses() if item.slug == release.slug)
    assert rebuilt.content_hash() == release.content_hash()
    assert release.title == expected["title"] and release.estimated_minutes == expected["minutes"]
    assert release.prerequisites == ([expected["prerequisite"]] if expected["prerequisite"] else [])
    assert release.version == "1" and release.status == "published" and release.visibility == "catalog"
    assert release.size == "mini" and release.origin == "prebuilt" and release.user_id is None
    assert [lesson.title for lesson in release.lessons] == expected["lessons"]
    assert [identifier for module in release.modules for identifier in module.lesson_ids] == [
        lesson.id for lesson in release.lessons
    ]
    assert len(release.lessons) == len(release.sources) == len(release.evidence) == len(release.objectives) == 5
    assert len(release.exercises) == 20
    assert len(release.labs) == len(release.assignments) == 1
    assert len(release.labs[0].tasks) == 3
    assert all(source.reference_urls for source in release.sources)
    for lesson in release.lessons:
        practice = [_key(release, identifier) for identifier in lesson.practice_ids]
        checkpoints = [_key(release, identifier) for identifier in lesson.checkpoint_ids]
        assert len(practice) == 1 and len(checkpoints) == 3
        assert len({item.prompt for item in checkpoints}) == len(checkpoints)
        assert not {item.prompt for item in practice}.intersection(item.prompt for item in checkpoints)
        for item in practice + checkpoints:
            assert item.explanation and item.hint and engine.grade(item, item.answer)
            _no_private_keys(engine.public_exercise(item).model_dump(mode="json"))


def test_each_expansion_prerequisite_requires_completion_or_its_exact_typed_diagnostic(prerequisite_release):
    release = prerequisite_release
    store = MemoryCourseStore(InMemoryDocumentStore())
    assert engine.prerequisite_diagnostic(release)
    assert not engine.prerequisite_met(release, set())
    assert engine.prerequisite_met(release, set(release.prerequisites))
    assert not engine.prerequisite_met(release, {"unrelated-course"})
    answers = _answers(release)
    if release.prerequisites == ["pytorch-fundamentals"]:
        python_answers = {key: answer for key, (_, answer) in DIAGNOSTIC.items()}
        assert answers.keys() != python_answers.keys()
        assert not engine.prerequisite_met(release, {"python-foundations"})
        assert not engine.prerequisite_met(release, set(), python_answers)
    first = next(iter(answers))
    malformed = [
        {},
        {key: value for key, value in answers.items() if key != first},
        {**answers, "extra-answer": 1},
        {**answers, first: str(answers[first]) if not isinstance(answers[first], str) else 123},
        {**answers, first: True},
    ]
    for diagnostic in [None, *malformed]:
        assert not engine.prerequisite_met(release, set(), diagnostic)
        with pytest.raises(InvalidInput, match="diagnostic"):
            store.enroll("blocked", release.slug, diagnostic)
        assert store.list_sessions("blocked") == []
    session = store.enroll("qualified", release.slug, answers)
    assert session.course_slug == release.slug and session.completed_lesson_ids == []
    assert not store.completed_slugs("qualified")
    with pytest.raises(InvalidInput, match="diagnostic"):
        store.enroll("another-owner", release.slug)


def test_actual_prerequisite_course_completion_unlocks_only_that_learner(prerequisite_release):
    release = prerequisite_release
    store = MemoryCourseStore(InMemoryDocumentStore())
    prerequisite = store.get_release(release.prerequisites[0], "qualified")
    finished = _complete(store, "qualified", prerequisite)
    assert finished.status == "completed"
    assert store.enroll("qualified", release.slug).completed_lesson_ids == []
    with pytest.raises(InvalidInput, match="diagnostic"):
        store.enroll("another-owner", release.slug)


def test_open_expansion_needs_no_diagnostic_and_keeps_each_owner_separate(open_release):
    release = open_release
    store = MemoryCourseStore(InMemoryDocumentStore())
    assert engine.prerequisite_diagnostic(release) == {}
    assert engine.prerequisite_met(release, set())
    first = store.enroll("first-owner", release.slug)
    other = store.enroll("second-owner", release.slug)
    assert first.id != other.id and first.document_id != other.document_id
    assert first.completed_lesson_ids == other.completed_lesson_ids == []
    exercise = _key(release, first.lesson.checkpoint.id)
    store.action("first-owner", str(first.id), "attempt", _request(first, exercise.answer))
    assert store.get_session("first-owner", str(first.id)).completed_lesson_ids == [release.lessons[0].id]
    assert store.get_session("second-owner", str(other.id)) == other
    with pytest.raises(NotFound):
        store.get_session("second-owner", str(first.id))


def test_expansion_completes_all_lessons_resumes_and_deduplicates_review_cards(release):
    docs = InMemoryDocumentStore()
    store = MemoryCourseStore(docs)
    owner = "expansion-learner"
    session = store.enroll(owner, release.slug, _answers(release))
    assert store.enroll(owner, release.slug) == session
    assert len(docs._docs) == 1
    with pytest.raises(NotFound):
        store.get_session("other-owner", str(session.id))
    for index, lesson in enumerate(release.lessons):
        assert session.lesson.id == lesson.id
        _no_private_keys(session.lesson.model_dump(mode="json"))
        for ref in session.evidence:
            material = docs.get_for_user(str(session.document_id), owner)
            chunk = next(item for item in material.chunks if str(item.id) == str(ref.chunk_id))
            assert ref.quote in chunk.content and str(ref.chapter_id) == str(chunk.chapter_id)
        with pytest.raises(InvalidInput, match="independent"):
            store.advance(owner, str(session.id), session.revision)
        practice = _key(release, session.lesson.practice[0].id)
        practice_result = store.action(
            owner, str(session.id), "attempt", _request(session, practice.answer, practice.id)
        )
        assert practice_result["correct"] and not practice_result["independent"]
        assert not practice_result["lesson_complete"]
        session = store.get_session(owner, str(session.id))
        exercise = _key(release, session.lesson.checkpoint.id)
        wrong = store.action(owner, str(session.id), "attempt", _request(session, _wrong_answer(exercise)))
        assert not wrong["correct"] and not wrong["lesson_complete"]
        session = store.get_session(owner, str(session.id))
        stale = _request(session, exercise.answer)
        result = store.action(owner, str(session.id), "attempt", stale)
        assert result["correct"] and result["independent"] and result["lesson_complete"]
        assert result["course_complete"] == (index == 4)
        assert store.action(owner, str(session.id), "attempt", stale) == {**result, "replayed": True}
        with pytest.raises(InvalidInput, match="changed"):
            store.action(owner, str(session.id), "attempt", {**stale, "id": str(uuid4())})
        session = store.get_session(owner, str(session.id))
        assert session.completed_lesson_ids == [item.id for item in release.lessons[: index + 1]]
        cards = docs.list_flashcards(str(session.document_id), owner)
        assert len(cards) == index + 1
        if index < 4:
            session = store.advance(owner, str(session.id), session.revision)
    assert session.status == "completed" and store.completed_slugs(owner) == {release.slug}
    assert store.get_session(owner, str(session.id)) == session
    assert store.enroll(owner, release.slug) == session
    cards = docs.list_flashcards(str(session.document_id), owner)
    assert len({item["id"] for item in cards}) == 5
    assert all(item["chapter_id"] and item["source_chunk_id"] for item in cards)
    assert docs.get_for_user(str(session.document_id), "other-owner") is None


@pytest.mark.parametrize("kind", ["hint", "reveal"])
def test_expansion_assistance_rotates_checkpoint_without_granting_completion(release, kind):
    store = MemoryCourseStore(InMemoryDocumentStore())
    session = store.enroll("learner", release.slug, _answers(release))
    original = _key(release, session.lesson.checkpoint.id)
    store.action("learner", str(session.id), "assistance", {
        "id": str(uuid4()), "revision": session.revision, "exercise_id": original.id, "kind": kind,
    })
    fresh = store.get_session("learner", str(session.id))
    assert fresh.lesson.checkpoint.id != original.id and fresh.completed_lesson_ids == []
    with pytest.raises(InvalidInput, match="active"):
        store.action("learner", str(session.id), "attempt", _request(fresh, original.answer, original.id))
    assert not store.documents.list_flashcards(str(session.document_id), "learner")
    checkpoint = _key(release, fresh.lesson.checkpoint.id)
    result = store.action("learner", str(session.id), "attempt", _request(fresh, checkpoint.answer))
    assert result["independent"] and result["lesson_complete"]


def test_expansion_labs_and_private_assignments_save_without_checkpoint_mastery(release):
    store = MemoryCourseStore(InMemoryDocumentStore())
    session = store.enroll("learner", release.slug, _answers(release))
    for lab in release.labs:
        assert lab.kind == "sql_query"
        first_task = lab.tasks[0]
        unauthorized = LabRunRequest(
            id=uuid4(), revision=session.revision, lab_id=lab.id, task_id=first_task.id,
            text=first_task.expected_query,
        )
        with pytest.raises(NotFound):
            store.run_lab("other-owner", str(session.id), unauthorized)
        assert store.get_session("learner", str(session.id)) == session
        rejected = store.run_lab("learner", str(session.id), LabRunRequest(
            id=uuid4(), revision=session.revision, lab_id=lab.id, task_id=first_task.id,
            text="DELETE FROM diagnostic_logs;",
        ))
        assert not rejected.accepted and not rejected.complete and rejected.progress == 0
        session = store.get_session("learner", str(session.id))
        for index, task in enumerate(lab.tasks, start=1):
            request = LabRunRequest(
                id=uuid4(), revision=session.revision, lab_id=lab.id, task_id=task.id, text=task.expected_query,
            )
            result = store.run_lab("learner", str(session.id), request)
            assert result.accepted and result.progress == index
            assert result.output == task.expected_output
            assert result.complete == (index == len(lab.tasks))
            assert store.run_lab("learner", str(session.id), request) == result.model_copy(update={"replayed": True})
            with pytest.raises(InvalidInput, match="already used"):
                store.run_lab("learner", str(session.id), request.model_copy(update={"text": "SELECT id FROM other"}))
            with pytest.raises(InvalidInput, match="changed"):
                store.run_lab("learner", str(session.id), request.model_copy(update={"id": uuid4()}))
            session = store.get_session("learner", str(session.id))
        assert result.complete and session.lab_progress[lab.id] == len(lab.tasks)
    assignment = release.assignments[0]
    draft = "Diagnose the observed failure, record supporting evidence, propose one bounded fix, and verify it."
    request = AssignmentDraftRequest(
        id=uuid4(), revision=session.revision, assignment_id=assignment.id, action="save", text=draft,
    )
    with pytest.raises(NotFound):
        store.save_assignment("other-owner", str(session.id), request)
    saved = store.save_assignment("learner", str(session.id), request)
    assert saved.status == "draft" and store.save_assignment("learner", str(session.id), request).replayed
    with pytest.raises(InvalidInput, match="already used"):
        store.save_assignment("learner", str(session.id), request.model_copy(update={"text": "Different draft"}))
    with pytest.raises(InvalidInput, match="changed"):
        store.save_assignment("learner", str(session.id), request.model_copy(update={"id": uuid4()}))
    resumed = store.get_session("learner", str(session.id))
    assert resumed.assignment_drafts[assignment.id] == draft and resumed.assignment_status[assignment.id] == "draft"
    submit = AssignmentDraftRequest(
        id=uuid4(), revision=resumed.revision, assignment_id=assignment.id, action="submit", text=draft,
    )
    submitted = store.save_assignment("learner", str(session.id), submit)
    assert submitted.status == "submitted" and store.save_assignment("learner", str(session.id), submit).replayed
    resumed = store.get_session("learner", str(session.id))
    assert resumed.assignment_drafts[assignment.id] == draft and resumed.assignment_status[assignment.id] == "submitted"
    assert resumed.completed_lesson_ids == [] and resumed.status == "active"
    assert not store.documents.list_flashcards(str(session.document_id), "learner")
    assert store.track_attempt_counts("learner") == {} and store.misconception_counts("learner") == {}
    with pytest.raises(NotFound):
        store.get_session("other-owner", str(session.id))


def test_expansion_http_catalog_diagnostics_and_enrollment_keep_keys_private(release):
    store = MemoryCourseStore(InMemoryDocumentStore())

    def user(x_user: str = Header(default="learner")):
        return x_user

    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(create_course_router(user, store))
    with TestClient(app) as client:
        detail = client.get(f"/api/courses/{release.slug}")
        assert detail.status_code == 200
        assert detail.json()["prerequisite_met"] == (not release.prerequisites)
        _no_private_keys(detail.json())
        diagnostic = client.get(f"/api/courses/{release.slug}/diagnostic")
        assert diagnostic.status_code == 200
        questions = diagnostic.json()["questions"]
        assert {item["id"] for item in questions} == _answers(release).keys()
        assert all(set(item) == {"id", "prompt", "kind"} for item in questions)
        if release.prerequisites:
            assert client.post(f"/api/courses/{release.slug}/enroll", json={}).status_code == 400
        else:
            assert questions == []
            assert client.post(f"/api/courses/{release.slug}/enroll", json={}).status_code == 200
        enrolled = client.post(f"/api/courses/{release.slug}/enroll", json={"diagnostic_answers": _answers(release)})
        assert enrolled.status_code == 200, enrolled.text
        data = enrolled.json()
        _no_private_keys(data["lesson"])
        assert "exercises" not in data and "sources" not in data
        assert client.get(f"/api/course-enrollments/{data['id']}", headers={"x-user": "stranger"}).status_code == 404
        assert client.get("/api/course-enrollments", headers={"x-user": "stranger"}).json() == {"sessions": []}
        assert '"expected_query"' not in json.dumps(detail.json())
