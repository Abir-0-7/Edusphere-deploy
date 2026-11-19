"""F03 generated wire parity, exact hashes and private/editorial contract boundaries."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.course_outlines.contracts import (
    OutlineApproval,
    OutlineApprovalListResponse,
    OutlineApproveRequest,
    OutlineCoverage,
    OutlineCreateRequest,
    OutlineDeleteResponse,
    OutlineListResponse,
    OutlinePlan,
    OutlineRecord,
    OutlineSourceListResponse,
    OutlineUpdateRequest,
)
from scripts.export_outline_fixtures import FixtureSources, outline_sources, wire_fixtures

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((ROOT / "contracts/course-outline-api.json").read_text(encoding="utf-8"))
MODELS = {
    "plan": OutlinePlan, "create_request": OutlineCreateRequest, "update_request": OutlineUpdateRequest,
    "approve_request": OutlineApproveRequest, "record": OutlineRecord, "coverage": OutlineCoverage,
    "approval": OutlineApproval, "source_list": OutlineSourceListResponse,
}


@pytest.mark.parametrize(("name", "model"), [
    ("draft_plan", OutlinePlan), ("ready_plan", OutlinePlan),
    ("misordered_plan", OutlinePlan), ("misordered_coverage", OutlineCoverage),
    ("draft_coverage", OutlineCoverage), ("ready_coverage", OutlineCoverage),
    ("create_request", OutlineCreateRequest), ("update_request", OutlineUpdateRequest),
    ("approve_request", OutlineApproveRequest), ("draft_record", OutlineRecord),
    ("approved_record", OutlineRecord), ("approval", OutlineApproval),
    ("approval_list", OutlineApprovalListResponse), ("outline_list", OutlineListResponse),
    ("source_list", OutlineSourceListResponse), ("delete_response", OutlineDeleteResponse),
])
def test_outline_fixtures_roundtrip_without_wire_drift(name, model):
    assert model.model_validate(FIXTURE["valid"][name]).model_dump(mode="json") == FIXTURE["valid"][name]


@pytest.mark.parametrize("case", FIXTURE["invalid"] + FIXTURE["server_only_invalid"], ids=lambda item: item["name"])
def test_invalid_private_outline_contract_fixtures_are_rejected(case):
    with pytest.raises(ValidationError):
        MODELS[case["schema"]].model_validate(case["input"])


def test_outline_fixtures_match_current_model_and_coverage_generation():
    assert FIXTURE == wire_fixtures()


def test_two_source_fixture_has_gap_overlap_and_explicit_owner_conflict_review():
    from app.course_outlines.coverage import analyze_plan

    draft = OutlinePlan.model_validate(FIXTURE["valid"]["draft_plan"])
    source_store = FixtureSources(outline_sources())
    coverage = analyze_plan("fixture-owner", draft, source_store)
    assert coverage.gap_objective_ids == ["speed"]
    assert coverage.overlap_objective_ids == ["energy"]
    assert coverage.unresolved_conflict_ids == ["scope-review"]
    assert coverage.estimated_minutes == 40 and not coverage.ready_for_approval
    ready = OutlinePlan.model_validate(FIXTURE["valid"]["ready_plan"])
    reviewed = analyze_plan("fixture-owner", ready, source_store)
    assert reviewed.ready_for_approval and reviewed.estimated_minutes == 25
    record = OutlineRecord.model_validate(FIXTURE["valid"]["approved_record"])
    assert record.visibility == "private" and record.editorial_status == "not_reviewed"
    assert record.content_hash == ready.content_hash() == record.approval.content_hash


def test_prerequisite_after_its_dependent_blocks_approval_without_a_missing_source():
    from app.course_outlines.coverage import analyze_plan

    plan = OutlinePlan.model_validate(FIXTURE["valid"]["misordered_plan"])
    coverage = analyze_plan("fixture-owner", plan, FixtureSources(outline_sources()))
    assert coverage.misordered_objective_ids == ["apply-energy"]
    assert coverage.gap_objective_ids == [] and coverage.unmapped_objective_ids == []
    assert coverage.unreviewed_objective_ids == [] and coverage.unresolved_conflict_ids == []
    assert not coverage.ready_for_approval
    corrected = plan.model_dump(mode="json")
    corrected["modules"][0]["objective_ids"] = ["energy", "apply-energy"]
    reviewed = analyze_plan("fixture-owner", OutlinePlan.model_validate(corrected), FixtureSources(outline_sources()))
    assert reviewed.misordered_objective_ids == [] and reviewed.ready_for_approval
