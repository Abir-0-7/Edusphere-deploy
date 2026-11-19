"""C04 previews are private, checked against current evidence, and append-only."""

from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, Header
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.courses.catalog import python_foundations
from app.courses.store import MemoryCourseStore
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, Unauthorized, api_error_handler, error_body
from app.learners.contracts import LearnerProfileInput
from app.learners.store import MemoryLearnerStore
from app.learners.track_contracts import PinnedRelease
from app.learners.track_routes import TrackProgress, preview_plan, track_progress, track_router
from app.learners.track_store import MemoryTrackPlanStore

PIN = PinnedRelease(
    enrollment_id=UUID("d638651b-d2e4-4e0d-80e9-2d5e6136f188"),
    release_id=UUID("d638651b-d2e4-4e0d-80e9-2d5e6136f189"),
    course_slug="python-foundations",
)
BASE = "/api/learner-profile/track-plan"
ALICE = {"Authorization": "Bearer alice"}
BOB = {"Authorization": "Bearer bob"}


@pytest.fixture
def app_with_history():
    profiles = MemoryLearnerStore()
    plans = MemoryTrackPlanStore()
    base = LearnerProfileInput.model_validate(
        {
            "goal_kind": "career",
            "goal": "Learn Python",
            "weekly_minutes": 120,
            "deadline": None,
            "familiarity": "new",
            "language": "en",
            "accessibility": {"reduced_motion": False, "larger_text": False, "text_alternative": False},
        }
    )
    profiles.save("alice", base)
    profiles.save("bob", base.model_copy(update={"goal_kind": "academic"}))
    progress = {
        "alice": TrackProgress(
            frozenset({"py-values-objective", "pt-tensors-objective"}),
            {"py-values-objective": 2, "pt-tensors-objective": 4},
            (PIN,),
        )
    }
    app = FastAPI()

    async def user(authorization: str | None = Header(default=None)):
        if authorization not in {"Bearer alice", "Bearer bob", "Bearer no-profile"}:
            raise Unauthorized()
        yield authorization.removeprefix("Bearer ")

    @app.exception_handler(RequestValidationError)
    async def validation_error(_, __):
        return JSONResponse(status_code=400, content=error_body("Invalid request", "invalid_input"))

    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(track_router(user, profiles, plans, lambda owner: progress.get(owner, TrackProgress())))
    return TestClient(app), plans, progress


def apply_request(client, headers, preview):
    return client.post(
        f"{BASE}/apply",
        headers=headers,
        json={
            "target_track_id": preview["target_track_id"],
            "expected_revision": preview["expected_revision"],
            "preview_id": preview["preview_id"],
        },
    )


def preview_for(client, headers, track):
    result = client.post(f"{BASE}/preview", json={"target_track_id": track}, headers=headers)
    assert result.status_code == 200, result.text
    assert result.headers["cache-control"] == "private, no-store"
    return result.json()


