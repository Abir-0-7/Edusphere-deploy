"""F04 wire contracts. Generated drafts never grant course publication authority."""

import hashlib
import json
from typing import Literal
from uuid import UUID

from pydantic import Field, StrictBool, StrictInt, model_validator

from app.course_outlines.contracts import Identifier, OutlinePlan, Title
from app.source_versions.contracts import Contract, Sha256


class GenerationPolicy(Contract):
    version: Literal["1"] = "1"
    max_input_bytes: StrictInt = Field(ge=1, le=64000)
    max_output_tokens: StrictInt = Field(ge=1, le=4096)
    max_provider_attempts: StrictInt = Field(ge=1, le=20)
    max_stage_attempts: StrictInt = Field(ge=1, le=3)
    provider_fingerprint: Sha256


class GenerationApprovalRef(Contract):
    outline_id: UUID
    approval_id: UUID
    outline_revision: StrictInt = Field(ge=1)
    outline_content_hash: Sha256


class GenerationReuse(Contract):
    parent_run_id: UUID
    parent_revision: StrictInt = Field(ge=1)
    parent_stage_id: Identifier
    output_hash: Sha256
    prompt_hash: Sha256
    pins_hash: Sha256


class GenerationStageSpec(Contract):
    id: Identifier
    module_id: Identifier
    title: Title
    input_bytes: StrictInt = Field(ge=1, le=64000)
    token_upper_bound: StrictInt = Field(ge=1, le=2000000)
    reuse: GenerationReuse | None = Field(default=None, exclude_if=lambda value: value is None)


class GenerationPreview(GenerationApprovalRef):
    title: Title
    policy: GenerationPolicy
    stages: list[GenerationStageSpec] = Field(min_length=1, max_length=30)
    maximum_tokens: StrictInt = Field(ge=0, le=100000000)
    preview_hash: Sha256

    def fingerprint(self):
        data = self.model_dump(mode="json", exclude={"preview_hash"})
        return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
                              .encode("utf-8")).hexdigest()

    @model_validator(mode="after")
    def bound_preview(self):
        if len({stage.id for stage in self.stages}) != len(self.stages):
            raise ValueError("generation stages must be unique")
        expected = sum(stage.token_upper_bound for stage in self.stages if stage.reuse is None)
        expected *= self.policy.max_stage_attempts
        if self.maximum_tokens != expected:
            raise ValueError("generation budget must include every allowed stage attempt")
        if any(stage.input_bytes > self.policy.max_input_bytes for stage in self.stages):
            raise ValueError("a generation stage exceeds the prompt byte limit")
        if self.preview_hash != self.fingerprint():
            raise ValueError("preview hash must bind the approval, stages and generation policy")
        return self


class GenerationStartRequest(GenerationApprovalRef):
    id: UUID
    preview_hash: Sha256
    accept_budget: StrictBool

    @model_validator(mode="after")
    def explicit_budget(self):
        if not self.accept_budget:
            raise ValueError("review and accept the generation budget before starting")
        return self


class GenerationActionRequest(Contract):
    expected_revision: StrictInt = Field(ge=1)


class GenerationResumeRequest(GenerationActionRequest):
    accept_remaining_budget: StrictBool

    @model_validator(mode="after")
    def explicit_retry(self):
        if not self.accept_remaining_budget:
            raise ValueError("explicitly accept the remaining budget before resuming")
        return self


class LessonDraft(Contract):
    title: Title
    explanation: str = Field(min_length=1, max_length=6000)
    worked_example: str = Field(min_length=1, max_length=3000)
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(min_length=1, max_length=1500)
    evidence_ids: list[Literal["pin-1", "pin-2", "pin-3", "pin-4"]] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def real_content(self):
        if any(not getattr(self, key).strip()
               for key in ("title", "explanation", "worked_example", "question", "answer")):
            raise ValueError("lesson draft text must not be blank")
        if len(self.evidence_ids) != len(set(self.evidence_ids)):
            raise ValueError("lesson evidence references must be unique")
        return self


GenerationError = Literal["provider_unavailable", "invalid_output", "operation_uncertain", "policy_changed",
                          "worker_failed"]


