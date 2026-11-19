"""Regenerate deterministic private F04 wire fixtures without a DB or provider."""

import copy
import json
from pathlib import Path
from uuid import UUID

from app.course_generation.contracts import (
    GenerationActionRequest,
    GenerationApprovalRef,
    GenerationListResponse,
    GenerationPolicy,
    GenerationPreview,
    GenerationResumeRequest,
    GenerationRun,
    GenerationStage,
    GenerationStageSpec,
    GenerationStartRequest,
    GenerationSummary,
    LessonDraft,
)
from app.course_outlines.contracts import OutlinePlan
from scripts.export_outline_fixtures import APPROVAL_ID, OUTLINE_ID, STAMP, outline_plan

ROOT = Path(__file__).resolve().parents[3]
RUN_ID = UUID("33333333-3333-4333-8333-333333333333")
JOB_ID = UUID("44444444-4444-4444-8444-444444444444")


def generation_plan() -> OutlinePlan:
    data = outline_plan(ready=True).model_dump(mode="json")
    data["objectives"].append({
        **copy.deepcopy(data["objectives"][0]), "id": "apply-energy",
        "title": "Compare energy statements", "estimated_minutes": 10, "prerequisite_ids": ["energy"],
        "evidence": data["objectives"][0]["evidence"][:1],
    })
    data["modules"][0]["objective_ids"].append("apply-energy")
    return OutlinePlan.model_validate(data)


