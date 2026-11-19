"""Versioned API contracts for plan changes; never accepts learner progress claims."""

from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

TrackId = Literal["analyst", "developer", "programming-exam"]
CourseSlug = Literal["python-foundations", "pytorch-fundamentals"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TrackDefinition(Contract):
    id: TrackId
    goal_kind: Literal["career", "academic"]
    title: str
    description: str
    required_course_slugs: list[CourseSlug]
    required_objective_ids: list[str]


class TrackCatalogResponse(Contract):
    tracks: list[TrackDefinition]
    current_track_id: TrackId
    current_revision: Annotated[int, Field(ge=0)]


class PinnedRelease(Contract):
    enrollment_id: UUID
    course_slug: CourseSlug
    release_id: UUID


class ObjectiveMapping(Contract):
    objective_id: str
    status: Literal["shared", "new_requirement", "no_longer_required"]
    completed: bool
    attempts_preserved: Annotated[int, Field(ge=0)]


class TrackChangePreview(Contract):
    preview_id: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_revision: Annotated[int, Field(ge=0)]
    plan_revision: Annotated[int, Field(ge=1)]
    current_track_id: TrackId
    target_track_id: TrackId
    required_course_slugs: list[CourseSlug]
    required_objective_ids: list[str]
    added_course_slugs: list[CourseSlug]
    removed_course_slugs: list[CourseSlug]
    added_objective_ids: list[str]
    removed_objective_ids: list[str]
    preserved_completed_objective_ids: list[str]
    completed_objectives_no_longer_required: list[str]
    objective_mapping: list[ObjectiveMapping]
    pinned_releases: list[PinnedRelease]
    attempt_history_preserved: Literal[True] = True
    curriculum_release_changes: Literal[0] = 0
    change_kind: Literal["plan_revision"] = "plan_revision"
    next_action: Literal["recompute_recommendations"] = "recompute_recommendations"
    notice: Literal[
        "A track change revises your plan only. Enrolled course releases and past attempts stay unchanged."
    ] = "A track change revises your plan only. Enrolled course releases and past attempts stay unchanged."

    @model_validator(mode="after")
    def validate_mappings(self):
        required = set(self.required_objective_ids)
        removed = set(self.removed_objective_ids)
        if not set(self.preserved_completed_objective_ids) <= required:
            raise ValueError("preserved objective must remain required")
        if not set(self.completed_objectives_no_longer_required) <= removed:
            raise ValueError("completed removed objective mapping is invalid")
        return self


class TrackChangeRequest(Contract):
    target_track_id: TrackId


class TrackChangeApplyRequest(TrackChangeRequest):
    expected_revision: Annotated[int, Field(strict=True, ge=0)]
    preview_id: str = Field(pattern=r"^[0-9a-f]{64}$")


class SavedTrackPlan(Contract):
    revision: Annotated[int, Field(ge=1)]
    track_id: TrackId
    required_course_slugs: list[CourseSlug]
    required_objective_ids: list[str]
    objective_mapping: list[ObjectiveMapping]
    created_at: AwareDatetime


class TrackPlanResponse(Contract):
    current_revision: Annotated[int, Field(ge=0)]
    current_track_id: TrackId
    plan: SavedTrackPlan | None


class TrackChangeApplied(Contract):
    revision: Annotated[int, Field(ge=1)]
    track_id: TrackId
    required_course_slugs: list[CourseSlug]
    required_objective_ids: list[str]
    objective_mapping: list[ObjectiveMapping]
    created_at: AwareDatetime
    pinned_releases_unchanged: Literal[True] = True
    prior_attempts_unchanged: Literal[True] = True


class TrackPlanHistoryResponse(Contract):
    current_revision: Annotated[int, Field(ge=0)]
    current_track_id: TrackId
    history: list[SavedTrackPlan]
    next_before_revision: Annotated[int, Field(ge=1)] | None


def now_utc() -> datetime:
    """Small injectable timestamp helper for storage tests."""
    return datetime.now(UTC)
