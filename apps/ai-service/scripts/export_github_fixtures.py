"""Regenerate F02 GitHub selection/notebook wire fixtures without network calls.

Run from apps/ai-service: python -m scripts.export_github_fixtures
Only data is constructed; notebook sources are never evaluated or executed.
"""

import copy
import hashlib
import json
from pathlib import Path
from uuid import UUID

from app.source_versions.contracts import EvidencePin, SourceSnapshot, SourceVersion
from app.source_versions.github_contracts import GithubImportRequest
from app.source_versions.service import resolve_version

ROOT = Path(__file__).resolve().parents[3]


def wire_fixtures() -> dict:
    request = GithubImportRequest.model_validate({
        "origin": {"kind": "github", "owner": "example", "repository": "teaching", "commit": "a" * 40},
        "files": [
            {"kind": "text", "path": "docs/reading.md", "start_line": 1, "end_line": 2},
            {"kind": "notebook", "path": "lessons/light.ipynb", "cells": [
                {"index": 0, "start_line": 1, "end_line": 2}, {"index": 1},
            ]},
        ],
        "rights_statement": "I may use these selected public materials for private study.",
    })
    markdown = "# Light\nLight carries energy. \u0986\u09b2\u09cb"
    code = "print('Imported code is only text.')"
    notebook = json.dumps({"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": [
        {"cell_type": "markdown", "source": ["# Light\n", "Light carries energy. \u0986\u09b2\u09cb"], "metadata": {}},
        {"cell_type": "code", "source": [code], "metadata": {}, "outputs": [], "execution_count": None},
    ]}, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    originals = [("docs/reading.md", markdown.encode("utf-8")), ("lessons/light.ipynb", notebook)]
    files = [{
        "path": path,
        "git_blob_sha": hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest(),
        "raw_sha256": hashlib.sha256(data).hexdigest(), "byte_count": len(data),
    } for path, data in originals]
    segments = []
    for identifier, path, text, cell in [
        ("reading:1", "docs/reading.md", markdown, None),
        ("notebook:0:1", "lessons/light.ipynb", markdown, {"index": 0, "cell_type": "markdown"}),
        ("notebook:1:1", "lessons/light.ipynb", code, {"index": 1, "cell_type": "code"}),
    ]:
        locator = {"kind": "github", "path": path, "start_line": 1, "end_line": len(text.splitlines())}
        if cell is not None:
            locator["notebook_cell"] = cell
        segments.append({
            "id": identifier, "locator": locator, "text": text,
            "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        })
    snapshot = SourceSnapshot.model_validate({
        "title": "example/teaching selected private study sources",
        "origin": request.origin.model_dump(mode="json"),
        "provenance": {
            "adapter": "github_selected_text", "parser_name": "studyvault-github-text", "parser_version": "1",
            "rights": {"status": "user_declared", "statement": request.rights_statement},
            "repository_files": files,
        },
        "segments": segments,
    })
    version = SourceVersion(
        id=UUID("ffffffff-ffff-4fff-8fff-ffffffffffff"), content_hash=snapshot.content_hash(), snapshot=snapshot,
        created_at="2026-11-19T00:00:00+00:00",
    )
    segment = snapshot.segments[1]
    pin = EvidencePin(
        version_id=version.id, content_hash=version.content_hash, segment_id=segment.id,
        locator=segment.locator, quote=segment.text,
    )
    valid = {
        "request": request.model_dump(mode="json"), "version": version.model_dump(mode="json"),
        "pin": pin.model_dump(mode="json"), "resolved": resolve_version(version, pin).model_dump(mode="json"),
        "request_with_defaults": GithubImportRequest.model_validate({
            "origin": request.origin.model_dump(mode="json"),
            "files": [{"kind": "text", "path": "README.md"}], "rights_statement": "Permitted study.",
        }).model_dump(mode="json"),
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
        ("unknown-url-input", ("url",), "http://127.0.0.1/secret"),
        ("unknown-token-input", ("token",), "not-an-allowed-field"),
        ("branch-instead-of-commit", ("origin", "commit"), "main"),
        ("short-commit", ("origin", "commit"), "a" * 39),
        ("newline-commit", ("origin", "commit"), "a" * 40 + "\n"),
        ("encoded-traversal", ("files", 0, "path"), "%2e%2e/secret.txt"),
        ("absolute-path", ("files", 0, "path"), "/secret.txt"),
        ("path-control", ("files", 0, "path"), "docs/\nsecret.md"),
        ("boolean-line", ("files", 0, "start_line"), True),
        ("string-line", ("files", 0, "start_line"), "1"),
        ("reversed-range", ("files", 0, "start_line"), 3),
        ("oversized-range", ("files", 0, "end_line"), 1001),
        ("text-kind-notebook", ("files", 0, "path"), "unsafe.ipynb"),
        ("notebook-kind-text", ("files", 1, "path"), "unsafe.py"),
        ("negative-cell", ("files", 1, "cells", 0, "index"), -1),
        ("boolean-cell", ("files", 1, "cells", 0, "index"), True),
        ("too-large-cell", ("files", 1, "cells", 0, "index"), 256),
        ("duplicate-cell", ("files", 1, "cells", 1, "index"), 0),
        ("no-cells", ("files", 1, "cells"), []),
        ("too-many-cells", ("files", 1, "cells"), [{"index": index} for index in range(9)]),
        ("empty-rights", ("rights_statement",), ""),
        ("blank-rights", ("rights_statement",), "\t\n\u0085\u001c "),
        ("nul-rights", ("rights_statement",), "Private\0study"),
        ("surrogate-rights", ("rights_statement",), "Private\ud800"),
        ("oversized-rights", ("rights_statement",), "x" * 1001),
        ("no-files", ("files",), []),
        ("duplicate-files", ("files",), [valid["request"]["files"][0]] * 2),
        ("too-many-files", ("files",), [
            {"kind": "text", "path": f"docs/{index}.md"} for index in range(17)
        ]),
    ]:
        reject(name, "request", valid["request"], keys, value)
    for name, keys, value in [
        ("bad-cell-type", ("segments", 1, "locator", "notebook_cell", "cell_type"), "raw"),
        ("cell-index-boolean", ("segments", 1, "locator", "notebook_cell", "index"), True),
        ("empty-file-provenance", ("provenance", "repository_files"), []),
        ("duplicate-file-provenance", ("provenance", "repository_files"), [files[0], files[0], files[1]]),
        ("uncovered-file-provenance", ("provenance", "repository_files"), [files[0]]),
        ("zero-byte-count", ("provenance", "repository_files", 0, "byte_count"), 0),
        ("oversized-byte-count", ("provenance", "repository_files", 0, "byte_count"), 262145),
        ("short-blob-sha", ("provenance", "repository_files", 0, "git_blob_sha"), "b" * 39),
        ("newline-raw-hash", ("provenance", "repository_files", 0, "raw_sha256"), "b" * 64 + "\n"),
    ]:
        reject(name, "snapshot", valid["version"]["snapshot"], keys, value)
    return {"valid": valid, "invalid": invalid}


if __name__ == "__main__":
    target = ROOT / "contracts/github-import-api.json"
    target.write_text(json.dumps(wire_fixtures(), ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(f"Exported GitHub import fixtures to {target}")
