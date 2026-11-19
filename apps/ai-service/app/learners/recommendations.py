"""Career recommendations based on committed course checkpoints and the review queue."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from typing import Annotated, Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends
from psycopg.types.json import Jsonb
from pydantic import Field, StrictInt

from app.courses.contracts import CourseRelease, SessionResponse
from app.errors import ApiError
from app.learners.contracts import LearnerProfile, StrictModel
from app.learners.tracks import TRACKS, default_track

MasteryState = Literal["unknown", "developing", "needs_practice", "demonstrated"]
ActivityKind = Literal["set_goal", "review", "lesson", "resume", "remediate", "transfer"]


@dataclass(frozen=True)
class Policy:
    version: str = "career-next-action-v1"
    default_session_minutes: int = 20
    review_minutes: int = 5
    remediation_minutes: int = 5
    checkpoint_minutes: int = 5
    min_lesson_minutes: int = 10
    repeat_errors: int = 2


POLICY = Policy()


class RecommendationRequest(StrictModel):
    available_minutes: Annotated[StrictInt, Field(ge=1, le=10080)] | None = None


class ObjectiveMastery(StrictModel):
    objective_id: str
    title: str
    state: MasteryState
    evidence: Literal["none", "diagnostic", "committed_attempt", "independent_checkpoint"]
    starting_signal: Literal["unknown", "needs_practice", "developing"] = "unknown"
    release_id: UUID


class RecommendationActivity(StrictModel):
    kind: ActivityKind
    title: str
    reason: str
    href: str
    minutes: int = Field(ge=0)
    objective_id: str | None = None


class BlockedRecommendation(StrictModel):
    course_slug: str
    reason: str


class RecommendationResponse(StrictModel):
    policy_version: str
    track_id: Literal["analyst", "developer", "programming-exam"] | None
    plan_revision: int = Field(ge=0)
    available_minutes: int = Field(ge=0)
    due_reviews: int = Field(ge=0)
    mastery: list[ObjectiveMastery]
    next_action: RecommendationActivity | None
    blocked: list[BlockedRecommendation]


_DIAGNOSTIC_OBJECTIVES = {
    "python-expressions": "py-values-objective",
    "python-loops": "py-loops-objective",
    "python-functions": "py-functions-objective",
}


def recommend(
    profile: LearnerProfile | None,
    releases: Sequence[CourseRelease],
    sessions: Sequence[SessionResponse],
    completed_courses: set[str],
    misconceptions: Mapping[str, int],
    due_reviews: int,
    available_minutes: int | None = None,
    *,
    track_id: str | None = None,
    plan_revision: int = 0,
    required_courses: Sequence[str] | None = None,
    policy: Policy = POLICY,
) -> RecommendationResponse:
    if profile is None:
        return RecommendationResponse(
            policy_version=policy.version,
            track_id=None,
            plan_revision=0,
            available_minutes=0,
            due_reviews=due_reviews,
            mastery=[],
            blocked=[],
            next_action=RecommendationActivity(
                kind="set_goal",
                title="Set a learning goal",
                reason="Save a goal and study time to get a starting recommendation.",
                href="/learning-profile",
                minutes=0,
            ),
        )
    track_id = track_id or default_track(profile.goal_kind)
    required_courses = required_courses if required_courses is not None else TRACKS[track_id].required_course_slugs
    budget = min(profile.weekly_minutes, available_minutes or policy.default_session_minutes)
    catalog = {release.slug: release for release in releases}
    allowed = set(required_courses)
    pinned = {}
    for session in sessions:
        if session.course_slug in allowed:
            pinned.setdefault(session.course_slug, session)
    checkpoint_evidence = {
        (session.course_slug, objective_id): session.release_id
        for session in sessions
        for lesson in session.lessons
        if lesson.completed
        for objective_id in lesson.demonstrated_objective_ids
    }
    diagnostic_signals = (
        {
            _DIAGNOSTIC_OBJECTIVES[item.skill_id]: item.state
            for item in profile.diagnostic.skills
            if item.state != "unknown"
        }
        if profile.diagnostic.status == "completed"
        else {}
    )
    mastery, blocked, activities = [], [], []
    if due_reviews:
        activities.append(
            RecommendationActivity(
                kind="review",
                title="Review due cards",
                minutes=policy.review_minutes,
                href="/review",
                reason=f"{due_reviews} scheduled {'review is' if due_reviews == 1 else 'reviews are'} due.",
            )
        )
    for slug in required_courses:
        release = catalog.get(slug)
        if release is None:
            blocked.append(BlockedRecommendation(course_slug=slug, reason="No published release is available."))
            continue
        for objective in release.objectives:
            key = slug, objective.id
            mastered_in = checkpoint_evidence.get(key)
            signal = diagnostic_signals.get(objective.id, "unknown")
            evidence = (
                "independent_checkpoint"
                if mastered_in
                else "committed_attempt"
                if misconceptions.get(objective.id)
                else "diagnostic"
                if signal != "unknown"
                else "none"
            )
            mastery.append(
                ObjectiveMastery(
                    objective_id=objective.id,
                    title=objective.title,
                    release_id=mastered_in or release.id,
                    state=(
                        "demonstrated"
                        if mastered_in
                        else "needs_practice"
                        if misconceptions.get(objective.id, 0)
                        else "unknown"
                    ),
                    evidence=evidence,
                    starting_signal=signal,
                )
            )
        session = pinned.get(slug)
        if slug in completed_courses or (session and session.status == "completed"):
            continue
        missing = set(release.prerequisites) - completed_courses
        if missing and not session:
            names = [catalog[item].title if item in catalog else item for item in sorted(missing)]
            blocked.append(
                BlockedRecommendation(
                    course_slug=slug,
                    reason=f"Complete {', '.join(names)} first, or see the course for its approved entry options.",
                )
            )
            continue
        href = f"/courses/{slug}" + (f"?enrollment={session.id}" if session else "")
        minutes = max(policy.min_lesson_minutes, release.estimated_minutes // len(release.lessons))
        if not session:
            activities.append(
                RecommendationActivity(
                    kind="lesson",
                    title=f"Start {release.title}",
                    href=href,
                    minutes=minutes,
                    reason="This is an eligible course in your current plan.",
                )
            )
            continue
        lesson = session.lesson
        objective_id = lesson.objective_ids[0]
        if lesson.id in session.completed_lesson_ids:
            activities.append(
                RecommendationActivity(
                    kind="resume",
                    title=f"Continue {release.title}",
                    href=href,
                    minutes=minutes,
                    reason="Your independent checkpoint passed. Continue to the next lesson.",
                )
            )
            continue
        if session.remediation and session.remediation.step == "checkpoint":
            activities.append(
                RecommendationActivity(
                    kind="transfer",
                    title=f"Try a fresh checkpoint: {lesson.title}",
                    href=href,
                    minutes=policy.checkpoint_minutes,
                    objective_id=objective_id,
                    reason="You completed the bridge. Try the new checkpoint independently.",
                )
            )
        elif session.remediation or misconceptions.get(objective_id, 0) >= policy.repeat_errors:
            activities.append(
                RecommendationActivity(
                    kind="remediate",
                    title=f"Revisit: {lesson.title}",
                    href=href,
                    minutes=policy.remediation_minutes,
                    objective_id=objective_id,
                    reason="Recent incorrect answers suggest revisiting the worked example before a fresh attempt.",
                )
            )
        elif session.last_action and session.last_action.kind == "attempt" and session.last_action.correct:
            activities.append(
                RecommendationActivity(
                    kind="transfer",
                    title=f"Apply it independently: {lesson.title}",
                    href=href,
                    minutes=policy.checkpoint_minutes,
                    objective_id=objective_id,
                    reason=(
                        "You answered correctly. Try the separate checkpoint without hints "
                        "to demonstrate this skill."
                    ),
                )
            )
        else:
            # Reading, preferences, time, and XP never enter the mastery projection.
            activities.append(
                RecommendationActivity(
                    kind="resume",
                    title=f"Resume: {lesson.title}",
                    href=href,
                    minutes=minutes,
                    objective_id=objective_id,
                    reason="This is the next objective in your pinned course, with a checkpoint still to complete.",
                )
            )
    next_action = next((item for item in activities if item.minutes <= budget), None)
    if next_action is None and activities:
        blocked.append(
            BlockedRecommendation(
                course_slug="",
                reason=f"The shortest available activity needs {min(item.minutes for item in activities)} minutes.",
            )
        )
    return RecommendationResponse(
        policy_version=policy.version,
        track_id=track_id,
        plan_revision=plan_revision,
        available_minutes=budget,
        due_reviews=due_reviews,
        mastery=mastery,
        next_action=next_action,
        blocked=blocked,
    )


class MemoryRecommendationStore:
    def __init__(self):
        self._latest: dict[str, RecommendationResponse] = {}
        self._lock = Lock()

    def save(self, user_id: str, snapshot: RecommendationResponse) -> None:
        with self._lock:
            self._latest[user_id] = snapshot.model_copy(deep=True)


class PgRecommendationStore:
    def __init__(self, database_url: str):
        self.database_url = database_url

    def save(self, user_id: str, snapshot: RecommendationResponse) -> None:
        with psycopg.connect(self.database_url, connect_timeout=5) as conn:
            conn.execute(
                "INSERT INTO learner_recommendation_snapshots (user_id,snapshot) VALUES (%s,%s)"
                " ON CONFLICT (user_id) DO UPDATE SET snapshot=excluded.snapshot,updated_at=now()",
                (user_id, Jsonb(snapshot.model_dump(mode="json"))),
            )


def create_recommendation_router(get_user_id, profiles, courses, plans, documents, snapshots):
    router = APIRouter(
        tags=["Learning recommendations"],
        responses={503: {"description": "Learning data unavailable"}},
    )
    user_dependency = Depends(get_user_id)

    @router.post("/api/learner-profile/recommendations", response_model=RecommendationResponse)
    def compute(body: RecommendationRequest, user_id: str = user_dependency):
        try:
            profile = profiles.get(user_id)
            plan = plans.get(user_id) if profile else None
            snapshot = recommend(
                profile,
                courses.list_courses(user_id) if profile else [],
                courses.list_sessions(user_id) if profile else [],
                courses.completed_slugs(user_id) if profile else set(),
                courses.misconception_counts(user_id) if profile else {},
                len(documents.due_flashcards(user_id, datetime.now(UTC).date().isoformat())),
                body.available_minutes,
                track_id=plan.track_id if plan else None,
                plan_revision=plan.revision if plan else 0,
                required_courses=plan.required_course_slugs if plan else None,
            )
            snapshots.save(user_id, snapshot)
            return snapshot
        except psycopg.Error as exc:
            raise ApiError("Recommendations are temporarily unavailable", status_code=503) from exc

    return router
