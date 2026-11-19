"""Outlines are plans, never publishable CourseRelease objects or AI truth judgments."""

import hashlib
import json
import re
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StrictBool, StrictInt, model_validator

from app.source_versions.contracts import Contract, EvidencePin, Sha256

Identifier = Annotated[str, Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")]
Title = Annotated[str, Field(min_length=1, max_length=200)]
MAX_PLAN_BYTES = 131072


class OutlineSource(Contract):
    version_id: UUID
    content_hash: Sha256


class OutlineObjective(Contract):
    id: Identifier
    title: Title
    estimated_minutes: StrictInt = Field(ge=1, le=600)
    prerequisite_ids: list[Identifier] = Field(default_factory=list, max_length=8)
    evidence: list[EvidencePin] = Field(default_factory=list, max_length=4)
    review_status: Literal["needs_review", "reviewed"] = "needs_review"


class OutlineModule(Contract):
    id: Identifier
    title: Title
    objective_ids: list[Identifier] = Field(min_length=1, max_length=30)


class OutlineConflict(Contract):
    id: Identifier
    objective_id: Identifier
    first: EvidencePin
    second: EvidencePin
    description: str = Field(min_length=1, max_length=1000)
    resolution: str | None = Field(default=None, min_length=1, max_length=1000)

    @model_validator(mode="after")
    def distinct_evidence(self):
        if self.first == self.second:
            raise ValueError("conflict flags need two different evidence pins")
        if self.resolution is not None and not self.resolution.strip():
            raise ValueError("a conflict resolution needs an explanation")
        return self


class OutlinePlan(Contract):
    schema_version: Literal[1] = 1
    title: Title
    outcome: str = Field(min_length=1, max_length=2000)
    sources: list[OutlineSource] = Field(min_length=1, max_length=8)
    objectives: list[OutlineObjective] = Field(min_length=1, max_length=30)
    modules: list[OutlineModule] = Field(min_length=1, max_length=12)
    conflicts: list[OutlineConflict] = Field(default_factory=list, max_length=20)

    @model_validator(mode="before")
    @classmethod
    def numeric_version(cls, value):
        if isinstance(value, dict) and isinstance(value.get("schema_version"), bool):
            raise ValueError("schema version must be numeric")
        return value

    @model_validator(mode="after")
    def valid_plan(self):
        if not self.title.strip() or not self.outcome.strip():
            raise ValueError("outline title and outcome cannot be blank")
        ids = {objective.id for objective in self.objectives}
        if len(ids) != len(self.objectives) or len({s.version_id for s in self.sources}) != len(self.sources):
            raise ValueError("outline objectives and selected sources must be unique")
        if len({module.id for module in self.modules}) != len(self.modules):
            raise ValueError("outline module identifiers must be unique")
        if len({conflict.id for conflict in self.conflicts}) != len(self.conflicts):
            raise ValueError("outline conflict identifiers must be unique")
        selected = {item.version_id: item.content_hash for item in self.sources}
        prerequisites = {}
        for objective in self.objectives:
            if not re.fullmatch(r"[A-Za-z0-9_-]+", objective.id) or not objective.title.strip():
                raise ValueError("objective identity/title is invalid")
            if (len(set(objective.prerequisite_ids)) != len(objective.prerequisite_ids)
                    or objective.id in objective.prerequisite_ids or not set(objective.prerequisite_ids) <= ids):
                raise ValueError("objective prerequisites must uniquely reference other objectives")
            prerequisites[objective.id] = objective.prerequisite_ids
            seen_pins = set()
            for pin in objective.evidence:
                if selected.get(pin.version_id) != pin.content_hash:
                    raise ValueError("evidence must use the selected immutable source version/hash")
                signature = pin.model_dump_json()
                if signature in seen_pins or not pin.quote.strip():
                    raise ValueError("evidence must be distinct and quote actual text")
                seen_pins.add(signature)
        visited, visiting = set(), set()

        def visit(identifier):
            if identifier in visiting:
                raise ValueError("objective prerequisites cannot form a cycle")
            if identifier in visited:
                return
            visiting.add(identifier)
            for parent in prerequisites[identifier]:
                visit(parent)
            visiting.remove(identifier)
            visited.add(identifier)

        for identifier in ids:
            visit(identifier)
        assigned = []
        for module in self.modules:
            if not module.title.strip() or not set(module.objective_ids) <= ids:
                raise ValueError("modules need titles and known objective identifiers")
            assigned.extend(module.objective_ids)
        if len(set(assigned)) != len(assigned):
            raise ValueError("an objective can appear in only one module")
        objectives = {item.id: item for item in self.objectives}
        for conflict in self.conflicts:
            objective = objectives.get(conflict.objective_id)
            if (objective is None or conflict.first not in objective.evidence
                    or conflict.second not in objective.evidence):
                raise ValueError("conflict evidence must be linked to the referenced objective")
        if len(self.canonical_bytes()) > MAX_PLAN_BYTES:
            raise ValueError("outline plan exceeds the 128 KiB UTF-8 limit")
        return self

    def canonical_bytes(self) -> bytes:
        return json.dumps(
            self.model_dump(mode="json"), sort_keys=True, ensure_ascii=False, separators=(",", ":"),
        ).encode()

    def content_hash(self) -> str:
        return hashlib.sha256(self.canonical_bytes()).hexdigest()


class ObjectiveCoverage(Contract):
    objective_id: Identifier
    status: Literal["gap", "linked", "overlap"]
    source_version_ids: list[UUID] = Field(max_length=8)
    evidence_count: StrictInt = Field(ge=0, le=4)
    reviewed: StrictBool


class OutlineCoverage(Contract):
    coverage_version: Literal[1] = 1
    objectives: list[ObjectiveCoverage] = Field(max_length=30)
    gap_objective_ids: list[Identifier] = Field(max_length=30)
    overlap_objective_ids: list[Identifier] = Field(max_length=30)
    unreviewed_objective_ids: list[Identifier] = Field(max_length=30)
    unmapped_objective_ids: list[Identifier] = Field(max_length=30)
    misordered_objective_ids: list[Identifier] = Field(default_factory=list, max_length=30)
    unused_source_version_ids: list[UUID] = Field(max_length=8)
    unresolved_conflict_ids: list[Identifier] = Field(max_length=20)
    estimated_minutes: StrictInt = Field(ge=1, le=18000)
    ready_for_approval: StrictBool

    @model_validator(mode="before")
    @classmethod
    def strict_version(cls, value):
        if isinstance(value, dict) and isinstance(value.get("coverage_version"), bool):
            raise ValueError("coverage version must be numeric")
        return value


class OutlineCreateRequest(Contract):
    id: UUID
    plan: OutlinePlan


class OutlineUpdateRequest(Contract):
    expected_revision: StrictInt = Field(ge=1)
    plan: OutlinePlan


class OutlineApproveRequest(Contract):
    expected_revision: StrictInt = Field(ge=1)
    content_hash: Sha256
    reviewed_evidence: StrictBool

    @model_validator(mode="after")
    def explicit_review(self):
        if not self.reviewed_evidence:
            raise ValueError("explicit evidence review is required before approving")
        return self


class OutlineApprovalReceipt(Contract):
    id: UUID
    revision: StrictInt = Field(ge=1)
    content_hash: Sha256
    created_at: str


class OutlineApprovalSnapshot(Contract):
    plan: OutlinePlan
    coverage: OutlineCoverage


class OutlineApproval(OutlineApprovalReceipt):
    outline_id: UUID
    snapshot: OutlineApprovalSnapshot

    @model_validator(mode="after")
    def approved_content(self):
        if self.content_hash != self.snapshot.plan.content_hash() or not self.snapshot.coverage.ready_for_approval:
            raise ValueError("approval snapshot must bind its reviewed plan hash")
        return self


class OutlineRecord(Contract):
    id: UUID
    revision: StrictInt = Field(ge=1)
    content_hash: Sha256
    plan: OutlinePlan
    coverage: OutlineCoverage
    status: Literal["draft", "approved"]
    visibility: Literal["private"] = "private"
    editorial_status: Literal["not_reviewed"] = "not_reviewed"
    approval: OutlineApprovalReceipt | None = None
    created_at: str
    updated_at: str

    @model_validator(mode="after")
    def bound_record(self):
        if self.content_hash != self.plan.content_hash():
            raise ValueError("outline hash must bind the exact saved plan")
        if self.status == "approved":
            if (self.approval is None or self.approval.revision != self.revision
                    or self.approval.content_hash != self.content_hash or not self.coverage.ready_for_approval):
                raise ValueError("approved outline must bind the current reviewed revision")
        elif self.approval is not None:
            raise ValueError("edited drafts cannot retain active approval")
        return self


class OutlineSummary(Contract):
    id: UUID
    title: Title
    revision: StrictInt = Field(ge=1)
    status: Literal["draft", "approved"]
    estimated_minutes: StrictInt = Field(ge=1, le=18000)
    source_count: StrictInt = Field(ge=1, le=8)
    objective_count: StrictInt = Field(ge=1, le=30)
    content_hash: Sha256
    updated_at: str


class OutlineListResponse(Contract):
    items: list[OutlineSummary] = Field(max_length=50)
    limit: StrictInt = Field(ge=1, le=50)
    offset: StrictInt = Field(ge=0)
    total_count: StrictInt = Field(ge=0)


class OutlineApprovalListResponse(Contract):
    items: list[OutlineApproval] = Field(max_length=50)


class OutlineDeleteResponse(Contract):
    deleted: Literal[True] = True

    @model_validator(mode="before")
    @classmethod
    def strict_deleted(cls, value):
        if isinstance(value, dict) and "deleted" in value and value["deleted"] is not True:
            raise ValueError("deleted must be true")
        return value


class OutlineSourceSummary(Contract):
    id: UUID
    content_hash: Sha256
    title: str = Field(min_length=1, max_length=500)
    kind: Literal["pdf", "github", "text"]
    segment_count: StrictInt = Field(ge=1, le=2000)
    created_at: str


class OutlineSourceListResponse(Contract):
    items: list[OutlineSourceSummary] = Field(max_length=50)
    limit: StrictInt = Field(ge=1, le=50)
    offset: StrictInt = Field(ge=0)
    total_count: StrictInt = Field(ge=0)
