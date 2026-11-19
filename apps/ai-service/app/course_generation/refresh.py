"""Selective regeneration forks preserve parent content, edits and cost ledgers."""

from uuid import UUID, uuid4

import psycopg
from fastapi import APIRouter, Depends

from app.contracts import LEARNING_ERRORS, ErrorEnvelope
from app.course_generation.contracts import (
    GenerationLessonEdit,
    GenerationPreview,
    GenerationReuse,
    GenerationRun,
    GenerationStage,
    GenerationStageSpec,
    Identifier,
    LessonEditListResponse,
    LessonEditRequest,
    RefreshPreview,
    RefreshPreviewRequest,
    RefreshStageDecision,
    RefreshStartRequest,
    digest,
)
from app.course_generation.service import _now, messages_for
from app.errors import ApiError, Conflict, InvalidInput, NotFound


def validated_target(outline, reference):
    if (outline.status != "approved" or outline.approval is None or outline.approval.id != reference.approval_id
            or outline.revision != reference.outline_revision
            or outline.content_hash != reference.outline_content_hash):
        raise Conflict("Approve and preview the exact target outline before refreshing")
    return outline.plan


def replay(run, body):
    if (run.parent_run_id != body.parent_run_id or run.parent_run_revision != body.expected_parent_revision
            or run.refresh_preview_hash != body.preview_hash
            or run.regenerate_objective_ids != sorted(body.regenerate_objective_ids)
            or any(getattr(run, key) != getattr(body.target, key) for key in (
                "outline_id", "approval_id", "outline_revision", "outline_content_hash"))):
        raise Conflict("Refresh identity is already bound to different reviewed work")
    return run


def build_preview(service, parent, target_plan, history, body):
    if parent.revision != body.expected_parent_revision:
        raise Conflict("Parent generation changed; review a fresh refresh preview")
    selected = set(body.regenerate_objective_ids)
    if not selected <= {objective.id for objective in target_plan.objectives}:
        raise InvalidInput("Regeneration selections must reference target outline objectives")
    target = service._preview_plan(target_plan, body.target, enforce_limit=False)
    old_stages = {stage.id: stage for stage in parent.stages}
    old_objectives = {objective.id: objective for objective in parent.plan.objectives}
    new_objectives = {objective.id: objective for objective in target_plan.objectives}
    edited = {item.objective_id for item in history}
    specs, decisions = [], []
    for spec in target.stages:
        old = old_stages.get(spec.id)
        objective = new_objectives[spec.id]
        messages = messages_for(target_plan, objective)
        pins = [pin.model_dump(mode="json") for pin in objective.evidence]
        reason = None
        if spec.id in selected:
            reason = "Explicitly selected for fresh generation"
        elif old is None or old.status != "done" or old.output is None:
            reason = "No completed validated parent lesson is available"
        elif parent.policy != service.policy:
            reason = "The accepted generation policy changed"
        elif pins != [pin.model_dump(mode="json") for pin in old_objectives[spec.id].evidence]:
            reason = "Exact approved source pins changed"
        elif messages != messages_for(parent.plan, old_objectives[spec.id]):
            reason = "Actual lesson prompt changed"
        reuse = None
        if reason is None:
            reason = "Identical validated lesson prompt, policy and exact source pins"
            reuse = GenerationReuse(
                parent_run_id=parent.id, parent_revision=parent.revision, parent_stage_id=old.id,
                output_hash=digest(old.output.model_dump(mode="json")),
                prompt_hash=digest({"messages": messages, "policy": service.policy.model_dump(mode="json")}),
                pins_hash=digest(pins),
            )
        specs.append(GenerationStageSpec.model_validate({**spec.model_dump(), "reuse": reuse}))
        decisions.append(RefreshStageDecision(
            objective_id=spec.id, action="reuse" if reuse is not None else "generate", reason=reason,
            has_saved_edit=spec.id in edited,
            edit_disposition=("reused" if reuse is not None else "retained_in_parent") if spec.id in edited else "none",
        ))
    maximum = sum(spec.token_upper_bound for spec in specs if spec.reuse is None) * service.policy.max_stage_attempts
    if maximum > service.max_run_tokens:
        raise InvalidInput("Selected refresh work exceeds the configured generation budget")
    data = {**target.model_dump(), "stages": specs, "policy": target.policy,
            "maximum_tokens": maximum, "preview_hash": "0" * 64}
    provisional = GenerationPreview.model_construct(**data)
    data["preview_hash"] = provisional.fingerprint()
    target = GenerationPreview.model_validate(data)
    preview = RefreshPreview(parent_run_id=parent.id, parent_revision=parent.revision, target=target,
                             decisions=decisions, new_work_token_ceiling=maximum,
                             retained_parent_allocated_tokens=parent.allocated_tokens, preview_hash="0" * 64)
    # Edits have their own CAS revision, so the preview must bind their complete
    # append-only ledger even when the parent run's revision has not changed.
    fingerprint = digest({"preview": preview.model_dump(mode="json", exclude={"preview_hash"}),
                          "edits": [item.model_dump(mode="json") for item in sorted(
                              history, key=lambda item: (item.objective_id, item.revision))],
                          "selected": sorted(selected)})
    return preview.model_copy(update={"preview_hash": fingerprint})


