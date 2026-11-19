"""F04 wire parity, immutable approval references and bounded resumable progress."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

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
from scripts.export_generation_fixtures import wire_fixtures

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((ROOT / "contracts/course-generation-api.json").read_text(encoding="utf-8"))
MODELS = {
    "approval_ref": GenerationApprovalRef, "policy": GenerationPolicy, "stage_spec": GenerationStageSpec,
    "preview": GenerationPreview, "start_request": GenerationStartRequest, "action_request": GenerationActionRequest,
    "resume_request": GenerationResumeRequest, "lesson": LessonDraft, "stage": GenerationStage,
    "run": GenerationRun, "summary": GenerationSummary, "list": GenerationListResponse,
}


@pytest.mark.parametrize(("name", "model"), [
    *((name, model) for name, model in MODELS.items() if name != "run"),
    *((f"{status}_run", GenerationRun) for status in (
        "pending", "running", "failed", "uncertain", "cancelled", "resumed", "completed",
    )),
])
def test_generation_wire_fixtures_roundtrip_without_drift(name, model):
    assert model.model_validate(FIXTURE["valid"][name]).model_dump(mode="json") == FIXTURE["valid"][name]


@pytest.mark.parametrize("case", FIXTURE["invalid"] + FIXTURE["server_only_invalid"], ids=lambda item: item["name"])
def test_generation_rejects_invalid_contract_vectors(case):
    with pytest.raises(ValidationError):
        MODELS[case["schema"]].model_validate(case["input"])


def test_generation_fixtures_match_current_exporter():
    assert FIXTURE == wire_fixtures()


def test_generation_fixture_retains_completed_stage_and_prior_retry_allocation():
    failed = GenerationRun.model_validate(FIXTURE["valid"]["failed_run"])
    resumed = GenerationRun.model_validate(FIXTURE["valid"]["resumed_run"])
    done = GenerationRun.model_validate(FIXTURE["valid"]["completed_run"])
    assert failed.stages[0] == resumed.stages[0] == done.stages[0]
    assert failed.allocated_tokens == resumed.allocated_tokens == 20000
    assert done.allocated_tokens == 30000 < done.maximum_tokens
    assert failed.outline_content_hash == done.outline_content_hash == done.plan.content_hash()
    assert failed.preview_hash == resumed.preview_hash == done.preview_hash
    assert done.visibility == "private" and done.editorial_status == "not_reviewed"