def wire_fixtures() -> dict:
    plan = generation_plan()
    reference = GenerationApprovalRef(
        outline_id=OUTLINE_ID, approval_id=APPROVAL_ID, outline_revision=2, outline_content_hash=plan.content_hash(),
    )
    policy = GenerationPolicy(
        max_input_bytes=12000, max_output_tokens=1024, max_provider_attempts=6,
        max_stage_attempts=3, provider_fingerprint="a" * 64,
    )
    stages = [GenerationStageSpec(
        id=objective.id, module_id=plan.modules[0].id, title=objective.title,
        input_bytes=800 + index * 100, token_upper_bound=10000,
    ) for index, objective in enumerate(plan.objectives)]
    preview = GenerationPreview.model_construct(
        **reference.model_dump(), title=plan.title, policy=policy, stages=stages,
        maximum_tokens=60000, preview_hash="0" * 64,
    )
    preview.preview_hash = preview.fingerprint()
    preview = GenerationPreview.model_validate(preview.model_dump(mode="json"))
    lesson = LessonDraft(
        title="Energy and evidence \u0986\u09b2\u09cb \U0001f331",
        explanation="Light carries energy. Treat this as source-grounded draft material awaiting human review.",
        worked_example="Compare the two approved excerpts before describing an energy transfer.",
        question="What property of light do the supplied excerpts support?",
        answer="The selected excerpts support the statement that light carries energy.", evidence_ids=["pin-1"],
    )

    def run(status, stage_values):
        full_stages = [GenerationStage(**spec.model_dump(), **value)
                       for spec, value in zip(stages, stage_values, strict=True)]
        return GenerationRun(
            **reference.model_dump(), id=RUN_ID, plan=plan, preview_hash=preview.preview_hash, policy=policy,
            job_id=JOB_ID, revision=3, status=status, stages=full_stages, maximum_tokens=preview.maximum_tokens,
            allocated_tokens=sum(stage.attempts * stage.token_upper_bound for stage in full_stages),
            created_at=STAMP, updated_at=STAMP,
        )

    done = {"status": "done", "attempts": 1, "output": lesson}
    pending = run("pending", [{}, {}])
    running = run("running", [done, {"status": "running", "attempts": 1}])
    failed = run("failed", [done, {"status": "needs_retry", "attempts": 1, "error_code": "provider_unavailable"}])
    uncertain = run("failed", [done, {"status": "needs_retry", "attempts": 1, "error_code": "operation_uncertain"}])
    cancelled = run("cancelled", [done, {}])
    resumed = run("pending", [done, {"attempts": 1}])
    completed = run("done", [done, {**done, "attempts": 2}])
    summary = GenerationSummary(
        id=RUN_ID, outline_id=OUTLINE_ID, title=plan.title, status=failed.status,
        completed_stages=1, total_stages=2, maximum_tokens=failed.maximum_tokens,
        allocated_tokens=failed.allocated_tokens, updated_at=STAMP,
    )
    valid = {
        "approval_ref": reference.model_dump(mode="json"), "policy": policy.model_dump(mode="json"),
        "stage_spec": stages[0].model_dump(mode="json"), "preview": preview.model_dump(mode="json"),
        "start_request": GenerationStartRequest(
            **reference.model_dump(), id=RUN_ID, preview_hash=preview.preview_hash, accept_budget=True,
        ).model_dump(mode="json"),
        "action_request": GenerationActionRequest(expected_revision=3).model_dump(mode="json"),
        "resume_request": GenerationResumeRequest(
            expected_revision=3, accept_remaining_budget=True,
        ).model_dump(mode="json"),
        "lesson": lesson.model_dump(mode="json"), "stage": running.stages[0].model_dump(mode="json"),
        "pending_run": pending.model_dump(mode="json"), "running_run": running.model_dump(mode="json"),
        "failed_run": failed.model_dump(mode="json"), "uncertain_run": uncertain.model_dump(mode="json"),
        "cancelled_run": cancelled.model_dump(mode="json"), "resumed_run": resumed.model_dump(mode="json"),
        "completed_run": completed.model_dump(mode="json"), "summary": summary.model_dump(mode="json"),
        "list": GenerationListResponse(items=[summary], limit=20, offset=0, total_count=1).model_dump(mode="json"),
    }
    invalid = []

    def reject(name, schema, original, keys, value):
        data = copy.deepcopy(original)
        target = data
        for key in keys[:-1]:
            target = target[key]
        target[keys[-1]] = value
        invalid.append({"name": name, "schema": schema, "input": data})

    for key in ("max_input_bytes", "max_output_tokens", "max_provider_attempts", "max_stage_attempts"):
        reject(f"policy-{key}-boolean", "policy", valid["policy"], (key,), True)
    for name, key, value in [
        ("policy-numeric-version", "version", 1), ("policy-too-small-input", "max_input_bytes", 0),
        ("policy-too-large-input", "max_input_bytes", 64001), ("policy-small-output", "max_output_tokens", 0),
        ("policy-large-output", "max_output_tokens", 4097), ("policy-attempts-zero", "max_provider_attempts", 0),
        ("policy-attempts-overflow", "max_provider_attempts", 21),
        ("policy-stage-attempts-overflow", "max_stage_attempts", 4),
        ("policy-provider-hash", "provider_fingerprint", "paid-provider"),
    ]:
        reject(name, "policy", valid["policy"], (key,), value)
    for schema in ("start_request", "resume_request"):
        key = "accept_budget" if schema == "start_request" else "accept_remaining_budget"
        for suffix, value in (("false", False), ("number", 1), ("string", "true"), ("null", None)):
            reject(f"{schema}-ack-{suffix}", schema, valid[schema], (key,), value)
    reject("start-not-publish", "start_request", valid["start_request"], ("visibility",), "catalog")
    reject("start-no-user-override", "start_request", valid["start_request"], ("user_id",), "someone-else")
    reject("start-no-unbounded-plan", "start_request", valid["start_request"], ("plan",), plan.model_dump(mode="json"))
    reject("ref-boolean-revision", "approval_ref", valid["approval_ref"], ("outline_revision",), True)
    reject("action-boolean-revision", "action_request", valid["action_request"], ("expected_revision",), True)
    reject("resume-zero-revision", "resume_request", valid["resume_request"], ("expected_revision",), 0)
    for name, keys, value in [
        ("preview-duplicate-stage", ("stages",), [valid["stage_spec"]] * 2),
        ("preview-empty-stage", ("stages",), []), ("preview-too-many-stages", ("stages",), [valid["stage_spec"]] * 31),
        ("preview-budget-discounts-retry", ("maximum_tokens",), 20000),
        ("preview-prompt-exceeds-policy", ("stages", 0, "input_bytes"), 12001),
        ("preview-boolean-budget", ("maximum_tokens",), True),
        ("preview-boolean-input", ("stages", 0, "input_bytes"), True),
        ("preview-stage-id-newline", ("stages", 0, "id"), "energy\n"),
        ("preview-nul-title", ("title",), "Private\0draft"),
        ("preview-surrogate-title", ("title",), "\ud800"),
    ]:
        reject(name, "preview", valid["preview"], keys, value)
    for name, key, value in [
        ("lesson-blank-title", "title", "\u001c\u0085"), ("lesson-blank-explanation", "explanation", "\u2002"),
        ("lesson-blank-example", "worked_example", " \t"), ("lesson-blank-question", "question", "\n"),
        ("lesson-blank-answer", "answer", "\u0085"), ("lesson-nul-answer", "answer", "bad\0text"),
        ("lesson-lone-surrogate", "explanation", "\ud800"),
        ("lesson-title-codepoint-limit", "title", "\U0001f331" * 201),
        ("lesson-explanation-limit", "explanation", "\U0001f331" * 6001),
        ("lesson-no-evidence", "evidence_ids", []), ("lesson-unknown-evidence", "evidence_ids", ["pin-5"]),
        ("lesson-duplicate-evidence", "evidence_ids", ["pin-1", "pin-1"]),
        ("lesson-no-execution", "execute_code", "print('never run')"),
    ]:
        reject(name, "lesson", valid["lesson"], (key,), value)
    for name, key, value in [
        ("stage-done-without-output", "output", None), ("stage-pending-with-output", "status", "pending"),
        ("stage-started-without-attempt", "attempts", 0), ("stage-boolean-attempt", "attempts", True),
        ("stage-unknown-error", "error_code", "provider-secret-details"),
        ("stage-done-carries-failure", "error_code", "invalid_output"),
    ]:
        reject(name, "stage", valid["stage"], (key,), value)
    reject("stage-retry-needs-reason", "stage", valid["failed_run"]["stages"][1], ("error_code",), None)
    for name, keys, value in [
        ("run-not-catalog", ("visibility",), "catalog"),
        ("run-not-editorial-reviewed", ("editorial_status",), "reviewed"),
        ("run-boolean-revision", ("revision",), True), ("run-boolean-allocation", ("allocated_tokens",), True),
        ("run-forgot-allocation", ("allocated_tokens",), 0), ("run-budget-inflation", ("maximum_tokens",), 99999999),
        ("run-cannot-complete-missing-stage", ("status",), "done"),
        ("run-stage-unknown-objective", ("stages", 0, "id"), "not-approved"),
        ("run-stage-wrong-module", ("stages", 0, "module_id"), "wrong-module"),
        ("run-stage-order-changed", ("stages",), list(reversed(valid["failed_run"]["stages"]))),
        ("run-stage-missing", ("stages",), valid["failed_run"]["stages"][:1]),
        ("run-stage-exhausts-policy", ("policy", "max_stage_attempts"), 0),
        ("run-no-owner-override", ("user_id",), "different-owner"),
    ]:
        reject(name, "run", valid["failed_run"], keys, value)
    reject("run-pin-not-for-objective", "run", valid["completed_run"],
           ("stages", 1, "output", "evidence_ids"), ["pin-2"])
    reject("list-page-limit", "list", valid["list"], ("limit",), 51)
    reject("list-boolean-total", "list", valid["list"], ("total_count",), True)
    reject("summary-boolean-completed", "summary", valid["summary"], ("completed_stages",), True)
    reject("summary-progress-overflow", "summary", valid["summary"], ("completed_stages",), 3)
    reject("summary-budget-overflow", "summary", valid["summary"], ("allocated_tokens",), 60001)
    reject("summary-done-with-missing-stage", "summary", valid["summary"], ("status",), "done")
    server_only = []
    for name, schema, original, keys in [
        ("preview-cryptographic-binding", "preview", valid["preview"], ("preview_hash",)),
        ("run-approved-plan-hash", "run", valid["completed_run"], ("outline_content_hash",)),
        ("run-preview-hash", "run", valid["completed_run"], ("preview_hash",)),
    ]:
        data = copy.deepcopy(original)
        data[keys[0]] = "f" * 64
        server_only.append({"name": name, "schema": schema, "input": data})
    return {"valid": valid, "invalid": invalid, "server_only_invalid": server_only}


if __name__ == "__main__":
    target = ROOT / "contracts/course-generation-api.json"
    target.write_text(json.dumps(wire_fixtures(), ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(f"Exported private generation fixtures to {target}")
