"""Shared wire fixtures and executable documentation for integrated study tools."""

import json
from pathlib import Path

import pytest

import app.main as main
from app import contracts
from scripts.export_openapi import core_openapi

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((ROOT / "contracts/learning-api.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize(("name", "model"), [
    ("upload", contracts.ParsePdfResponse), ("job", contracts.JobResponse),
    ("chapter", contracts.ChapterResponse), ("flashcard", contracts.FlashcardResponse),
    ("generation", contracts.FlashcardGenerationResponse), ("review_request", contracts.ReviewRequest),
    ("review", contracts.ReviewResult), ("review_replay", contracts.ReviewResult),
    ("chat_request", contracts.ChatRequest), ("chat", contracts.ChatReply), ("error", contracts.ErrorEnvelope),
])
def test_shared_wire_fixture(name, model):
    assert model.model_validate(FIXTURE[name]).model_dump(mode="json", exclude_unset=True) == FIXTURE[name]


def test_openapi_snapshot_matches_executable_models():
    documented = json.loads((ROOT / "docs/openapi.yaml").read_text(encoding="utf-8"))
    assert documented == core_openapi(main.app.openapi())
    for path, operations in documented["paths"].items():
        if not (path.startswith("/api/whiteboards") or path == "/api/code-review"):
            continue
        for operation in operations.values():
            assert "422" not in operation["responses"]
            assert "400" in operation["responses"]
    review = documented["paths"]["/api/code-review"]["post"]
    assert review["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/CodeReviewRequest",
    }
    assert review["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/CodeReview",
    }