class GenerationStage(GenerationStageSpec):
    status: Literal["pending", "running", "done", "needs_retry"] = "pending"
    attempts: StrictInt = Field(default=0, ge=0, le=3)
    output: LessonDraft | None = None
    error_code: GenerationError | None = None

    @model_validator(mode="after")
    def completed_output(self):
        if (self.status == "done") != (self.output is not None):
            raise ValueError("only completed stages have validated lesson output")
        if self.reuse is not None and (self.status != "done" or self.attempts != 0 or self.error_code is not None):
            raise ValueError("reused stages are completed without allocating a new provider attempt")
        if self.status in {"running", "done", "needs_retry"} and self.attempts == 0 and self.reuse is None:
            raise ValueError("started stages must retain their allocated attempt")
        if (self.status == "needs_retry") != (self.error_code is not None):
            raise ValueError("retry stages must explain their failure")
        return self


class GenerationRun(GenerationApprovalRef):
    id: UUID
    plan: OutlinePlan
    preview_hash: Sha256
    policy: GenerationPolicy
    job_id: UUID
    revision: StrictInt = Field(ge=1)
    status: Literal["pending", "running", "done", "failed", "cancelled"]
    stages: list[GenerationStage] = Field(min_length=1, max_length=30)
    maximum_tokens: StrictInt = Field(ge=0, le=100000000)
    allocated_tokens: StrictInt = Field(ge=0, le=100000000)
    visibility: Literal["private"] = "private"
    editorial_status: Literal["not_reviewed"] = "not_reviewed"
    created_at: str
    updated_at: str
    parent_run_id: UUID | None = Field(default=None, exclude_if=lambda value: value is None)
    parent_run_revision: StrictInt | None = Field(default=None, ge=1, exclude_if=lambda value: value is None)
    refresh_preview_hash: Sha256 | None = Field(default=None, exclude_if=lambda value: value is None)
    regenerate_objective_ids: list[Identifier] | None = Field(
        default=None, max_length=30, exclude_if=lambda value: value is None,
    )

    @model_validator(mode="after")
    def bound_run(self):
        if self.plan.content_hash() != self.outline_content_hash:
            raise ValueError("generation must bind its approved outline")
        order = [(objective_id, module.id) for module in self.plan.modules for objective_id in module.objective_ids]
        if [(stage.id, stage.module_id) for stage in self.stages] != order:
            raise ValueError("generation stages must follow every approved module objective exactly once")
        objectives = {objective.id: objective for objective in self.plan.objectives}
        lineage = (self.parent_run_id, self.parent_run_revision, self.refresh_preview_hash,
                   self.regenerate_objective_ids)
        if any(value is not None for value in lineage) and not all(value is not None for value in lineage):
            raise ValueError("forked runs require complete immutable lineage")
        if self.parent_run_id == self.id:
            raise ValueError("generation cannot fork itself")
        if self.regenerate_objective_ids is not None and (
            len(set(self.regenerate_objective_ids)) != len(self.regenerate_objective_ids)
            or not set(self.regenerate_objective_ids) <= objectives.keys()
        ):
            raise ValueError("regeneration selections must uniquely reference target objectives")
        if len(order) != len(objectives):
            raise ValueError("generation requires every objective assigned to a module")
        for stage in self.stages:
            if stage.reuse is not None:
                if (stage.reuse.parent_run_id != self.parent_run_id
                        or stage.reuse.parent_revision != self.parent_run_revision
                        or stage.id in (self.regenerate_objective_ids or [])):
                    raise ValueError("reused stage must bind its parent and cannot be selected for regeneration")
                if stage.output is None or digest(stage.output.model_dump(mode="json")) != stage.reuse.output_hash:
                    raise ValueError("reused output must retain its exact validated hash")
            if stage.attempts > self.policy.max_stage_attempts:
                raise ValueError("generation stage exhausted its budget")
            if stage.output is not None:
                allowed = {f"pin-{index + 1}" for index in range(len(objectives[stage.id].evidence))}
                if not set(stage.output.evidence_ids) <= allowed:
                    raise ValueError("generated evidence must select approved pins for this exact objective")
        expected = sum(stage.token_upper_bound * stage.attempts for stage in self.stages)
        if self.allocated_tokens != expected or self.allocated_tokens > self.maximum_tokens:
            raise ValueError("generation allocation must retain all prior stage attempts")
        preview = GenerationPreview(
            **self.model_dump(include={"outline_id", "approval_id", "outline_revision", "outline_content_hash",
                                      "preview_hash", "policy", "maximum_tokens"}),
            title=self.plan.title, stages=[GenerationStageSpec.model_validate(stage.model_dump(
                include={"id", "module_id", "title", "input_bytes", "token_upper_bound", "reuse"}))
                for stage in self.stages],
        )
        if self.status == "done" and any(stage.status != "done" for stage in self.stages):
            raise ValueError("generation cannot complete with missing stages")
        del preview
        return self


