"""Regenerate deterministic cross-language source/evidence fixtures from Python models.

Run from apps/ai-service: python -m scripts.export_source_fixtures
No database, network or LLM calls are performed.
"""

import copy
import hashlib
import json
from pathlib import Path
from uuid import UUID

from app.source_versions.contracts import EvidencePin, PdfSnapshotRequest, SourceSnapshot, SourceVersion
from app.source_versions.service import resolve_version

ROOT = Path(__file__).resolve().parents[3]
DOCUMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CHUNK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
CHAPTER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"


def fixture_versions() -> tuple[SourceVersion, SourceVersion]:
    pdf_text = "Light carries energy. \u0986\u09b2\u09cb"
    pdf = SourceSnapshot.model_validate({
        "title": "Physics.pdf",
        "origin": {
            "kind": "pdf", "document_id": DOCUMENT_ID, "page_count": 12,
            "book_title": "Physics", "edition": "2nd edition",
        },
        "provenance": {
            "adapter": "legacy_pdf_chunks", "rights": {"status": "user_declared", "statement": "Private study."},
        },
        "segments": [{
            "id": CHUNK_ID,
            "locator": {
                "kind": "pdf", "pdf_page_index": 3, "printed_page_label": "iv",
                "chunk_id": CHUNK_ID, "chapter_id": CHAPTER_ID,
            },
            "text": pdf_text, "text_sha256": hashlib.sha256(pdf_text.encode()).hexdigest(),
        }],
    })
    repo_text = "# Selected docs\nNo imported code runs."
    repo = SourceSnapshot.model_validate({
        "title": "Pinned public docs",
        "origin": {"kind": "github", "owner": "example", "repository": "course", "commit": "a" * 40},
        "provenance": {
            "adapter": "github_selected_text", "parser_name": "fixture-lines", "parser_version": "1",
            "rights": {"status": "public_license", "statement": "MIT (fixture declaration)"},
        },
        "segments": [{
            "id": "readme-1",
            "locator": {"kind": "github", "path": "docs/hello world.md", "start_line": 8, "end_line": 9},
            "text": repo_text, "text_sha256": hashlib.sha256(repo_text.encode()).hexdigest(),
        }],
    })
    return tuple(SourceVersion(
        id=UUID(identifier), content_hash=snapshot.content_hash(), snapshot=snapshot,
        created_at="2026-11-19T00:00:00+00:00",
    ) for identifier, snapshot in [
        ("cccccccc-cccc-4ccc-8ccc-cccccccccccc", pdf), ("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", repo),
    ])


def wire_fixtures() -> dict:
    valid = {
        "pdf_snapshot_request": PdfSnapshotRequest(
            book_title="Physics", edition="2nd edition", printed_page_labels={"3": "iv"},
            rights_statement="Private study.",
        ).model_dump(mode="json"),
    }
    for kind, version in zip(["pdf", "github"], fixture_versions(), strict=True):
        segment = version.snapshot.segments[0]
        pin = EvidencePin(
            version_id=version.id, content_hash=version.content_hash, segment_id=segment.id,
            locator=segment.locator, quote=segment.text,
        )
        valid[f"{kind}_version"] = version.model_dump(mode="json")
        valid[f"{kind}_pin"] = pin.model_dump(mode="json")
        valid[f"{kind}_resolved"] = resolve_version(version, pin).model_dump(mode="json")

    invalid = []

    def reject(name, schema, original, keys, value):
        data = copy.deepcopy(original)
        target = data
        for key in keys[:-1]:
            target = target[key]
        target[keys[-1]] = value
        invalid.append({"name": name, "schema": schema, "input": data})

    for name, keys, value in [
        ("physical-page-zero", ("locator", "pdf_page_index"), 0),
        ("coerced-page-string", ("locator", "pdf_page_index"), "3"),
        ("missing-version-identity", ("version_id",), "missing"),
        ("empty-evidence-quote", ("quote",), ""),
    ]:
        reject(name, "evidence_pin", valid["pdf_pin"], keys, value)
    for name, keys, value in [
        ("unversioned-commit", ("origin", "commit"), "main"),
        ("encoded-traversal", ("segments", 0, "locator", "path"), "%2e%2e/file"),
        ("reversed-lines", ("segments", 0, "locator", "end_line"), 7),
        ("wrong-line-count", ("segments", 0, "locator", "end_line"), 10),
        ("unknown-rights-claim", ("provenance", "rights", "status"), "unknown"),
        ("unsupported-schema-version", ("schema_version",), 2),
        ("boolean-schema-version", ("schema_version",), True),
        ("nul-source-title", ("title",), "title\x00suffix"),
        ("unpaired-surrogate-title", ("title",), "title\ud800suffix"),
        ("newline-commit", ("origin", "commit"), "a" * 40 + "\n"),
    ]:
        reject(name, "source_snapshot", valid["github_version"]["snapshot"], keys, value)
    reject(
        "false-historic-parser", "source_snapshot", valid["pdf_version"]["snapshot"],
        ("provenance", "parser_name"), "pdfplumber",
    )
    reject(
        "printed-label-is-not-an-index", "pdf_snapshot_request", valid["pdf_snapshot_request"],
        ("printed_page_labels",), {"iv": "3"},
    )
    reject(
        "nul-printed-label", "pdf_snapshot_request", valid["pdf_snapshot_request"],
        ("printed_page_labels",), {"3": "iv\x00"},
    )
    return {"valid": valid, "invalid": invalid}


if __name__ == "__main__":
    target = ROOT / "contracts" / "source-version-api.json"
    target.write_text(json.dumps(wire_fixtures(), ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(f"Exported source-version fixtures to {target}")
