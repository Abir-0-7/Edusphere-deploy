"""Course practice labs are bounded simulations, not code execution or mastery evidence."""

import hashlib
import hmac
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient

from app.courses.catalog import DIAGNOSTIC, catalog, python_foundations
from app.courses.catalog_candidates import candidates
from app.courses.contracts import AssignmentDraftRequest, LabRunRequest
from app.courses.lab_receipts import verify_code_receipt
from app.courses.labs import public_lab
from app.courses.router import create_course_router
from app.courses.store import MemoryCourseStore
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, InvalidInput, NotFound, api_error_handler


def _setup(slug: str):
    release = next(item for item in candidates() if item.slug == slug).model_copy(update={"status": "published"})
    docs = InMemoryDocumentStore()
    store = MemoryCourseStore(docs, releases=[release])
    session = store.enroll("learner-a", slug)
    return release, docs, store, session


def _receipt(
    secret: str, *, enrollment_id: str, lab_id: str, task_id: str, problem_id: str, language: str, source: str
) -> str:
    expires = int(time.time()) + 120
    source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
    claims = "\n".join([str(expires), enrollment_id, lab_id, task_id, problem_id, language, source_hash])
    signature = hmac.new(secret.encode("utf-8"), claims.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{expires}.{source_hash}.{signature}"


def test_published_courses_include_coding_shell_labs_and_assignments():
    releases = catalog()
    assert {release.slug for release in releases} == {
        "python-foundations", "pytorch-fundamentals", "sql-query-foundations", "git-foundations",
        "practical-python-foundations"
    }
    for release in releases:
        if release.size == "full":
            assert release.status == "published"
            assert release.labs == []
            assert release.required_assignment_ids == ["pp-capstone"]
            continue
        assert release.status == "published"
        assert release.version == "2"
        assert release.labs and len(release.assignments) == 1
        if release.slug == "sql-query-foundations":
            assert {lab.kind for lab in release.labs} == {"sql_query"}
            continue
        if release.slug == "git-foundations":
            assert {lab.kind for lab in release.labs} == {"git_shell"}
            continue
        assert {lab.kind for lab in release.labs} == {"code_editor", "git_shell"}
        code_lab = next(lab for lab in release.labs if lab.kind == "code_editor")
        assert all(task.runner_problem_id for task in code_lab.tasks)
        assert all(task.starter and "#" in task.starter for task in code_lab.tasks)
        assert all(task.starter_javascript and "//" in task.starter_javascript for task in code_lab.tasks)
        starter_code = "\n".join(
            [task.starter or "" for task in code_lab.tasks] + [task.starter_javascript or "" for task in code_lab.tasks]
        )
        assert "print(sum(values) / len(values))" not in starter_code
        assert "sum(score >= 60" not in starter_code
        assert "console.log(scores.filter" not in starter_code
        assert "total += amount" not in starter_code
        assert len(release.assignments) == 1


def test_published_git_shell_is_usable_on_both_courses():
    for release in catalog():
        if release.slug not in {"python-foundations", "pytorch-fundamentals"}:
            continue
        docs = InMemoryDocumentStore()
        store = MemoryCourseStore(docs, releases=[release])
        diagnostic = {key: answer for key, (_, answer) in DIAGNOSTIC.items()} if release.prerequisites else None
        session = store.enroll("learner-a", release.slug, diagnostic)
        lab = next(item for item in release.labs if item.kind == "git_shell")
        for command in [
            "git status",
            "git add reports/summary.md",
            "git diff --staged",
            'git commit -m "Add weekly summary"',
            "git switch -c feature/weekly-summary",
            "git log --oneline --graph",
        ]:
            current = store.get_session("learner-a", str(session.id))
            result = store.run_lab(
                "learner-a",
                str(session.id),
                LabRunRequest(id=uuid4(), revision=current.revision, lab_id=lab.id, text=command),
            )
            assert result.accepted
        assert result.complete and result.progress == len(lab.tasks)


def test_code_lab_progress_requires_valid_sandbox_receipt(monkeypatch):
    secret = "test-course-lab-receipt-secret-at-least-32-chars"
    monkeypatch.setattr("app.settings.get_settings", lambda: SimpleNamespace(course_lab_receipt_secret=secret))
    release = python_foundations()
    docs = InMemoryDocumentStore()
    store = MemoryCourseStore(docs, releases=[release])
    session = store.enroll("learner-a", release.slug)
    lab = next(item for item in release.labs if item.kind == "code_editor")
    task = lab.tasks[0]
    source = task.starter or "print(1)"

    rejected = store.run_lab(
        "learner-a",
        str(session.id),
        LabRunRequest(id=uuid4(), revision=session.revision, lab_id=lab.id, task_id=task.id, text=source),
    )
    assert rejected.accepted is False
    assert store.get_session("learner-a", str(session.id)).lab_progress[lab.id] == 0

    receipt = _receipt(
        secret,
        enrollment_id=str(session.id),
        lab_id=lab.id,
        task_id=task.id,
        problem_id=task.runner_problem_id or "",
        language="python",
        source=source,
    )
    accepted = store.run_lab(
        "learner-a",
        str(session.id),
        LabRunRequest(
            id=uuid4(),
            revision=store.get_session("learner-a", str(session.id)).revision,
            lab_id=lab.id,
            task_id=task.id,
            text=source,
            runner_receipt=receipt,
            runner_problem_id=task.runner_problem_id,
            runner_language="python",
        ),
    )
    assert accepted.accepted and accepted.progress == 1
    assert store.misconception_counts("learner-a") == {}
    assert store.track_attempt_counts("learner-a") == {}


def test_code_receipt_is_bound_to_source_and_expiry():
    source = "print(12)"
    receipt = _receipt(
        "test-course-lab-receipt-secret-at-least-32-chars",
        enrollment_id="enroll-1",
        lab_id="lab-1",
        task_id="task-1",
        problem_id="tensor-value-count",
        language="python",
        source=source,
    )
    fields = {
        "secret": "test-course-lab-receipt-secret-at-least-32-chars",
        "enrollment_id": "enroll-1",
        "lab_id": "lab-1",
        "task_id": "task-1",
        "problem_id": "tensor-value-count",
        "language": "python",
        "source": source,
    }
    assert verify_code_receipt(receipt, **fields)
    assert not verify_code_receipt(receipt, **{**fields, "source": "print(0)"})
    assert not verify_code_receipt(receipt, **{**fields, "enrollment_id": "other"})
    assert not verify_code_receipt(receipt, **fields, now=int(time.time()) + 180)


def test_sql_lab_matches_only_authored_queries_and_never_creates_learning_evidence():
    release, docs, store, session = _setup("sql-query-foundations")
    lab = public_lab(release.labs[0])
    public = lab.model_dump(mode="json")
    assert all("expected_query" not in task and "expected_output" not in task for task in public["tasks"])

    unsafe = store.run_lab(
        "learner-a",
        str(session.id),
        LabRunRequest(
            id=uuid4(),
            revision=session.revision,
            lab_id=lab.id,
            task_id=lab.tasks[0].id,
            text="DROP TABLE products;",
        ),
    )
    assert unsafe.accepted is False
    assert "Nothing was executed" in unsafe.output

    for task in release.labs[0].tasks:
        current = store.get_session("learner-a", str(session.id))
        result = store.run_lab(
            "learner-a",
            str(session.id),
            LabRunRequest(
                id=uuid4(),
                revision=current.revision,
                lab_id=lab.id,
                task_id=task.id,
                text=task.expected_query or "",
            ),
        )
        assert result.accepted is True
        assert result.complete is (task.id == release.labs[0].tasks[-1].id)
        assert task.expected_output in result.output

    finished = store.get_session("learner-a", str(session.id))
    assert finished.lab_progress[lab.id] == 3
    assert len(finished.lab_transcripts[lab.id]) == 4
    assert store.misconception_counts("learner-a") == {}
    assert store.track_attempt_counts("learner-a") == {}
    assert docs.get_for_user(str(session.document_id), "learner-a") is not None


def test_git_lab_simulates_allowlisted_commands_and_replays_actions_idempotently():
    release, _, store, session = _setup("git-foundations")
    lab_id = release.labs[0].id

    first = LabRunRequest(id=uuid4(), revision=session.revision, lab_id=lab_id, text="git status; whoami")
    rejected = store.run_lab("learner-a", str(session.id), first)
    assert not rejected.accepted
    assert "operating-system shell" in rejected.output

    request = LabRunRequest(id=uuid4(), revision=rejected.revision, lab_id=lab_id, text="git status")
    result = store.run_lab("learner-a", str(session.id), request)
    replay = store.run_lab("learner-a", str(session.id), request)
    assert result.output == replay.output
    assert replay.replayed is True
    assert replay.revision == result.revision

    commands = [
        "git add reports/summary.md",
        "git diff --staged",
        'git commit -m "Add weekly summary"',
        "git switch -c feature/weekly-summary",
        "git log --oneline --graph",
    ]
    for command in commands:
        current = store.get_session("learner-a", str(session.id))
        result = store.run_lab(
            "learner-a",
            str(session.id),
            LabRunRequest(id=uuid4(), revision=current.revision, lab_id=lab_id, text=command),
        )
        assert result.accepted
    assert result.complete and result.progress == 3
    assert store.misconception_counts("learner-a") == {}
    assert store.track_attempt_counts("learner-a") == {}


def test_assignment_draft_submits_without_grading_and_is_owner_scoped():
    _, _, store, session = _setup("git-foundations")
    assignment_id = "git-release-workflow"
    with pytest.raises(InvalidInput, match="short explanation"):
        store.save_assignment(
            "learner-a",
            str(session.id),
            AssignmentDraftRequest(
                id=uuid4(), revision=session.revision, assignment_id=assignment_id, action="submit", text="too short"
            ),
        )

    draft = "git status\ngit add reports/summary.md\ngit diff --staged\ngit commit -m 'Add weekly summary'\n"
    saved = store.save_assignment(
        "learner-a",
        str(session.id),
        AssignmentDraftRequest(
            id=uuid4(), revision=session.revision, assignment_id=assignment_id, action="save", text=draft
        ),
    )
    assert saved.status == "draft"
    current = store.get_session("learner-a", str(session.id))
    submitted = store.save_assignment(
        "learner-a",
        str(session.id),
        AssignmentDraftRequest(
            id=uuid4(), revision=current.revision, assignment_id=assignment_id, action="submit", text=draft * 2
        ),
    )
    assert submitted.status == "submitted"
    resumed = store.get_session("learner-a", str(session.id))
    assert resumed.assignment_drafts[assignment_id] == draft * 2
    assert resumed.assignment_status[assignment_id] == "submitted"
    with pytest.raises(NotFound):
        store.get_session("learner-b", str(session.id))
    with pytest.raises(InvalidInput, match="not part of this course"):
        store.save_assignment(
            "learner-a",
            str(session.id),
            AssignmentDraftRequest(
                id=uuid4(),
                revision=resumed.revision,
                assignment_id="other-course-assignment",
                action="save",
                text="attempt to store another course's assignment",
            ),
        )
    assert store.misconception_counts("learner-a") == {}
    assert store.track_attempt_counts("learner-a") == {}


def test_lab_and_assignment_http_contracts_redact_keys_and_enforce_owner_scope():
    release, _, store, _ = _setup("sql-query-foundations")
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)

    def user_id(x_user: str = Header()):
        return x_user

    app.include_router(create_course_router(user_id, store))
    client = TestClient(app)
    headers = {"X-User": "learner-a"}
    detail = client.get(f"/api/courses/{release.slug}", headers=headers)
    assert detail.status_code == 200
    lab_public = detail.json()["labs"][0]
    assert all("expected_query" not in task for task in lab_public["tasks"])
    assert all("expected_output" not in task for task in lab_public["tasks"])
    assert len(detail.json()["assignments"]) == 1

    enrolled = client.post(f"/api/courses/{release.slug}/enroll", json={}, headers=headers).json()
    lab_task = release.labs[0].tasks[0]
    submitted = client.post(
        f"/api/course-enrollments/{enrolled['id']}/labs",
        json={
            "id": str(uuid4()),
            "revision": enrolled["revision"],
            "lab_id": release.labs[0].id,
            "task_id": lab_task.id,
            "text": "DROP TABLE products;",
        },
        headers=headers,
    )
    assert submitted.status_code == 200 and submitted.json()["accepted"] is False
    assert "Nothing was executed" in submitted.json()["output"]

    assignment = release.assignments[0]
    saved = client.put(
        f"/api/course-enrollments/{enrolled['id']}/assignments",
        json={
            "id": str(uuid4()),
            "revision": submitted.json()["revision"],
            "assignment_id": assignment.id,
            "action": "save",
            "text": "SELECT category, COUNT(*) FROM products GROUP BY category;\n" + "Explanation. " * 10,
        },
        headers=headers,
    )
    assert saved.status_code == 200 and saved.json()["status"] == "draft"
    other = client.get(f"/api/course-enrollments/{enrolled['id']}", headers={"X-User": "learner-b"})
    assert other.status_code == 404
