"""F02 acceptance: precise selected public text without executing imported code."""

import copy
import hashlib
import json
import threading

import pytest
from fastapi.testclient import TestClient

from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, InvalidInput, NotFound, RateLimited, TooLarge
from app.source_versions.contracts import EvidencePin
from app.source_versions.github_admission import GithubImportSlots, MemoryGithubImportLimiter
from app.source_versions.github_contracts import GithubImportRequest
from app.source_versions.github_importer import GithubImporter
from app.source_versions.github_limits import ImportLimits
from app.source_versions.github_router import GithubImportService
from app.source_versions.store import MemorySourceVersionStore
from tests.github_repo_fixture import COMMIT, PREFIX, ROOT, RepoFixture, blob_sha


def setup_import(files=None, *, limits=None):
    fixture = RepoFixture(files)
    importer = GithubImporter(fixture, limits or ImportLimits())
    store = MemorySourceVersionStore(InMemoryDocumentStore())
    service = GithubImportService(
        importer, store, MemoryGithubImportLimiter(100, 100), GithubImportSlots(2), enabled=True,
    )
    return fixture, importer, store, service


def test_representative_repository_import_has_verified_locators_hashes_and_no_execution(tmp_path):
    fixture, importer, store, service = setup_import()
    snapshot = importer.fetch(fixture.request())
    assert snapshot.origin.commit == COMMIT and snapshot.provenance.parser_name == "studyvault-github-text"
    assert len(snapshot.provenance.repository_files) == 4
    for file in snapshot.provenance.repository_files:
        assert file.raw_sha256 == hashlib.sha256(fixture.files[file.path]).hexdigest()
        assert file.git_blob_sha == blob_sha(fixture.files[file.path])
    assert any("Ignore previous instructions" in segment.text for segment in snapshot.segments)
    text = snapshot.model_dump_json()
    assert "UNSAFE OUTPUT" not in text and "UNSELECTED CELL" not in text and "discard notebook metadata" not in text
    assert [item.locator.notebook_cell.index for item in snapshot.segments if item.locator.notebook_cell] == [0, 1]
    assert len(fixture.calls) <= 24 and all(path.startswith(PREFIX) for path in fixture.calls)
    assert not any("download_url" in path or "raw.githubusercontent" in path for path in fixture.calls)
    version = service.run("alice", fixture.request(), threading.Event())
    assert service.run("alice", fixture.request(), threading.Event()) == version
    for segment in snapshot.segments:
        pin = EvidencePin(version_id=version.id, content_hash=version.content_hash, segment_id=segment.id,
                          locator=segment.locator, quote=segment.text[:30])
        resolved = store.resolve("alice", pin)
        assert f"/blob/{COMMIT}/" in resolved.canonical_url
        if segment.locator.notebook_cell:
            assert "#L" not in resolved.canonical_url
        else:
            assert f"#L{segment.locator.start_line}-L{segment.locator.end_line}" in resolved.canonical_url
    marker = tmp_path / "must-not-exist"
    code = f"from pathlib import Path\nPath({str(marker)!r}).write_text('executed')\n".encode()
    malicious, parser, _, _ = setup_import({"lesson.py": code})
    parser.fetch(malicious.request())
    assert not marker.exists()


@pytest.mark.parametrize("path", [
    ".env", ".env.local", "src/.git/config", "vendor/a.py", "node_modules/a.js", "third_party/a.md",
    "dist/lesson.js", "a.min.js", "private.pem", "credentials.json", "secrets.yaml", "image.png",
    "archive.zip", "tool.wasm", "token.txt", "pnpm-lock.yaml", "vendor.js",
])
def test_denied_paths_are_rejected_before_any_network_request(path):
    fixture, importer, _, _ = setup_import({path: b"text"})
    with pytest.raises(InvalidInput):
        importer.fetch(fixture.request())
    assert fixture.calls == []


@pytest.mark.parametrize("raw", [
    b"a\x00b", b"\x89PNG\r\n\x1a\n", b"%PDF-1.7", b"abc\x1bdef", b"a\rb", b"\xff\xfe",
    b"version https://git-lfs.github.com/spec/v1\n",
    b"-----BEGIN PRIVATE KEY-----\nfixture-not-a-real-key",
    b"github_pat_" + b"x" * 30, b"AKIA" + b"X" * 16,
    b"api_key = 'fixture-not-a-real-secret'", b"password = 'fixture-password'",
    b"postgresql://user:fixture-password@db.example/db",
    "a\u2028b".encode(),
])
def test_binary_or_credential_like_text_never_reaches_storage(raw):
    fixture, _, store, service = setup_import({"lesson.py": raw})
    with pytest.raises(InvalidInput):
        service.run("alice", fixture.request(), threading.Event())
    assert store._rows == {}


