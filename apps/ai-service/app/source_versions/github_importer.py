"""Bounded Git objects -> immutable private learning text. Never executes imports."""

import base64
import binascii
import hashlib
import json
import math
import re
import threading

from pydantic import ValidationError

from app.errors import InvalidInput, TooLarge
from app.source_versions.contracts import MAX_SEGMENT_CHARS, GithubFileProvenance, SourceSnapshot
from app.source_versions.github_contracts import GithubImportRequest, NotebookFileSelection
from app.source_versions.github_limits import ImportBudget, ImportLimits

PARSER_NAME, PARSER_VERSION = "studyvault-github-text", "1"
_SHA = re.compile(r"[0-9a-f]{40}\Z")
_DENIED_DIRS = {
    "node_modules", "vendor", "vendors", "third_party", "third-party", "dist", "build", "out",
    "coverage", "__pycache__", "site-packages", "venv", "target", "bower_components", "thirdparty",
}
_DENIED_NAMES = {
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "poetry.lock", "uv.lock", "composer.lock",
    "credentials", "credentials.json", "secrets", "secrets.json", "secrets.yaml", "secrets.yml",
    "id_rsa", "id_ed25519", "id_dsa", "authorized_keys", "known_hosts",
    "token", "token.txt", "tokens.json", "passwords.txt", "passwd", "vendor.js", "vendors.js",
}
_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".rst", ".adoc", ".py", ".js", ".ts", ".tsx", ".jsx",
    ".json", ".yaml", ".yml", ".toml", ".sql", ".r", ".java", ".c", ".cpp", ".h", ".hpp",
    ".cs", ".go", ".rs", ".sh", ".bash", ".rb", ".css", ".html", ".ipynb",
}
_SECRET_PATTERNS = [re.compile(pattern, re.IGNORECASE) for pattern in (
    r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----",
    r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
    r"\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b",
    r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b",
    r"\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret[_-]?key)"
    r"[\"']?\s*[:=]\s*[\"'][^\"'\r\n]{8,}[\"']",
    r"\bBearer\s+[A-Za-z0-9_.~+/-]{20,}",
    r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s/@:]+:[^\s/@]+@",
    r"\bhttps?://[^\s/@:]+:[^\s/@]+@",
)]


def validate_selected_path(path: str, limits: ImportLimits) -> None:
    parts = path.split("/")  # The shared request contract already rejects traversal/URL syntax.
    lowered = [part.lower() for part in parts]
    name = lowered[-1]
    if len(parts) > limits.max_path_depth:
        raise TooLarge("Selected repository path exceeds the depth limit")
    if (
        any(part.startswith(".") or part in _DENIED_DIRS for part in lowered)
        or name in _DENIED_NAMES or name.startswith(("credentials.", "secrets.", "secret."))
        or name.endswith((".min.js", ".min.css", ".bundle.js", ".map", ".pem", ".key", ".p12", ".pfx"))
        or ("." + name.rsplit(".", 1)[-1] not in _EXTENSIONS
            and name not in {"readme", "license", "licence", "notice", "copying", "authors"})
    ):
        raise InvalidInput("Select an allowed text source outside hidden, credential, vendor and generated paths")


def _sha(value) -> str:
    if not isinstance(value, str) or _SHA.fullmatch(value) is None:
        raise InvalidInput("Repository API returned an invalid Git object identity")
    return value


def _text(raw: bytes) -> str:
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise InvalidInput("Selected files must be UTF-8 text; binaries are not imported") from exc
    if (
        any((ord(char) < 32 and char not in "\t\r\n") or 127 <= ord(char) < 160
            or char in "\u2028\u2029" for char in text)
        or "\r" in text.replace("\r\n", "")
        or text.startswith(("%PDF-", "GIF87a", "GIF89a", "version https://git-lfs.github.com/spec/"))
    ):
        raise InvalidInput("Binary, control-character and ambiguous-line content is not imported")
    if any(pattern.search(text) for pattern in _SECRET_PATTERNS):
        raise InvalidInput("Selected source contains credential-like material; use a reviewed redacted source")
    return text


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _reject_constant(_value):
    raise ValueError("non-finite JSON")


def _finite_float(value):
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("non-finite JSON")
    return result


