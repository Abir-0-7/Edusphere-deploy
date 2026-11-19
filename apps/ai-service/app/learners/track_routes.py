"""Read-only preview and optimistic, owner-scoped apply for an authored track."""

import hashlib
import json
from collections.abc import AsyncIterator, Callable
from dataclasses import asdict, dataclass, field
from typing import Annotated, Protocol

import psycopg
from fastapi import APIRouter, Depends, Query, Response

from app.courses.contracts import SessionResponse
from app.errors import ApiError, InvalidInput, NotFound
from app.learners.store import LearnerStore
from app.learners.track_contracts import (
    ObjectiveMapping,
    PinnedRelease,
    SavedTrackPlan,
    TrackCatalogResponse,
    TrackChangeApplied,
    TrackChangeApplyRequest,
    TrackChangePreview,
    TrackChangeRequest,
    TrackDefinition,
    TrackPlanHistoryResponse,
    TrackPlanResponse,
)
from app.learners.track_store import HISTORY_PAGE_SIZE, TrackPlanStore
from app.learners.tracks import TRACKS, default_track


@dataclass(frozen=True)
class TrackProgress:
    completed_objective_ids: frozenset[str] = frozenset()
    attempts_per_objective: dict[str, int] = field(default_factory=dict)
    pinned_releases: tuple[PinnedRelease, ...] = ()


class TrackCourses(Protocol):
    def list_sessions(self, user_id: str) -> list[SessionResponse]: ...
    def track_attempt_counts(self, user_id: str) -> dict[str, int]: ...


def track_progress(courses: TrackCourses, user_id: str) -> TrackProgress:
    """Read only server-graded, owner-scoped evidence from each pinned release."""
    tracked_courses = {slug for track in TRACKS.values() for slug in track.required_course_slugs}
    sessions = [session for session in courses.list_sessions(user_id) if session.course_slug in tracked_courses]
    return TrackProgress(
        completed_objective_ids=frozenset(
            objective
            for session in sessions
            for lesson in session.lessons
            for objective in lesson.demonstrated_objective_ids
        ),
        attempts_per_objective=courses.track_attempt_counts(user_id),
        pinned_releases=tuple(
            PinnedRelease(enrollment_id=session.id, course_slug=session.course_slug, release_id=session.release_id)
            for session in sessions
        ),
    )


def preview_plan(
    user_id: str,
    goal_kind: str,
    prior: SavedTrackPlan | None,
    target_track_id: str,
    progress: TrackProgress,
) -> TrackChangePreview:
    current = TRACKS[prior.track_id if prior else default_track(goal_kind)]
    target = TRACKS[target_track_id]
    old_courses = prior.required_course_slugs if prior else current.required_course_slugs
    old_objectives = prior.required_objective_ids if prior else current.required_objective_ids
    new_courses = target.required_course_slugs
    new_objectives = target.required_objective_ids
    if (
        prior
        and current.id == target.id
        and old_courses == list(new_courses)
        and old_objectives == list(new_objectives)
    ):
        raise InvalidInput("This track is already your current learning plan")
    added = set(new_objectives) - set(old_objectives)
    removed = set(old_objectives) - set(new_objectives)
    mapping = [
        ObjectiveMapping(
            objective_id=obj,
            status="new_requirement" if obj in added else "no_longer_required" if obj in removed else "shared",
            completed=obj in progress.completed_objective_ids,
            attempts_preserved=progress.attempts_per_objective.get(obj, 0),
        )
        for obj in sorted(set(old_objectives) | set(new_objectives))
    ]
    revision = prior.revision if prior else 0
    result = TrackChangePreview(
        preview_id="0" * 64,
        expected_revision=revision,
        plan_revision=revision + 1,
        current_track_id=current.id,
        target_track_id=target.id,
        required_course_slugs=list(new_courses),
        required_objective_ids=list(new_objectives),
        added_course_slugs=sorted(set(new_courses) - set(old_courses)),
        removed_course_slugs=sorted(set(old_courses) - set(new_courses)),
        added_objective_ids=sorted(added),
        removed_objective_ids=sorted(removed),
        preserved_completed_objective_ids=sorted(progress.completed_objective_ids.intersection(new_objectives)),
        completed_objectives_no_longer_required=sorted(progress.completed_objective_ids.intersection(removed)),
        objective_mapping=mapping,
        pinned_releases=sorted(progress.pinned_releases, key=lambda pin: str(pin.enrollment_id)),
    )
    # A stale or cross-account preview cannot silently confirm a different change.
    snapshot = result.model_dump(mode="json", exclude={"preview_id"})
    digest = hashlib.sha256(json.dumps([user_id, snapshot], sort_keys=True).encode()).hexdigest()
    return result.model_copy(update={"preview_id": digest})


