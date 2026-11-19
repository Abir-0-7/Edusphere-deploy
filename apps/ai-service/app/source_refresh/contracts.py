from typing import Literal
from uuid import UUID

from pydantic import Field, StrictBool, StrictInt, model_validator

from app.source_versions.contracts import Contract, Locator, Sha256


class SourceImpactRequest(Contract):
    old_version_id: UUID
    new_version_id: UUID
    limit: StrictInt = Field(default=20, ge=1, le=50)
    offset: StrictInt = Field(default=0, ge=0, le=100000)

    @model_validator(mode="after")
    def different_versions(self):
        if self.old_version_id == self.new_version_id:
            raise ValueError("Choose two different prepared source versions")
        return self


class SegmentChange(Contract):
    change: Literal["unchanged", "changed", "moved", "removed", "added"]
    old_segment_id: str | None = None
    new_segment_id: str | None = None
    old_locator: Locator | None = None
    new_locator: Locator | None = None
    old_excerpt: str | None = Field(default=None, max_length=500)
    new_excerpt: str | None = Field(default=None, max_length=500)


class SegmentCounts(Contract):
    unchanged: StrictInt = Field(ge=0)
    changed: StrictInt = Field(ge=0)
    moved: StrictInt = Field(ge=0)
    removed: StrictInt = Field(ge=0)
    added: StrictInt = Field(ge=0)


class ArtifactImpact(Contract):
    kind: Literal["card", "map_node", "map_edge", "outline_objective", "generated_lesson", "course_lesson"]
    id: str = Field(min_length=1, max_length=120)
    parent_id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=500)
    reason: Literal["changed", "moved", "removed"]
    document_id: UUID | None = None
    revision: StrictInt | None = Field(default=None, ge=0)
    content_hash: Sha256
    edited: StrictBool | None = None


class SourceImpactResponse(Contract):
    old_version_id: UUID
    new_version_id: UUID
    old_content_hash: Sha256
    new_content_hash: Sha256
    counts: SegmentCounts
    segments: list[SegmentChange] = Field(max_length=50)
    segments_truncated: StrictBool
    artifacts: list[ArtifactImpact] = Field(max_length=50)
    total_artifacts: StrictInt = Field(ge=0)
    artifacts_truncated: StrictBool
    limit: StrictInt = Field(ge=1, le=50)
    offset: StrictInt = Field(ge=0)
    limitations: list[str] = Field(max_length=12)