def _notebook_cells(text: str):
    try:
        value = json.loads(text, object_pairs_hook=_pairs, parse_constant=_reject_constant, parse_float=_finite_float)
        # Bound metadata/outputs nesting too, even though none is retained.
        pending = [(value, 0)]
        while pending:
            item, depth = pending.pop()
            if depth > 32:
                raise ValueError("notebook nesting exceeds limit")
            if isinstance(item, dict):
                pending.extend((child, depth + 1) for child in item.values())
            elif isinstance(item, list):
                pending.extend((child, depth + 1) for child in item)
        if (
            not isinstance(value, dict) or type(value.get("nbformat")) is not int or value["nbformat"] != 4
            or not isinstance(value.get("cells"), list) or not 1 <= len(value["cells"]) <= 256
        ):
            raise ValueError("bounded v4 notebook required")
        return value["cells"]
    except (ValueError, RecursionError) as exc:
        raise InvalidInput("Selected notebook is malformed, unsupported or too deeply nested") from exc


def _segments(path: str, text: str, selection, budget: ImportBudget, *, cell=None):
    text = _text(text.encode("utf-8"))
    lines = text.replace("\r\n", "\n").split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    end = selection.end_line if selection.end_line is not None else len(lines)
    start = selection.start_line
    if end < start or end > len(lines):
        raise InvalidInput("Selected line range is outside the source text")
    if end - start + 1 > budget.limits.max_selected_lines:
        raise TooLarge("Select fewer source lines")
    if not "\n".join(lines[start - 1:end]).strip():
        raise InvalidInput("Selected source text is empty")
    output, buffer, chars, first = [], [], 0, start

    def emit():
        content = "\n".join(buffer)
        if buffer[-1] == "":
            content += "\n"  # Retain a final blank line in splitlines-based evidence counts.
        locator = {"kind": "github", "path": path, "start_line": first, "end_line": first + len(buffer) - 1}
        if cell is not None:
            locator["notebook_cell"] = cell
        identity = json.dumps(locator, sort_keys=True, ensure_ascii=False).encode()
        output.append({
            "id": "github:" + hashlib.sha256(identity).hexdigest(), "locator": locator, "text": content,
            "text_sha256": hashlib.sha256(content.encode()).hexdigest(),
        })

    for line in lines[start - 1:end]:
        budget.check()
        if len(line) > MAX_SEGMENT_CHARS:
            raise TooLarge("A selected source line is too long for precise evidence")
        if buffer and chars + 1 + len(line) + (1 if line == "" else 0) > MAX_SEGMENT_CHARS:
            emit()
            first += len(buffer)
            buffer, chars = [], 0
        chars += len(line) + (1 if buffer else 0)
        buffer.append(line)
    if buffer:
        emit()
    return output