def test_preview_apply_and_change_back_preserve_attempts_and_releases(app_with_history):
    client, plans, progress = app_with_history
    assert client.get(BASE, headers=ALICE).json() == {
        "current_track_id": "analyst",
        "current_revision": 0,
        "plan": None,
    }
    generated = preview_for(client, ALICE, "developer")
    assert plans.get("alice") is None
    assert generated["plan_revision"] == 1 and generated["change_kind"] == "plan_revision"
    assert generated["next_action"] == "recompute_recommendations"
    assert generated["added_course_slugs"] == ["pytorch-fundamentals"]
    assert generated["preserved_completed_objective_ids"] == ["pt-tensors-objective", "py-values-objective"]
    assert generated["pinned_releases"] == [PIN.model_dump(mode="json")]
    assert generated["curriculum_release_changes"] == 0
    assert apply_request(client, ALICE, generated).status_code == 200
    assert apply_request(client, ALICE, generated).status_code == 409

    narrowed = preview_for(client, ALICE, "programming-exam")
    assert narrowed["removed_course_slugs"] == ["pytorch-fundamentals"]
    assert narrowed["preserved_completed_objective_ids"] == ["py-values-objective"]
    assert narrowed["completed_objectives_no_longer_required"] == ["pt-tensors-objective"]
    assert narrowed["pinned_releases"] == generated["pinned_releases"]
    assert narrowed["objective_mapping"] == [
        {
            **item,
            "status": "no_longer_required" if item["objective_id"].startswith("pt-") else "shared",
        }
        for item in generated["objective_mapping"]
    ]
    applied = apply_request(client, ALICE, narrowed)
    assert applied.json()["revision"] == 2
    assert applied.json()["prior_attempts_unchanged"] is True
    assert applied.json()["pinned_releases_unchanged"] is True
    assert progress["alice"].pinned_releases == (PIN,)
    assert progress["alice"].attempts_per_objective["pt-tensors-objective"] == 4
    history = client.get(f"{BASE}/history", headers=ALICE).json()
    assert [item["track_id"] for item in history["history"]] == ["programming-exam", "developer"]
    assert len(client.get(f"{BASE}/history?before_revision=2", headers=ALICE).json()["history"]) == 1
    assert client.get(f"{BASE}/history", headers=BOB).json()["history"] == []
    assert client.get(f"{BASE}/options", headers=BOB).json()["current_track_id"] == "programming-exam"


def test_rejects_cross_account_preview_stale_progress_and_fabricated_fields(app_with_history):
    client, _, progress = app_with_history
    anonymous = client.get(f"{BASE}/options")
    assert anonymous.status_code == 401
    assert client.get(f"{BASE}/options", headers={"Authorization": "Bearer no-profile"}).status_code == 404
    preview = preview_for(client, ALICE, "developer")
    assert apply_request(client, BOB, preview).status_code == 409
    progress["alice"] = TrackProgress()
    assert apply_request(client, ALICE, preview).status_code == 409
    assert (
        client.post(
            f"{BASE}/preview",
            headers=ALICE,
            json={"target_track_id": "developer", "completed_objective_ids": ["pt-tensors-objective"]},
        ).status_code
        == 400
    )
    assert apply_request(client, ALICE, preview_for(client, ALICE, "developer")).status_code == 200


def test_real_checkpoint_history_survives_switch_without_mutating_pinned_enrollment():
    release = python_foundations()
    courses = MemoryCourseStore(InMemoryDocumentStore(), releases=[release])
    plans = MemoryTrackPlanStore()
    first = courses.enroll("alice", release.slug)
    checkpoint = next(exercise for exercise in release.exercises if exercise.id == first.lesson.checkpoint.id)
    action = {
        "id": str(uuid4()),
        "revision": first.revision,
        "exercise_id": checkpoint.id,
        "answer": checkpoint.answer,
    }
    saved_attempt = courses.action("alice", str(first.id), "attempt", action)
    assert saved_attempt["correct"] and saved_attempt["independent"]
    before = courses.get_session("alice", str(first.id))
    progress = track_progress(courses, "alice")
    assert progress.completed_objective_ids == frozenset(checkpoint.objective_ids)
    assert progress.attempts_per_objective == dict.fromkeys(checkpoint.objective_ids, 1)
    assert track_progress(courses, "bob") == TrackProgress()
    plan = plans.apply("alice", preview_plan("alice", "career", None, "developer", progress))
    switched = preview_plan("alice", "career", plan, "programming-exam", progress)
    assert switched.preserved_completed_objective_ids == checkpoint.objective_ids
    assert switched.removed_course_slugs == ["pytorch-fundamentals"]
    plans.apply("alice", switched)
    assert courses.get_session("alice", str(first.id)) == before
    replayed = courses.action("alice", str(first.id), "attempt", action)
    assert replayed == {**saved_attempt, "replayed": True}
    assert track_progress(courses, "alice") == progress