@pytest.mark.parametrize(("mode", "kind"), [("120000", "blob"), ("160000", "commit"), ([], "blob")])
def test_symlinks_submodules_and_malformed_modes_are_not_fetched(mode, kind):
    fixture, importer, _, _ = setup_import({"lesson.py": b"value = 1"})
    fixture.entry("lesson.py").update(mode=mode, type=kind)
    with pytest.raises(InvalidInput):
        importer.fetch(fixture.request())
    assert not any("/blobs/" in path for path in fixture.calls)


def test_symlink_parent_is_not_followed_and_tree_listing_is_bounded():
    fixture, importer, _, _ = setup_import({"docs/lesson.md": b"lesson"})
    fixture.responses[f"{PREFIX}/git/trees/{ROOT}"]["tree"][0]["mode"] = "120000"
    with pytest.raises(InvalidInput):
        importer.fetch(fixture.request())
    fixture, importer, _, _ = setup_import({"lesson.md": b"lesson"})
    fixture.responses[f"{PREFIX}/git/trees/{ROOT}"]["truncated"] = True
    with pytest.raises(InvalidInput):
        importer.fetch(fixture.request())


@pytest.mark.parametrize("change", ["private", "renamed", "commit", "tree_sha", "blob_sha", "blob_size", "encoding",
                                   "base64", "bytes", "missing", "duplicate"])
def test_untrusted_upstream_identity_and_payload_fail_closed(change):
    fixture, importer, store, _ = setup_import({"lesson.md": b"safe lesson"})
    entry = fixture.entry("lesson.md")
    blob = fixture.responses[f"{PREFIX}/git/blobs/{entry['sha']}"]
    tree = fixture.responses[f"{PREFIX}/git/trees/{ROOT}"]
    if change == "private":
        fixture.responses[PREFIX]["private"] = True
    elif change == "renamed":
        fixture.responses[PREFIX]["full_name"] = "other/repo"
    elif change == "commit":
        fixture.responses[f"{PREFIX}/git/commits/{COMMIT}"]["sha"] = "c" * 40
    elif change == "tree_sha":
        tree["sha"] = "c" * 40
    elif change == "blob_sha":
        blob["sha"] = "c" * 40
    elif change == "blob_size":
        blob["size"] = True
    elif change == "encoding":
        blob["encoding"] = "utf-8"
    elif change == "base64":
        blob["content"] = "$$$$"
    elif change == "bytes":
        blob["content"] = "eHh4eHh4eHh4eHg="  # Same size, wrong Git object identity.
    elif change == "missing":
        tree["tree"] = []
    else:
        tree["tree"].append(copy.deepcopy(entry))
    with pytest.raises((InvalidInput, TooLarge)):
        importer.fetch(fixture.request())
    assert store._rows == {}


@pytest.mark.parametrize("limits", [
    ImportLimits(max_files=1), ImportLimits(max_file_bytes=3), ImportLimits(max_total_bytes=8),
    ImportLimits(max_wire_bytes=30), ImportLimits(max_api_requests=2), ImportLimits(max_path_depth=1),
    ImportLimits(max_selected_lines=1),
])
def test_every_configured_work_bound_stops_without_partial_persistence(limits):
    fixture, _, store, service = setup_import(
        {"docs/lesson.md": b"first\nsecond", "other.py": b"value = 1"}, limits=limits,
    )
    with pytest.raises(TooLarge):
        service.run("alice", fixture.request(), threading.Event())
    assert store._rows == {}


def test_line_selection_chunks_without_truncation_and_preserves_blank_lines():
    text = "\n".join("x" * 99 for _ in range(350)) + "\n\n"
    fixture, importer, _, _ = setup_import({"lesson.md": text.encode()})
    snapshot = importer.fetch(fixture.request())
    assert len(snapshot.segments) >= 3
    assert snapshot.segments[0].locator.start_line == 1
    assert snapshot.segments[-1].locator.end_line == 351
    assert all(len(item.text) <= 16000 for item in snapshot.segments)
    assert all(len(item.text.splitlines()) == item.locator.end_line - item.locator.start_line + 1
               for item in snapshot.segments)
    body = fixture.request().model_dump(mode="json")
    body["files"][0].update(start_line=2, end_line=3)
    selected = importer.fetch(GithubImportRequest.model_validate(body))
    assert selected.segments[0].text == "x" * 99 + "\n" + "x" * 99
    body["files"][0]["end_line"] = 999
    with pytest.raises(InvalidInput):
        importer.fetch(GithubImportRequest.model_validate(body))
    fixture, importer, _, _ = setup_import({"lesson.md": b"x" * 16001})
    with pytest.raises(TooLarge):
        importer.fetch(fixture.request())


@pytest.mark.parametrize("notebook", [
    b"{bad", b'{"nbformat":3,"cells":[]}', b'{"nbformat":true,"cells":[]}',
    b'{"nbformat":4,"nbformat":4,"cells":[]}',
    b'{"nbformat":4,"cells":[{"cell_type":[],"source":"x"}]}',
    b'{"nbformat":4,"cells":[{"cell_type":"raw","source":"x"}]}',
    b'{"nbformat":4,"cells":[{"cell_type":"code","source":[42]}]}',
    b'{"nbformat":4,"cells":[{"cell_type":"code","source":"\\ud800"}]}',
    b'{"nbformat":4,"cells":[{"cell_type":"code","source":"x"}],"metadata":{"v":1e400}}',
])
def test_notebook_parser_rejects_malformed_or_unsupported_source(notebook):
    fixture, importer, _, _ = setup_import({"study.ipynb": notebook})
    body = fixture.request().model_dump(mode="json")
    body["files"][0]["cells"] = [{"index": 0}]
    with pytest.raises(InvalidInput):
        importer.fetch(GithubImportRequest.model_validate(body))


