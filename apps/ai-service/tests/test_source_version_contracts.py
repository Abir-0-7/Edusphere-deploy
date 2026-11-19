"""Cross-language F01 wire fixtures and server-authoritative hash verification."""

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.source_versions.contracts import (
    EvidencePin,
    PdfSnapshotRequest,
    ResolvedEvidence,
    SourceSnapshot,
    SourceVersion,
)
from app.source_versions.service import resolve_version
from scripts.export_source_fixtures import wire_fixtures

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = json.loads((ROOT / "contracts/source-version-api.json").read_text(encoding="utf-8"))
MODELS = {
    "source_snapshot": SourceSnapshot,
    "evidence_pin": EvidencePin,
    "pdf_snapshot_request": PdfSnapshotRequest,
}


@pytest.mark.parametrize(("name", "model"), [
    ("pdf_snapshot_request", PdfSnapshotRequest),
    ("pdf_version", SourceVersion), ("github_version", SourceVersion),
    ("pdf_pin", EvidencePin), ("github_pin", EvidencePin),
    ("pdf_resolved", ResolvedEvidence), ("github_resolved", ResolvedEvidence),
])
def test_shared_valid_source_fixtures_roundtrip_without_drift(name, model):
    assert model.model_validate(FIXTURES["valid"][name]).model_dump(mode="json") == FIXTURES["valid"][name]


@pytest.mark.parametrize("case", FIXTURES["invalid"], ids=lambda item: item["name"])
def test_shared_invalid_source_fixtures_are_rejected(case):
    with pytest.raises(ValidationError):
        MODELS[case["schema"]].model_validate(case["input"])


def test_source_fixtures_match_actual_python_model_generation():
    assert FIXTURES == wire_fixtures()


@pytest.mark.parametrize("kind", ["pdf", "github"])
def test_exact_fixture_resolution_and_hashes_are_server_verified(kind):
    version = SourceVersion.model_validate(FIXTURES["valid"][f"{kind}_version"])
    pin = EvidencePin.model_validate(FIXTURES["valid"][f"{kind}_pin"])
    assert resolve_version(version, pin).model_dump(mode="json") == FIXTURES["valid"][f"{kind}_resolved"]
    changed = copy.deepcopy(FIXTURES["valid"][f"{kind}_version"])
    changed["content_hash"] = "f" * 64
    with pytest.raises(ValidationError, match="hash"):
        SourceVersion.model_validate(changed)
    changed = copy.deepcopy(FIXTURES["valid"][f"{kind}_version"])
    changed["snapshot"]["segments"][0]["text"] += " fabricated"
    with pytest.raises(ValidationError, match="hash"):
        SourceVersion.model_validate(changed)
