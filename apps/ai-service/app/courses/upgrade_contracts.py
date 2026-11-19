"""Explicit owner acceptance of a new enrollment, never an in-place release switch."""

import hashlib
import json
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StrictBool, StrictInt, model_validator

from app.courses.contracts import SessionResponse
from app.source_versions.contracts import Contract, Sha256

UpgradeId = Annotated[str, Field(min_length=1, max_length=200)]


class CourseUpgradePreviewRequest(Contract):
    target_release_id: UUID


class CourseUpgradeResetReason(Contract):
    lesson_id: UpgradeId
    reason: Literal["new_lesson", "changed_teaching_or_assessment", "changed_prerequisite", "not_completed",
                    "invalid_prior_checkpoint"]


class CourseUpgradePreview(Contract):
    policy_version: Literal["1"] = "1"
    from_enrollment_id: UUID
    from_revision: StrictInt = Field(ge=0)
    from_document_id: UUID
    from_release_id: UUID
    from_content_hash: Sha256
    target_release_id: UUID
    target_content_hash: Sha256
    course_id: UUID
    course_slug: UpgradeId
    from_version: UpgradeId
    target_version: UpgradeId
    retained_lesson_ids: list[UpgradeId] = Field(max_length=200)
    reset_lesson_ids: list[UpgradeId] = Field(max_length=200)
    reset_reasons: list[CourseUpgradeResetReason] = Field(max_length=200)
    retained_objective_ids: list[UpgradeId] = Field(max_length=1000)
    retained_note_count: StrictInt = Field(ge=0, le=100)
    retained_bookmark_count: StrictInt = Field(ge=0, le=100)
    project_policy: Literal["old_kept_new_draft"] = "old_kept_new_draft"
    warnings: list[str] = Field(max_length=20)
    preview_hash: Sha256

    def fingerprint(self):
        data = self.model_dump(mode="json", exclude={"preview_hash"})
        return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False,
                                         separators=(",", ":")).encode("utf-8")).hexdigest()

    @model_validator(mode="after")
    def consistent_preview(self):
        if self.from_release_id == self.target_release_id:
            raise ValueError("An upgrade must select a different release")
        for identifiers in (self.retained_lesson_ids, self.reset_lesson_ids, self.retained_objective_ids):
            if len(identifiers) != len(set(identifiers)):
                raise ValueError("Upgrade mappings must use unique identifiers")
        if set(self.retained_lesson_ids) & set(self.reset_lesson_ids):
            raise ValueError("Retained and reset lessons must be disjoint")
        if [item.lesson_id for item in self.reset_reasons] != self.reset_lesson_ids:
            raise ValueError("Every reset lesson must have exactly one ordered explanation")
        if self.preview_hash != self.fingerprint():
            raise ValueError("Upgrade preview must bind its exact revision and mapping")
        return self


class CourseUpgradeApplyRequest(Contract):
    id: UUID
    expected_revision: StrictInt = Field(ge=0)
    target_release_id: UUID
    target_content_hash: Sha256
    preview_hash: Sha256
    accept_upgrade: StrictBool

    @model_validator(mode="after")
    def explicit_acceptance(self):
        if not self.accept_upgrade:
            raise ValueError("Explicitly accept the preview before creating an upgraded enrollment")
        return self


class CourseUpgradeReceipt(Contract):
    id: UUID
    from_enrollment_id: UUID
    to_enrollment_id: UUID
    from_document_id: UUID
    from_revision: StrictInt = Field(ge=0)
    from_release_id: UUID
    from_content_hash: Sha256
    target_release_id: UUID
    target_content_hash: Sha256
    preview_hash: Sha256
    retained_lesson_ids: list[UpgradeId] = Field(max_length=200)
    retained_objective_ids: list[UpgradeId] = Field(max_length=1000)
    project_policy: Literal["old_kept_new_draft"] = "old_kept_new_draft"
    created_at: str


class CourseUpgradeResponse(Contract):
    session: SessionResponse
    receipt: CourseUpgradeReceipt
    replayed: StrictBool

    @model_validator(mode="after")
    def bound_target(self):
        if (self.session.id != self.receipt.to_enrollment_id
                or self.session.release_id != self.receipt.target_release_id
                or self.session.id == self.receipt.from_enrollment_id
                or self.session.document_id == self.receipt.from_document_id):
            raise ValueError("Upgrade response must refer to its committed target enrollment")
        return self
