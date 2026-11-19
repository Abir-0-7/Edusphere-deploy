"""Exact version/locator acceptance and regression coverage for the F01 bridge."""

import copy
import hashlib
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.documents.store import ChapterRecord, ChunkRecord, InMemoryDocumentStore
from app.errors import Conflict, InvalidInput, NotFound
from app.source_versions.contracts import EvidencePin, PdfSnapshotRequest, SourceSnapshot, SourceVersion
from app.source_versions.service import pdf_snapshot
from app.source_versions.store import MemorySourceVersionStore


def fixture_pdf(owner="source-version-owner"):
    documents = InMemoryDocumentStore()
    document = documents.create(user_id=owner, filename="Book.pdf", mime_type="application/pdf", size_bytes=20)
    documents.mark_parsed(document.id, markdown="Source passage.", page_count=5)
    chapter_id, chunk_id = str(uuid4()), str(uuid4())
    document.chapters = [ChapterRecord(chapter_id, document.id, owner, "Light", 0, 3, 3)]
    document.chunks = [ChunkRecord(chunk_id, document.id, owner, chapter_id, "Light carries energy. বাংলা", 3, 0)]
    return documents, document


def pin_for(version):
    segment = version.snapshot.segments[0]
    return EvidencePin(
        version_id=version.id, content_hash=version.content_hash, segment_id=segment.id,
        locator=segment.locator, quote=segment.text,
    )


def repo_data():
    text = "# Selected docs\nNo imported code runs."
    return {
        "title": "Pinned docs",
        "origin": {"kind": "github", "owner": "example", "repository": "course", "commit": "a" * 40},
        "provenance": {
            "adapter": "github_selected_text", "parser_name": "fixture", "parser_version": "1",
            "original_sha256": hashlib.sha256(text.encode()).hexdigest(),
            "rights": {"status": "public_license", "statement": "MIT (fixture declaration)"},
        },
        "segments": [{
            "id": "readme-1",
            "locator": {"kind": "github", "path": "docs/hello world.md", "start_line": 8, "end_line": 9},
            "text": text, "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
        }],
    }


def test_pdf_snapshot_replay_edition_printed_labels_and_immutable_evidence():
    documents, document = fixture_pdf()
    before = copy.deepcopy(document)
    store = MemorySourceVersionStore(documents)
    snapshot = pdf_snapshot(document, PdfSnapshotRequest(
        book_title="Physics", edition="2", printed_page_labels={"3": "iv"}, rights_statement="I may use this text.",
    ))
    first = store.save(document.user_id, snapshot)
    assert store.save(document.user_id, snapshot) == first
    assert first.snapshot.provenance.parser_name is None
    assert first.snapshot.provenance.parser_version is None
    assert first.snapshot.provenance.original_sha256 is None
    assert first.snapshot.segments[0].locator.pdf_page_index == 3
    assert first.snapshot.segments[0].locator.printed_page_label == "iv"
    assert document == before  # No old chapter/chunk/SM-2 structures were rewritten.
    old_pin = pin_for(first)
    document.chunks[0].content = "A new extraction."
    assert store.resolve(document.user_id, old_pin).content == before.chunks[0].content
    second = store.save(document.user_id, pdf_snapshot(document, PdfSnapshotRequest(edition="3")))
    assert first.id != second.id and first.content_hash != second.content_hash
    first.snapshot.segments[0].text = "Caller mutation"
    assert store.resolve(document.user_id, old_pin).content == before.chunks[0].content


def test_version_hash_covers_provenance_rights_edition_and_locator():
    data = repo_data()
    original = SourceSnapshot.model_validate(data)
    for keys, value in [
        (("provenance", "parser_version"), "2"),
        (("provenance", "rights", "statement"), "BSD fixture"),
        (("origin", "commit"), "b" * 40),
    ]:
        changed = copy.deepcopy(data)
        target = changed
        for key in keys[:-1]:
            target = target[key]
        target[keys[-1]] = value
        assert SourceSnapshot.model_validate(changed).content_hash() != original.content_hash()
    documents, document = fixture_pdf()
    assert pdf_snapshot(document, PdfSnapshotRequest(edition="1")).content_hash() != pdf_snapshot(
        document, PdfSnapshotRequest(edition="2"),
    ).content_hash()


@pytest.mark.parametrize("change,exception", [
    ({"content_hash": "b" * 64}, Conflict),
    ({"version_id": str(uuid4())}, NotFound),
    ({"segment_id": "missing"}, InvalidInput),
    ({"quote": "made up"}, InvalidInput),
    ({"quote": " "}, InvalidInput),
])
def test_wrong_pin_fails_closed(change, exception):
    documents, document = fixture_pdf()
    store = MemorySourceVersionStore(documents)
    version = store.save(document.user_id, pdf_snapshot(document, PdfSnapshotRequest()))
    pin = EvidencePin.model_validate({**pin_for(version).model_dump(mode="json"), **change})
    with pytest.raises(exception):
        store.resolve(document.user_id, pin)


def test_owner_locator_deletion_and_source_change_guards():
    documents, document = fixture_pdf()
    store = MemorySourceVersionStore(documents)
    snapshot = pdf_snapshot(document, PdfSnapshotRequest())
    version = store.save(document.user_id, snapshot)
    pin = pin_for(version)
    with pytest.raises(NotFound):
        store.resolve("another-owner", pin)
    with pytest.raises(NotFound):
        store.save("another-owner", snapshot)
    changed = pin.model_dump(mode="json")
    changed["locator"]["pdf_page_index"] = 4
    with pytest.raises(InvalidInput):
        store.resolve(document.user_id, EvidencePin.model_validate(changed))
    document.chunks[0].content = "Source changed during request."
    with pytest.raises(Conflict):
        store.save(document.user_id, snapshot)
    documents._docs.pop(document.id)
    assert store.get(document.user_id, str(version.id)) is None
    with pytest.raises(NotFound):
        store.resolve(document.user_id, pin)