class GenerationSummary(Contract):
    id: UUID
    outline_id: UUID
    title: Title
    status: Literal["pending", "running", "done", "failed", "cancelled"]
    completed_stages: StrictInt = Field(ge=0, le=30)
    total_stages: StrictInt = Field(ge=1, le=30)
    maximum_tokens: StrictInt = Field(ge=0, le=100000000)
    allocated_tokens: StrictInt = Field(ge=0, le=100000000)
    updated_at: str

    @model_validator(mode="after")
    def consistent_progress(self):
        if self.completed_stages > self.total_stages:
            raise ValueError("generation progress cannot exceed its stage count")
        if self.allocated_tokens > self.maximum_tokens:
            raise ValueError("generation allocation cannot exceed its accepted budget")
        if self.status == "done" and self.completed_stages != self.total_stages:
            raise ValueError("generation cannot complete with missing stages")
        return self


class GenerationListResponse(Contract):
    items: list[GenerationSummary] = Field(max_length=50)
    limit: StrictInt = Field(ge=1, le=50)
    offset: StrictInt = Field(ge=0)
    total_count: StrictInt = Field(ge=0)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
                          .encode("utf-8")).hexdigest()


class RefreshPreviewRequest(Contract):
    parent_run_id: UUID
    expected_parent_revision: StrictInt = Field(ge=1)
    target: GenerationApprovalRef
    regenerate_objective_ids: list[Identifier] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def unique_selections(self):
        if len(set(self.regenerate_objective_ids)) != len(self.regenerate_objective_ids):
            raise ValueError("regeneration selections must be unique")
        return self


class RefreshStageDecision(Contract):
    objective_id: Identifier
    action: Literal["reuse", "generate"]
    reason: str = Field(min_length=1, max_length=500)
    has_saved_edit: StrictBool
    edit_disposition: Literal["reused", "retained_in_parent", "none"]


class RefreshPreview(Contract):
    parent_run_id: UUID
    parent_revision: StrictInt = Field(ge=1)
    target: GenerationPreview
    decisions: list[RefreshStageDecision] = Field(min_length=1, max_length=30)
    new_work_token_ceiling: StrictInt = Field(ge=0, le=100000000)
    retained_parent_allocated_tokens: StrictInt = Field(ge=0, le=100000000)
    preview_hash: Sha256

    @model_validator(mode="after")
    def consistent_decisions(self):
        if ([item.objective_id for item in self.decisions] != [stage.id for stage in self.target.stages]
                or self.new_work_token_ceiling != self.target.maximum_tokens):
            raise ValueError("refresh decisions must bind every target stage and its new-work budget")
        for decision, stage in zip(self.decisions, self.target.stages, strict=True):
            if (decision.action == "reuse") != (stage.reuse is not None):
                raise ValueError("refresh action must bind actual stage reuse")
            expected = ("reused" if stage.reuse is not None else "retained_in_parent")
            if decision.edit_disposition != (expected if decision.has_saved_edit else "none"):
                raise ValueError("refresh must explain saved edit preservation")
        return self


class RefreshStartRequest(RefreshPreviewRequest):
    id: UUID
    preview_hash: Sha256
    accept_budget: StrictBool

    @model_validator(mode="after")
    def explicit_budget(self):
        if not self.accept_budget:
            raise ValueError("review and accept the refresh budget before starting")
        return self


class LessonEditRequest(Contract):
    expected_run_revision: StrictInt = Field(ge=1)
    expected_edit_revision: StrictInt = Field(ge=0, le=5)
    output: LessonDraft


class GenerationLessonEdit(Contract):
    run_id: UUID
    objective_id: Identifier
    revision: StrictInt = Field(ge=1, le=5)
    output: LessonDraft
    created_at: str
    copied_from_run_id: UUID | None = Field(default=None, exclude_if=lambda value: value is None)
    copied_from_revision: StrictInt | None = Field(default=None, ge=1, le=5,
                                                exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def paired_lineage(self):
        if (self.copied_from_run_id is None) != (self.copied_from_revision is None):
            raise ValueError("copied edit history must retain its exact source")
        return self


class LessonEditListResponse(Contract):
    items: list[GenerationLessonEdit] = Field(max_length=150)