class GithubImporter:
    def __init__(self, client, limits: ImportLimits):
        self.client, self.limits = client, limits

    def fetch(self, request: GithubImportRequest, cancelled: threading.Event | None = None) -> SourceSnapshot:
        budget = ImportBudget(self.limits, cancelled)
        if len(request.files) > self.limits.max_files:
            raise TooLarge("Select fewer repository files")
        for selection in request.files:
            validate_selected_path(selection.path, self.limits)
        origin = request.origin
        prefix = f"/repos/{origin.owner}/{origin.repository}"
        repo = self.client.get_json(prefix, budget=budget)
        if (
            repo.get("private") is not False or repo.get("visibility") != "public"
            or not isinstance(repo.get("full_name"), str)
            or repo["full_name"].casefold() != f"{origin.owner}/{origin.repository}".casefold()
        ):
            raise InvalidInput("Only the explicitly selected public GitHub repository may be imported")
        commit = self.client.get_json(f"{prefix}/git/commits/{origin.commit}", budget=budget)
        if commit.get("sha") != origin.commit or not isinstance(commit.get("tree"), dict):
            raise InvalidInput("Repository commit does not match the pinned version")
        root = _sha(commit["tree"].get("sha"))
        trees, file_records, segments = {}, [], []
        for selection in sorted(request.files, key=lambda item: item.path):
            budget.check()
            current = root
            components = selection.path.split("/")
            for index, component in enumerate(components):
                if current not in trees:
                    tree = self.client.get_json(f"{prefix}/git/trees/{current}", budget=budget)
                    if tree.get("sha") != current or tree.get("truncated") is not False:
                        raise InvalidInput("Repository tree is incomplete or does not match its pinned object")
                    entries = tree.get("tree")
                    if not isinstance(entries, list) or len(entries) > 2000:
                        raise TooLarge("Repository directory exceeds the bounded selection limit")
                    by_name = {}
                    for entry in entries:
                        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
                            raise InvalidInput("Malformed repository tree entry")
                        if entry["path"] in by_name:
                            raise InvalidInput("Ambiguous repository tree entry")
                        by_name[entry["path"]] = entry
                    trees[current] = by_name
                entry = trees[current].get(component)
                if entry is None:
                    raise InvalidInput("Selected source path is absent from the pinned commit")
                current = _sha(entry.get("sha"))
                final = index == len(components) - 1
                if final:
                    if entry.get("mode") not in ("100644", "100755") or entry.get("type") != "blob":
                        raise InvalidInput("Only regular source files are allowed; no symlinks or submodules")
                elif entry.get("mode") != "040000" or entry.get("type") != "tree":
                    raise InvalidInput("Selected path crosses a symlink, submodule or non-directory")
            size = entry.get("size")
            if type(size) is not int or size <= 0:
                raise InvalidInput("Selected file is empty or lacks a valid byte size")
            budget.consume_file(size)
            blob = self.client.get_json(f"{prefix}/git/blobs/{current}", budget=budget)
            if (
                blob.get("sha") != current or type(blob.get("size")) is not int
                or blob["size"] != size or blob.get("encoding") != "base64"
            ):
                raise InvalidInput("Repository blob metadata does not match the selected file")
            content = blob.get("content")
            if not isinstance(content, str) or len(content) > (size + 2) // 3 * 4 + size // 40 + 4:
                raise TooLarge("Repository blob encoding exceeds the byte limit")
            try:
                raw = base64.b64decode(content.replace("\n", "").replace("\r", ""), validate=True)
            except (ValueError, binascii.Error) as exc:
                raise InvalidInput("Repository blob has invalid base64 text") from exc
            if len(raw) != size or hashlib.sha1(
                f"blob {len(raw)}\0".encode() + raw, usedforsecurity=False,
            ).hexdigest() != current:
                raise InvalidInput("Repository blob bytes do not match their pinned Git identity")
            text = _text(raw)
            file_records.append(GithubFileProvenance(
                path=selection.path, git_blob_sha=current, raw_sha256=hashlib.sha256(raw).hexdigest(), byte_count=size,
            ))
            if isinstance(selection, NotebookFileSelection):
                cells = _notebook_cells(text)
                for selected in sorted(selection.cells, key=lambda item: item.index):
                    if selected.index >= len(cells):
                        raise InvalidInput("Selected notebook cell is outside the notebook")
                    cell = cells[selected.index]
                    if not isinstance(cell, dict) or cell.get("cell_type") not in ("markdown", "code"):
                        raise InvalidInput("Only markdown and code cell source text may be selected")
                    source = cell.get("source")
                    if isinstance(source, list) and all(isinstance(part, str) for part in source):
                        source = "".join(source)
                    if not isinstance(source, str):
                        raise InvalidInput("Selected notebook cell has malformed source text")
                    try:
                        segments.extend(_segments(selection.path, source, selected, budget, cell={
                            "index": selected.index, "cell_type": cell["cell_type"],
                        }))
                    except UnicodeEncodeError as exc:
                        raise InvalidInput("Notebook source must contain valid UTF-8 text") from exc
            else:
                segments.extend(_segments(selection.path, text, selection, budget))
        budget.check()
        try:
            return SourceSnapshot.model_validate({
                "title": f"{origin.owner}/{origin.repository}@{origin.commit[:12]}", "origin": origin,
                "provenance": {
                    "adapter": "github_selected_text", "parser_name": PARSER_NAME, "parser_version": PARSER_VERSION,
                    "rights": {"status": "user_declared", "statement": request.rights_statement},
                    "repository_files": file_records,
                },
                "segments": segments,
            })
        except ValidationError as exc:
            raise TooLarge("Selected source cannot fit the bounded evidence snapshot; choose less text") from exc