def test_precise_repo_link_is_constructed_from_a_full_commit_and_safe_path():
    documents, _ = fixture_pdf()
    store = MemorySourceVersionStore(documents)
    version = store.save("repo-owner", SourceSnapshot.model_validate(repo_data()))
    result = store.resolve("repo-owner", pin_for(version))
    assert result.canonical_url == (
        f"https://github.com/example/course/blob/{'a' * 40}/docs/hello%20world.md#L8-L9"
    )
    assert result.source_version_url == f"/api/source-versions/{version.id}"
    assert result.content == repo_data()["segments"][0]["text"]


@pytest.mark.parametrize("path", [
    "../secret", "/etc/passwd", "a//b", "a/./b", "a/../b", "a\\b", "a%2fb", "https://evil.test/a",
    "a#frag", "a?q", "a\x00b", "a\nb", ".", "..",
])
def test_repo_paths_never_interpret_user_input_as_a_url_or_traversal(path):
    data = repo_data()
    data["segments"][0]["locator"]["path"] = path
    with pytest.raises(ValidationError):
        SourceSnapshot.model_validate(data)


@pytest.mark.parametrize("change", [
    {"commit": "main"}, {"owner": "evil.test/redirect"}, {"repository": ".."}, {"commit": "A" * 40},
])
def test_repo_identity_requires_an_exact_pin(change):
    data = repo_data()
    data["origin"].update(change)
    with pytest.raises(ValidationError):
        SourceSnapshot.model_validate(data)


def test_invalid_hash_duplicate_mixed_kind_and_payload_bounds():
    original = repo_data()
    variants = []
    data = copy.deepcopy(original)
    data["segments"][0]["text_sha256"] = "b" * 64
    variants.append(data)
    data = copy.deepcopy(original)
    data["segments"].append(copy.deepcopy(data["segments"][0]))
    variants.append(data)
    data = copy.deepcopy(original)
    data["segments"][0]["locator"]["end_line"] = 10
    variants.append(data)
    data = copy.deepcopy(original)
    data["segments"] *= 2001
    variants.append(data)
    data = copy.deepcopy(original)
    segment = data["segments"][0]
    segment["text"] = "界" * 16000
    segment["text_sha256"] = hashlib.sha256(segment["text"].encode()).hexdigest()
    segment["locator"]["end_line"] = 8
    data["segments"] = [{**copy.deepcopy(segment), "id": f"part{i}"} for i in range(45)]
    variants.append(data)
    for invalid in variants:
        with pytest.raises(ValidationError):
            SourceSnapshot.model_validate(invalid)
    documents, document = fixture_pdf()
    document.chunks[0].page = 6
    with pytest.raises(InvalidInput):
        pdf_snapshot(document, PdfSnapshotRequest())


def test_quota_is_owner_scoped_and_replay_does_not_consume_another_slot():
    documents, document = fixture_pdf()
    store = MemorySourceVersionStore(documents, max_versions_per_user=1)
    snapshot = pdf_snapshot(document, PdfSnapshotRequest())
    first = store.save(document.user_id, snapshot)
    assert store.save(document.user_id, snapshot) == first
    with pytest.raises(InvalidInput, match="limit"):
        store.save(document.user_id, pdf_snapshot(document, PdfSnapshotRequest(edition="new")))
    assert store.save("other", SourceSnapshot.model_validate(repo_data()))


def test_real_api_snapshot_resolve_auth_error_shapes_and_no_repository_import():
    from app.main import app, documents

    owner = f"source-http-{uuid4()}"
    fixture_documents, document = fixture_pdf(owner)
    documents._docs[document.id] = fixture_documents._docs[document.id]
    client = TestClient(app)
    url = f"/api/documents/{document.id}/source-versions"
    auth = {"Authorization": f"Bearer {owner}"}
    try:
        assert client.post(url, json={}).status_code == 401
        assert client.post(url, json={}, headers={"Authorization": "Bearer other-owner"}).status_code == 404
        response = client.post(url, json={"printed_page_labels": {"3": "iv"}}, headers=auth)
        assert response.status_code == 200, response.text
        version = SourceVersion.model_validate(response.json())
        pin = pin_for(version)
        resolved = client.post(
            f"/api/source-versions/{version.id}/resolve", json=pin.model_dump(mode="json"), headers=auth,
        )
        assert resolved.status_code == 200 and resolved.json()["pin"]["locator"]["printed_page_label"] == "iv"
        assert "user_id" not in response.json() and resolved.json()["canonical_url"] is None
        assert client.get(f"/api/source-versions/{version.id}", headers=auth).json() == response.json()
        assert client.post(url, json={"printed_page_labels": {"0": "x"}}, headers=auth).status_code == 400
        assert client.post(url, json={"origin": repo_data()["origin"]}, headers=auth).status_code == 400
        bad = {**pin.model_dump(mode="json"), "content_hash": "c" * 64}
        mismatch = client.post(f"/api/source-versions/{version.id}/resolve", json=bad, headers=auth)
        assert mismatch.status_code == 409 and mismatch.json()["error"]["code"] == "conflict"
        assert "Light carries" not in json.dumps(mismatch.json())
    finally:
        documents._docs.pop(document.id, None)


def test_source_versions_are_in_account_export_registry():
    from app.privacy import _OWNED_TABLES

    columns = dict(_OWNED_TABLES)["source_versions"]
    assert {"id", "document_id", "content_hash", "snapshot", "created_at"} <= set(columns)