def refresh_preview(service, user_id, body):
    body = RefreshPreviewRequest.model_validate(body.model_dump(mode="json"))
    parent = service.store.get(user_id, str(body.parent_run_id))
    plan = service._approval(user_id, body.target)
    history = service.edits.list(user_id, str(parent.id)).items
    return build_preview(service, parent, plan, history, body)


def refresh_start(service, user_id, body):
    body = RefreshStartRequest.model_validate(body.model_dump(mode="json"))
    try:
        return replay(service.store.get(user_id, str(body.id)), body)
    except NotFound:
        pass

    def builder(parent, plan, history):
        preview = build_preview(service, parent, plan, history, body)
        if preview.preview_hash != body.preview_hash:
            raise Conflict("Refresh sources, parent edits or estimate changed; review a fresh preview")
        stages = {stage.id: stage for stage in parent.stages}
        now = _now()
        return GenerationRun(
            **body.target.model_dump(), id=body.id, plan=plan, preview_hash=preview.target.preview_hash,
            policy=preview.target.policy, job_id=uuid4(), revision=1, status="pending",
            stages=[GenerationStage(**spec.model_dump(), status="done" if spec.reuse else "pending", attempts=0,
                                    output=stages[spec.id].output.model_copy(deep=True) if spec.reuse else None)
                    for spec in preview.target.stages],
            maximum_tokens=preview.new_work_token_ceiling, allocated_tokens=0, created_at=now, updated_at=now,
            parent_run_id=parent.id, parent_run_revision=parent.revision, refresh_preview_hash=preview.preview_hash,
            regenerate_objective_ids=sorted(body.regenerate_objective_ids),
        )

    return service.store.create_fork(user_id, body, service.edits, builder)


def refresh_router(user_dependency, service, *, enabled=False):
    router = APIRouter(prefix="/api/course-generations", tags=["course-generation-refresh"], responses={
        **LEARNING_ERRORS, 409: {"model": ErrorEnvelope, "description": "Generation revision or approval conflict"},
        503: {"model": ErrorEnvelope, "description": "Generation storage unavailable"},
    })
    User = Depends(user_dependency)

    def invoke(operation, *args):
        if not enabled:
            raise NotFound("Course source refresh is not available")
        try:
            return operation(*args)
        except psycopg.errors.UniqueViolation as exc:
            raise Conflict("Generation identity or lesson edit revision changed") from exc
        except psycopg.Error as exc:
            raise ApiError("Course generation storage is temporarily unavailable", status_code=503) from exc

    @router.post("/refresh/preview", response_model=RefreshPreview)
    def preview(body: RefreshPreviewRequest, user_id: str = User):
        return invoke(service.refresh_preview, user_id, body)

    @router.post("/refresh", response_model=GenerationRun, status_code=202)
    def start(body: RefreshStartRequest, user_id: str = User):
        return invoke(service.refresh_start, user_id, body)

    @router.get("/{run_id}/lesson-edits", response_model=LessonEditListResponse)
    def history(run_id: UUID, user_id: str = User):
        return invoke(service.edits.list, user_id, str(run_id))

    @router.put("/{run_id}/lessons/{objective_id}", response_model=GenerationLessonEdit)
    def edit(run_id: UUID, objective_id: Identifier, body: LessonEditRequest, user_id: str = User):
        return invoke(service.edits.save, user_id, str(run_id), objective_id, body)

    return router