def track_router(
    user_dependency: Callable[..., AsyncIterator[str]],
    profiles: LearnerStore,
    plans: TrackPlanStore,
    read_progress: Callable[[str], TrackProgress],
) -> APIRouter:
    def private_cache(response: Response) -> None:
        response.headers["Cache-Control"] = "private, no-store"

    router = APIRouter(
        prefix="/api/learner-profile/track-plan",
        tags=["Learning tracks"],
        dependencies=[Depends(private_cache)],
        responses={
            400: {"description": "Invalid request"},
            404: {"description": "Profile not found"},
            409: {"description": "Stale preview"},
            503: {"description": "Track storage unavailable"},
        },
    )
    User = Annotated[str, Depends(user_dependency)]

    def load_current(user_id: str) -> tuple[str, SavedTrackPlan | None]:
        profile = profiles.get(user_id)
        if profile is None:
            raise NotFound("Save your learning profile before choosing a track")
        return profile.goal_kind, plans.get(user_id)

    def fail_closed() -> ApiError:
        return ApiError("Learning track storage is temporarily unavailable", status_code=503)

    @router.get("", response_model=TrackPlanResponse)
    def current_plan(user_id: User) -> TrackPlanResponse:
        try:
            goal_kind, prior = load_current(user_id)
        except psycopg.Error as error:
            raise fail_closed() from error
        return TrackPlanResponse(
            current_revision=prior.revision if prior else 0,
            current_track_id=prior.track_id if prior else default_track(goal_kind),
            plan=prior,
        )

    @router.get("/options", response_model=TrackCatalogResponse)
    def catalog(user_id: User) -> TrackCatalogResponse:
        current = current_plan(user_id)
        return TrackCatalogResponse(
            tracks=[TrackDefinition.model_validate(asdict(item)) for item in TRACKS.values()],
            current_revision=current.current_revision,
            current_track_id=current.current_track_id,
        )

    @router.get("/history", response_model=TrackPlanHistoryResponse)
    def history(user_id: User, before_revision: Annotated[int | None, Query(ge=1, le=2_147_483_647)] = None):
        current = current_plan(user_id)
        try:
            prior = plans.history(user_id, before_revision)
        except psycopg.Error as error:
            raise fail_closed() from error
        return TrackPlanHistoryResponse(
            current_revision=current.current_revision,
            current_track_id=current.current_track_id,
            history=prior,
            next_before_revision=prior[-1].revision
            if len(prior) == HISTORY_PAGE_SIZE and prior[-1].revision > 1
            else None,
        )

    @router.post("/preview", response_model=TrackChangePreview)
    def preview(body: TrackChangeRequest, user_id: User) -> TrackChangePreview:
        try:
            goal_kind, prior = load_current(user_id)
            return preview_plan(user_id, goal_kind, prior, body.target_track_id, read_progress(user_id))
        except psycopg.Error as error:
            raise fail_closed() from error

    @router.post("/apply", response_model=TrackChangeApplied)
    def apply(body: TrackChangeApplyRequest, user_id: User) -> TrackChangeApplied:
        try:
            goal_kind, prior = load_current(user_id)
            if body.expected_revision != (prior.revision if prior else 0):
                raise InvalidInput("Learning plan changed; review the new preview before applying", status_code=409)
            latest = preview_plan(user_id, goal_kind, prior, body.target_track_id, read_progress(user_id))
            if latest.preview_id != body.preview_id:
                raise InvalidInput("Learning progress changed; review the new preview before applying", status_code=409)
            saved = plans.apply(
                user_id,
                latest,
                refresh=lambda: preview_plan(
                    user_id, goal_kind, prior, body.target_track_id, read_progress(user_id)
                ),
            )
            return TrackChangeApplied(**saved.model_dump())
        except psycopg.Error as error:
            raise fail_closed() from error

    return router