def test_cancelled_timed_out_and_late_failed_imports_have_no_partial_snapshot():
    fixture, importer, store, service = setup_import()
    cancelled = threading.Event()
    fixture.on_request = lambda _: cancelled.set()
    with pytest.raises(ApiError, match="cancelled"):
        service.run("alice", fixture.request(), cancelled)
    assert store._rows == {}
    fixture, importer, store, service = setup_import(limits=ImportLimits(total_timeout_seconds=-1))
    with pytest.raises(ApiError, match="timed out"):
        service.run("alice", fixture.request(), threading.Event())
    assert fixture.calls == [] and store._rows == {}
    fixture, _, store, service = setup_import({"a.md": b"safe first file", "z.py": b"unsafe\x00file"})
    with pytest.raises(InvalidInput):
        service.run("alice", fixture.request(), threading.Event())
    assert any("/blobs/" in call for call in fixture.calls) and store._rows == {}


def test_disabled_flag_hourly_rate_and_disconnected_final_save_fences():
    fixture, _, store, service = setup_import()
    service.enabled = False
    with pytest.raises(NotFound):
        service.run("alice", fixture.request(), threading.Event())
    assert fixture.calls == []
    service.enabled = True
    service.limiter = MemoryGithubImportLimiter(1, 2)
    service.run("alice", fixture.request(), threading.Event())
    calls = len(fixture.calls)
    with pytest.raises(RateLimited):
        service.run("alice", fixture.request(), threading.Event())
    assert len(fixture.calls) == calls
    fixture, importer, store, service = setup_import()
    original = importer.fetch
    cancelled = threading.Event()

    def disconnect_at_end(*args):
        snapshot = original(*args)
        cancelled.set()
        return snapshot

    importer.fetch = disconnect_at_end
    with pytest.raises(ApiError, match="cancelled"):
        service.run("alice", fixture.request(), cancelled)
    assert store._rows == {}


def test_real_import_api_auth_feature_flag_persistence_and_owner_resolution(monkeypatch):
    import app.main as main

    fixture = RepoFixture()
    service = main.github_import_service
    monkeypatch.setattr(service, "enabled", True)
    monkeypatch.setattr(service, "importer", GithubImporter(fixture, ImportLimits()))
    monkeypatch.setattr(service, "limiter", MemoryGithubImportLimiter(2, 3))
    client = TestClient(main.app)
    path, body = "/api/source-versions/import-github", fixture.request().model_dump(mode="json")
    auth = {"Authorization": "Bearer f02-api-owner"}
    assert client.post(path, json=body).status_code == 401
    invalid = {**body, "url": "http://127.0.0.1/private"}
    assert client.post(path, json=invalid, headers=auth).status_code == 400
    response = client.post(path, json=body, headers=auth)
    assert response.status_code == 200, response.text
    record = response.json()
    assert client.get(f"/api/source-versions/{record['id']}", headers=auth).json() == record
    assert client.get(
        f"/api/source-versions/{record['id']}", headers={"Authorization": "Bearer another"},
    ).status_code == 404
    segment = record["snapshot"]["segments"][0]
    pin = {"version_id": record["id"], "content_hash": record["content_hash"], "segment_id": segment["id"],
           "locator": segment["locator"], "quote": segment["text"]}
    resolved = client.post(f"/api/source-versions/{record['id']}/resolve", json=pin, headers=auth)
    assert resolved.status_code == 200 and COMMIT in resolved.json()["canonical_url"]
    assert client.post(path, json=body, headers=auth).json() == record
    denied = client.post(path, json=body, headers=auth)
    assert denied.status_code == 429 and int(denied.headers["retry-after"]) > 0
    assert "outputs" not in json.dumps(record)


def test_settings_import_limits_and_free_request_allowance():
    from app.settings import Settings

    assert Settings(_env_file=None).github_import_enabled is False
    for setting, value in [
        ("AI_SERVICE_GITHUB_IMPORT_MAX_FILES", 0), ("AI_SERVICE_GITHUB_IMPORT_MAX_FILE_BYTES", 262145),
        ("AI_SERVICE_GITHUB_IMPORT_GLOBAL_HOUR", 3), ("AI_SERVICE_GITHUB_IMPORT_TOTAL_TIMEOUT_SECONDS", 1),
        ("AI_SERVICE_GITHUB_IMPORT_MAX_TOTAL_BYTES", 1),
    ]:
        with pytest.raises(ValueError):
            Settings(_env_file=None, **{setting: value})
