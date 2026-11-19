"""Regenerate deterministic F03 private outline wire fixtures without network or DB."""

import copy
import json
from pathlib import Path
from uuid import UUID

from app.course_outlines.contracts import (
    OutlineApproval,
    OutlineApprovalListResponse,
    OutlineApproveRequest,
    OutlineCreateRequest,
    OutlineDeleteResponse,
    OutlineListResponse,
    OutlinePlan,
    OutlineRecord,
    OutlineSourceListResponse,
    OutlineSourceSummary,
    OutlineSummary,
    OutlineUpdateRequest,
)
from app.course_outlines.coverage import analyze_plan
from app.source_versions.contracts import EvidencePin, SourceVersion
from scripts.export_github_fixtures import wire_fixtures as github_fixtures
from scripts.export_source_fixtures import fixture_versions

ROOT = Path(__file__).resolve().parents[3]
OUTLINE_ID = UUID("11111111-1111-4111-8111-111111111111")
APPROVAL_ID = UUID("22222222-2222-4222-8222-222222222222")
STAMP = "2026-11-19T12:00:00+00:00"


def outline_sources() -> tuple[SourceVersion, SourceVersion]:
    return fixture_versions()[0], SourceVersion.model_validate(github_fixtures()["valid"]["version"])


class FixtureSources:
    def __init__(self, versions):
        self.versions = {str(item.id): item for item in versions}

    def get(self, user_id, version_id):
        return self.versions.get(version_id) if user_id == "fixture-owner" else None


def outline_plan(*, ready: bool = False) -> OutlinePlan:
    versions = outline_sources()
    pins = []
    for version in versions:
        segment = version.snapshot.segments[0]
        pins.append(EvidencePin(
            version_id=version.id, content_hash=version.content_hash, segment_id=segment.id,
            locator=segment.locator, quote=segment.text,
        ).model_dump(mode="json"))
    data = {
        "title": "Light and evidence \u0986\u09b2\u09cb",
        "outcome": "Compare the precise statements supported by a book excerpt and pinned repository notes.",
        "sources": [{"version_id": str(version.id), "content_hash": version.content_hash} for version in versions],
        "objectives": [
            {"id": "energy", "title": "Explain that light carries energy", "estimated_minutes": 25,
             "evidence": pins, "review_status": "reviewed" if ready else "needs_review"},
            {"id": "speed", "title": "Calculate speed from a missing numerical source", "estimated_minutes": 15,
             "prerequisite_ids": ["energy"]},
        ],
        "modules": [{"id": "foundations", "title": "Light foundations", "objective_ids": ["energy", "speed"]}],
        "conflicts": [{
            "id": "scope-review", "objective_id": "energy", "first": pins[0], "second": pins[1],
            "description": "Owner flag: compare scope and context before combining the extracts.",
            "resolution": "Both excerpts support the energy statement; no extra numerical claim is inferred."
            if ready else None,
        }],
    }
    if ready:
        data["objectives"] = data["objectives"][:1]
        data["modules"][0]["objective_ids"] = ["energy"]
    return OutlinePlan.model_validate(data)


