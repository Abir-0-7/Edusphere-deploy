"""Wire contracts mirrored by packages/types/src/learner-profile-api.ts."""

import re
from datetime import date
from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

SkillId = Literal["python-expressions", "python-loops", "python-functions"]
DiagnosticVersion = Literal["python-foundations-v1"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AccessibilityPreferences(StrictModel):
    reduced_motion: Annotated[bool, Field(strict=True)]
    larger_text: Annotated[bool, Field(strict=True)]
    text_alternative: Annotated[bool, Field(strict=True)]


class LearnerProfileInput(StrictModel):
    goal_kind: Literal["career", "academic"]
    goal: Annotated[str, Field(min_length=1, max_length=200)]
    familiarity: Literal["new", "some", "experienced", "unsure"]
    weekly_minutes: Annotated[int, Field(strict=True, ge=15, le=10080)]
    deadline: date | None
    language: Literal["en", "bn"]
    accessibility: AccessibilityPreferences
    role_variant: Literal["auto", "analyst", "developer"] = "auto"
    explanation_depth: Literal["guided", "standard", "concise"] = "standard"
    pace: Literal["short_sessions", "standard"] = "standard"

    @field_validator("goal", mode="before")
    @classmethod
    def trim_goal(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("deadline", mode="before")
    @classmethod
    def canonical_deadline(cls, value: object) -> object:
        if value is None or type(value) is date:
            return value
        if not isinstance(value, str) or re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is None:
            raise ValueError("deadline must be YYYY-MM-DD or null")
        return date.fromisoformat(value)


class DiagnosticSkill(StrictModel):
    skill_id: SkillId
    state: Literal["unknown", "needs_practice", "developing"]


class LearnerDiagnosticSummary(StrictModel):
    version: DiagnosticVersion = "python-foundations-v1"
    status: Literal["not_started", "skipped", "completed"]
    skills: Annotated[list[DiagnosticSkill], Field(max_length=3)]
    completed_at: AwareDatetime | None


class LearnerProfile(LearnerProfileInput):
    diagnostic: LearnerDiagnosticSummary
    updated_at: AwareDatetime


class LearnerProfileResponse(StrictModel):
    profile: LearnerProfile | None


class DiagnosticChoice(StrictModel):
    id: str
    label: str


class DiagnosticQuestion(StrictModel):
    id: str
    skill_id: SkillId
    prompt: str
    choices: Annotated[list[DiagnosticChoice], Field(min_length=3, max_length=3)]


class LearnerDiagnosticDefinition(StrictModel):
    version: DiagnosticVersion = "python-foundations-v1"
    title: str
    description: str
    questions: Annotated[list[DiagnosticQuestion], Field(min_length=3, max_length=3)]


class DiagnosticAnswer(StrictModel):
    question_id: Annotated[str, Field(min_length=1, max_length=64)]
    choice_id: Annotated[str, Field(min_length=1, max_length=64)] | None


class LearnerDiagnosticRequest(StrictModel):
    version: DiagnosticVersion
    action: Literal["complete", "skip"]
    answers: Annotated[list[DiagnosticAnswer], Field(max_length=3)]

    @model_validator(mode="after")
    def valid_answers(self) -> Self:
        if len({answer.question_id for answer in self.answers}) != len(self.answers):
            raise ValueError("duplicate diagnostic question")
        if self.action == "skip" and self.answers:
            raise ValueError("skipping requires empty answers")
        if self.action == "complete" and not any(answer.choice_id is not None for answer in self.answers):
            raise ValueError("answer at least one question or skip the diagnostic")
        return self
