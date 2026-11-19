"""Cross-language F02 selection/notebook evidence fixture parity."""

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.source_versions.contracts import EvidencePin, ResolvedEvidence, SourceSnapshot, SourceVersion
from app.source_versions.github_contracts import GithubImportRequest
from app.source_versions.service import resolve_version
from scripts.export_github_fixtures import wire_fixtures
from scripts.export_source_fixtures import wire_fixtures as legacy_fixtures

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((ROOT / "contracts/github-import-api.json").read_text(encoding="utf-8"))
MODELS = {"request": GithubImportRequest, "snapshot": SourceSnapshot}


@pytest.mark.parametrize(("name", "model"), [
    ("request", GithubImportRequest), ("request_with_defaults", GithubImportRequest),
    ("version", SourceVersion), ("pin", EvidencePin), ("resolved", ResolvedEvidence),
])
def test_github_fixture_roundtrip(name, model):
    assert model.model_validate(FIXTURE["valid"][name]).model_dump(mode="json") == FIXTURE["valid"][name]


@pytest.mark.parametrize("case", FIXTURE["invalid"], ids=lambda value: value["name"])
def test_github_invalid_contract_fixture(case):
    with pytest.raises(ValidationError):
        MODELS[case["schema"]].model_validate(case["input"])


def test_github_fixtures_are_generated_by_current_contracts_and_legacy_hashes_stay_stable():
    assert FIXTURE == wire_fixtures()
    old = json.loads((ROOT / "contracts/source-version-api.json").read_text(encoding="utf-8"))
    assert old == legacy_fixtures()
    for item in ("pdf_version", "github_version"):
        version = old["valid"][item]
        assert "repository_files" not in version["snapshot"]["provenance"]
        assert "notebook_cell" not in version["snapshot"]["segments"][0]["locator"]


def test_notebook_source_locators_keep_exact_cell_text_and_omit_false_raw_json_line_links():
    version = SourceVersion.model_validate(FIXTURE["valid"]["version"])
    pin = EvidencePin.model_validate(FIXTURE["valid"]["pin"])
    assert pin.locator.notebook_cell.index == 0
    assert pin.locator.notebook_cell.cell_type == "markdown"
    assert pin.locator.start_line == 1
    resolved = resolve_version(version, pin)
    assert resolved.model_dump(mode="json") == FIXTURE["valid"]["resolved"]
    assert resolved.canonical_url.endswith("/lessons/light.ipynb")
    assert "#L" not in resolved.canonical_url


def test_optional_f02_metadata_remains_omitted_for_legacy_none_fields():
    old = legacy_fixtures()["valid"]["github_version"]
    data = copy.deepcopy(old)
    data["snapshot"]["provenance"]["repository_files"] = None
    data["snapshot"]["segments"][0]["locator"]["notebook_cell"] = None
    assert SourceVersion.model_validate(data).model_dump(mode="json") == old