def wire_fixtures() -> dict:
    sources = outline_sources()
    resolver = FixtureSources(sources)
    draft, ready = outline_plan(), outline_plan(ready=True)
    draft_coverage = analyze_plan("fixture-owner", draft, resolver)
    ready_coverage = analyze_plan("fixture-owner", ready, resolver)
    misordered_data = ready.model_dump(mode="json")
    misordered_data["objectives"].append({
        **copy.deepcopy(misordered_data["objectives"][0]), "id": "apply-energy",
        "title": "Compare the two energy excerpts", "estimated_minutes": 10, "prerequisite_ids": ["energy"],
    })
    misordered_data["modules"][0]["objective_ids"] = ["apply-energy", "energy"]
    misordered = OutlinePlan.model_validate(misordered_data)
    misordered_coverage = analyze_plan("fixture-owner", misordered, resolver)
    approval = OutlineApproval(
        id=APPROVAL_ID, outline_id=OUTLINE_ID, revision=2, content_hash=ready.content_hash(),
        snapshot={"plan": ready, "coverage": ready_coverage}, created_at=STAMP,
    )
    receipt = approval.model_dump(mode="json", exclude={"snapshot", "outline_id"})
    draft_record = OutlineRecord(
        id=OUTLINE_ID, revision=1, content_hash=draft.content_hash(), plan=draft, coverage=draft_coverage,
        status="draft", created_at=STAMP, updated_at=STAMP,
    )
    approved_record = OutlineRecord(
        id=OUTLINE_ID, revision=2, content_hash=ready.content_hash(), plan=ready, coverage=ready_coverage,
        status="approved", approval=receipt, created_at=STAMP, updated_at=STAMP,
    )
    summary = OutlineSummary(
        id=OUTLINE_ID, title=ready.title, revision=2, status="approved", estimated_minutes=25,
        source_count=2, objective_count=1, content_hash=ready.content_hash(), updated_at=STAMP,
    )
    source_summaries = [OutlineSourceSummary(
        id=version.id, content_hash=version.content_hash, title=version.snapshot.title,
        kind=version.snapshot.origin.kind, segment_count=len(version.snapshot.segments), created_at=version.created_at,
    ) for version in sources]
    valid = {
        "draft_plan": draft.model_dump(mode="json"), "ready_plan": ready.model_dump(mode="json"),
        "draft_coverage": draft_coverage.model_dump(mode="json"),
        "ready_coverage": ready_coverage.model_dump(mode="json"),
        "misordered_plan": misordered.model_dump(mode="json"),
        "misordered_coverage": misordered_coverage.model_dump(mode="json"),
        "create_request": OutlineCreateRequest(id=OUTLINE_ID, plan=draft).model_dump(mode="json"),
        "update_request": OutlineUpdateRequest(expected_revision=1, plan=ready).model_dump(mode="json"),
        "approve_request": OutlineApproveRequest(
            expected_revision=2, content_hash=ready.content_hash(), reviewed_evidence=True,
        ).model_dump(mode="json"),
        "draft_record": draft_record.model_dump(mode="json"),
        "approved_record": approved_record.model_dump(mode="json"),
        "approval": approval.model_dump(mode="json"),
        "approval_list": OutlineApprovalListResponse(items=[approval]).model_dump(mode="json"),
        "outline_list": OutlineListResponse(items=[summary], limit=20, offset=0, total_count=1).model_dump(mode="json"),
        "source_list": OutlineSourceListResponse(
            items=source_summaries, limit=20, offset=0, total_count=2,
        ).model_dump(mode="json"),
        "delete_response": OutlineDeleteResponse().model_dump(mode="json"),
    }
    invalid = []

    def reject(name, schema, original, keys, value):
        data = copy.deepcopy(original)
        target = data
        for key in keys[:-1]:
            target = target[key]
        target[keys[-1]] = value
        invalid.append({"name": name, "schema": schema, "input": data})

    for name, keys, value in [
        ("schema-boolean", ("schema_version",), True),
        ("blank-title", ("title",), " \u0085\u001c"),
        ("blank-outcome", ("outcome",), "\u2002"),
        ("nul-title", ("title",), "Private\0outline"),
        ("surrogate-title", ("title",), "\ud800"),
        ("too-long-title", ("title",), "\U0001f331" * 201),
        ("missing-sources", ("sources",), []),
        ("duplicate-source", ("sources",), [valid["draft_plan"]["sources"][0]] * 2),
        ("duplicate-objective", ("objectives",), [valid["draft_plan"]["objectives"][0]] * 2),
        ("duplicate-module", ("modules",), valid["draft_plan"]["modules"] * 2),
        ("duplicate-conflict", ("conflicts",), valid["draft_plan"]["conflicts"] * 2),
        ("blank-objective", ("objectives", 0, "title"), "\u0085"),
        ("newline-id", ("objectives", 0, "id"), "energy\n"),
        ("boolean-effort", ("objectives", 0, "estimated_minutes"), True),
        ("zero-effort", ("objectives", 0, "estimated_minutes"), 0),
        ("oversized-effort", ("objectives", 0, "estimated_minutes"), 601),
        ("unknown-prerequisite", ("objectives", 0, "prerequisite_ids"), ["missing"]),
        ("self-prerequisite", ("objectives", 0, "prerequisite_ids"), ["energy"]),
        ("duplicate-prerequisite", ("objectives", 1, "prerequisite_ids"), ["energy", "energy"]),
        ("prerequisite-cycle", ("objectives", 0, "prerequisite_ids"), ["speed"]),
        ("source-pin-hash-mismatch", ("objectives", 0, "evidence", 0, "content_hash"), "f" * 64),
        ("source-pin-version-mismatch", ("objectives", 0, "evidence", 0, "version_id"), str(APPROVAL_ID)),
        ("duplicate-pin", ("objectives", 0, "evidence"), [valid["draft_plan"]["objectives"][0]["evidence"][0]] * 2),
        ("blank-evidence-quote", ("objectives", 0, "evidence", 0, "quote"), "\u001f"),
        ("unknown-module-objective", ("modules", 0, "objective_ids"), ["missing"]),
        ("duplicate-module-objective", ("modules", 0, "objective_ids"), ["energy", "energy"]),
        ("blank-module-title", ("modules", 0, "title"), "\u0085"),
        ("conflict-unknown-objective", ("conflicts", 0, "objective_id"), "missing"),
        ("conflict-same-pin", ("conflicts", 0, "second"), valid["draft_plan"]["conflicts"][0]["first"]),
        ("conflict-unlinked-pin", ("conflicts", 0, "second", "quote"), "An unlinked assertion"),
        ("blank-conflict-resolution", ("conflicts", 0, "resolution"), "\u0085"),
        ("editorial-injection", ("editorial_status",), "reviewed"),
        ("publication-injection", ("visibility",), "catalog"),
    ]:
        reject(name, "plan", valid["draft_plan"], keys, value)
    for name, key, value in [
        ("approval-needs-review", "reviewed_evidence", False),
        ("approval-no-numeric-ack", "reviewed_evidence", 1),
        ("approval-no-string-ack", "reviewed_evidence", "true"),
        ("approval-zero-revision", "expected_revision", 0),
        ("approval-boolean-revision", "expected_revision", True),
        ("approval-bad-hash", "content_hash", "main"),
        ("approval-no-editorial-claim", "editorial_status", "reviewed"),
        ("approval-no-replacement-plan", "plan", valid["ready_plan"]),
    ]:
        reject(name, "approve_request", valid["approve_request"], (key,), value)
    reject("create-no-catalog", "create_request", valid["create_request"], ("visibility",), "catalog")
    reject("update-no-editorial", "update_request", valid["update_request"], ("editorial_status",), "reviewed")
    reject("update-boolean-revision", "update_request", valid["update_request"], ("expected_revision",), True)
    reject("record-no-catalog", "record", valid["approved_record"], ("visibility",), "catalog")
    reject("record-no-editorial", "record", valid["approved_record"], ("editorial_status",), "reviewed")
    reject("coverage-boolean-effort", "coverage", valid["draft_coverage"], ("estimated_minutes",), True)
    reject("approval-not-ready", "approval", valid["approval"], ("snapshot", "coverage", "ready_for_approval"), False)
    reject("source-list-bound", "source_list", valid["source_list"], ("limit",), 51)
    reject("source-list-owner-injection", "source_list", valid["source_list"], ("user_id",), "other-owner")
    server_only = []
    wrong_hash = copy.deepcopy(valid["approval"])
    wrong_hash["content_hash"] = "0" * 64
    server_only.append({"name": "approval-hash-must-match-reviewed-plan", "schema": "approval", "input": wrong_hash})
    return {
        "valid": valid, "invalid": invalid, "server_only_invalid": server_only,
        "source_versions": [version.model_dump(mode="json") for version in sources],
    }


if __name__ == "__main__":
    target = ROOT / "contracts/course-outline-api.json"
    target.write_text(json.dumps(wire_fixtures(), ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(f"Exported private outline fixtures to {target}")
