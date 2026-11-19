"""F07 local notes and file import against the real request and evidence routes."""

import asyncio
import base64
import hashlib
import io
import json
import threading
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient

from app.course_outlines.router import course_outline_router
from app.course_outlines.store import MemoryOutlineStore
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, NotFound, api_error_handler
from app.source_refresh.impact import compare_segments
from app.source_versions.local_text import MAX_REQUEST_BYTES, MAX_TEXT_BYTES, PastedNotesRequest
from app.source_versions.local_text_router import local_text_router
from app.source_versions.router import source_version_router
from app.source_versions.store import MemorySourceVersionStore

PATH = "/api/source-versions/import-text"
BASE = {"title": "My workshop notes", "rights_statement": "I authored these notes for private study."}


def fixtures(enabled=True):
    app = FastAPI()
    docs = InMemoryDocumentStore()
    versions = MemorySourceVersionStore(docs)
    app.add_exception_handler(ApiError, api_error_handler)

    def user(x_owner: str | None = Header(None)):
        if x_owner is None:
            raise ApiError("Sign in required", status_code=401)
        return x_owner

    app.include_router(local_text_router(user, versions, enabled=enabled))
    app.include_router(source_version_router(user, versions, docs))
    app.include_router(course_outline_router(user, MemoryOutlineStore(versions), versions, enabled=True))
    return app, versions


def file_import(raw):
    return {
        **BASE, "format": "txt", "filename": "notes.txt", "media_type": "text/plain",
        "content_base64": base64.b64encode(raw).decode(),
    }


def epub_bytes(*, members=None, compression=ZIP_DEFLATED):
    files = {
        "mimetype": b"application/epub+zip",
        "META-INF/container.xml": (
            b'<container><rootfiles><rootfile full-path="Book/package.opf"/></rootfiles></container>'
        ),
        "Book/package.opf": (
            b'<package version="3.0"><manifest><item id="first" href="first.xhtml" '
            b'media-type="application/xhtml+xml"/><item id="second" href="second.xhtml" '
            b'media-type="application/xhtml+xml"/></manifest><spine><itemref idref="second"/>'
            b'<itemref idref="first"/></spine></package>'
        ),
        "Book/first.xhtml": b"<html><body><p>Final section.</p></body></html>",
        "Book/second.xhtml": markup_bytes(),
    }
    files.update(members or {})
    buffer = io.BytesIO()
    with ZipFile(buffer, "w", compression=compression) as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    return buffer.getvalue()


def markup_bytes():
    return (
        "<html><head><script>DO NOT RETAIN</script></head><body><h1>Lecture</h1>"
        "<p>Energy <strong>is</strong> conserved.</p>"
        "<pre>def double(x):\n    return x * 2\n</pre>"
        "<table><tr><th>Label</th><th>Value</th></tr><tr><td>Sample</td><td>4</td></tr></table>"
        '<script src="https://private.invalid/ignore">DO NOT RETAIN</script>'
        '<img src="http://127.0.0.1/no-request"><p>বাংলা</p></body></html>'
    ).encode()


def _document_import(raw, format):
    body = file_import(raw)
    return {**body, "format": format, "filename": f"book.{format}",
            "media_type": {"html": "text/html", "epub": "application/epub+zip"}[format]}


@pytest.mark.parametrize("format", ["html", "epub"])
def test_offline_markup_preserves_basic_code_tables_and_reports_extraction_uncertainty(format, monkeypatch):
    import socket

    app, versions = fixtures()
    raw = markup_bytes() if format == "html" else epub_bytes()
    with TestClient(app, headers={"x-owner": "alice"}) as http:
        monkeypatch.setattr(
            socket.socket, "connect", lambda *args: pytest.fail("source import attempted network access"),
        )
        response = http.post(PATH, json=_document_import(raw, format))
        assert response.status_code == 200, response.text
        snapshot = response.json()["snapshot"]
        extracted = "".join(segment["text"] for segment in snapshot["segments"])
        assert "Energy is conserved." in extracted
        assert "def double(x):\n    return x * 2" in extracted
        assert "| Label | Value |\n| Sample | 4 |" in extracted
        assert "বাংলা" in extracted and "DO NOT RETAIN" not in extracted
        assert "127.0.0.1" not in extracted and "private.invalid" not in extracted
        assert len(snapshot["provenance"]["extraction_notes"]) == 2
        if format == "epub":
            assert extracted.index("Lecture") < extracted.index("Final section.")
    assert versions.list_summaries("alice", limit=20, offset=0)[1] == 1


@pytest.mark.parametrize("mutations", [
    {"../../escape": b"bad"},
    {"META-INF/encryption.xml": b"encrypted"},
    {"Book/package.opf": b'<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><package/>'},
    {"Book/package.opf": b'<package version="3.0"><manifest/></package>'},
    {"Book/package.opf": b'\xff'},
    {"padding.bin": b"a" * (128 * 1024 + 1)},
    {f"extra-{index}": b"a" for index in range(65)},
    {"Book/first.xhtml": b"malformed" * 16000},
])
def test_hostile_epub_is_rejected_without_partial_snapshot(mutations):
    app, versions = fixtures()
    with TestClient(app, headers={"x-owner": "alice"}) as http:
        response = http.post(PATH, json=_document_import(epub_bytes(members=mutations), "epub"))
        assert response.status_code in {400, 413}, response.text
    assert versions.list_summaries("alice", limit=20, offset=0) == ([], 0)


def test_text_file_preserves_unicode_indentation_table_syntax_and_line_links():
    app, _ = fixtures()
    content = "বইয়ের নোট\n\ndef double(x):\n    return x * 2\n\n| Label | Value |\n| --- | ---: |\n| Sample | 4 |\n"
    raw = b"\xef\xbb\xbf" + content.replace("\n", "\r\n").encode()
    with TestClient(app, headers={"x-owner": "alice"}) as http:
        response = http.post(PATH, json=file_import(raw))
        assert response.status_code == 200, response.text
        version = response.json()
        assert http.post(PATH, json=file_import(raw)).json() == version
        snapshot = version["snapshot"]
        assert snapshot["origin"] == {"kind": "text", "format": "txt", "line_count": 8}
        assert snapshot["provenance"]["original_sha256"] == hashlib.sha256(raw).hexdigest()
        assert snapshot["provenance"]["rights"] == {"status": "user_declared", "statement": BASE["rights_statement"]}
        segment, = snapshot["segments"]
        assert segment["text"] == content
        assert segment["locator"] == {"kind": "text", "start_line": 1, "end_line": 8}
        assert segment["text_sha256"] == hashlib.sha256(content.encode()).hexdigest()
        path = f"/api/source-versions/{version['id']}"
        pin = {
            "version_id": version["id"], "content_hash": version["content_hash"],
            "segment_id": segment["id"], "locator": segment["locator"], "quote": "    return x * 2",
        }
        resolved = http.post(path + "/resolve", json=pin)
        assert resolved.status_code == 200 and resolved.json()["canonical_url"] is None
        assert http.get(path, headers={"x-owner": "bob"}).status_code == 404
        assert http.get("/api/source-versions").json()["items"][0]["kind"] == "text"
        assert http.get("/api/source-versions", headers={"x-owner": "bob"}).json()["total_count"] == 0


def test_new_pasted_version_keeps_old_evidence_and_flags_exact_changed_segment():
    app, versions = fixtures()
    with TestClient(app, headers={"x-owner": "alice"}) as http:
        before = http.post(PATH, json={**BASE, "format": "notes", "text": "Original notes\nSecond line."}).json()
        after = http.post(PATH, json={**BASE, "format": "notes", "text": "Different note\nSecond line."}).json()
        assert before["id"] != after["id"]
    old = versions.get("alice", before["id"])
    new = versions.get("alice", after["id"])
    changes, counts = compare_segments(old, new)
    assert counts.changed == 1 and changes[0].old_excerpt.startswith("Original notes")
    assert changes[0].old_locator.end_line == changes[0].new_locator.end_line == 2
    with pytest.raises(NotFound):
        from app.source_versions.contracts import EvidencePin

        segment = old.snapshot.segments[0]
        versions.resolve("bob", EvidencePin(
            version_id=old.id, content_hash=old.content_hash, segment_id=segment.id,
            locator=segment.locator, quote="Original notes",
        ))


@pytest.mark.parametrize(("patch", "status"), [
    ({"rights_statement": "  "}, 400),
    ({"format": "notes", "text": "first\x00second"}, 400),
    ({"format": "notes", "text": "first\u2028second"}, 400),
    ({"format": "notes", "text": "  \n "}, 400),
    ({"format": "notes", "text": "x" * 8001}, 413),
    ({"format": "notes", "text": "x\n" * 2001}, 413),
    ({"format": "notes", "text": "∑" * (MAX_TEXT_BYTES // 2)}, 413),
    ({"filename": "notes.epub"}, 400),
    ({"filename": "../notes.txt"}, 400),
    ({"media_type": "application/pdf"}, 400),
    ({"content_base64": "F.$$"}, 400),
    ({"content_base64": "/w=="}, 400),
])
def test_bad_format_type_rights_and_size_do_not_create_a_source(patch, status):
    app, versions = fixtures()
    with TestClient(app, headers={"x-owner": "alice"}) as http:
        body = {**file_import(b"Title\nContent."), **patch}
        if patch.get("format") == "notes":
            body = {**BASE, **patch}
        response = http.post(PATH, json=body)
        assert response.status_code == status, response.text
    assert versions.list_summaries("alice", limit=20, offset=0) == ([], 0)


def test_disabled_unauthenticated_malformed_or_unbounded_requests_do_not_save():
    for enabled, headers, status in ((False, {"x-owner": "alice"}, 404), (True, {}, 401)):
        app, versions = fixtures(enabled)
        with TestClient(app) as http:
            assert http.post(PATH, headers=headers, json=file_import(b"data")).status_code == status
        assert versions.list_summaries("alice", limit=20, offset=0) == ([], 0)
    app, versions = fixtures()
    with TestClient(app, headers={"x-owner": "alice"}) as http:
        assert http.post(PATH, files={"file": ("note.txt", b"raw")}).status_code == 415
        assert http.post(PATH, content=b"[" * 5, headers={"content-type": "application/json"}).status_code == 400
        chunks = iter((b"a" * (MAX_REQUEST_BYTES - 1), b"bb"))
        assert http.post(PATH, content=chunks, headers={"content-type": "application/json"}).status_code == 413
    assert versions.list_summaries("alice", limit=20, offset=0) == ([], 0)


@pytest.mark.parametrize("disconnect_during_body", [True, False])
async def test_disconnect_during_body_or_before_save_does_not_write(disconnect_during_body):
    app, versions = fixtures()
    body = json.dumps(PastedNotesRequest(**BASE, format="notes", text="page").model_dump()).encode()
    incoming = iter([
        {"type": "http.request", "body": body[1:] if disconnect_during_body else body,
         "more_body": disconnect_during_body},
        {"type": "http.disconnect"},
    ])
    messages = []

    async def receive():
        return next(incoming)

    async def send(message):
        messages.append(message)

    await app({
        "type": "http", "asgi": {"version": "3.0"}, "path": PATH, "raw_path": PATH.encode(),
        "method": "POST", "query_string": b"", "headers": [
            (b"x-owner", b"alice"), (b"content-type", b"application/json"),
        ],
    }, receive, send)
    assert messages[0]["status"] == 409
    assert versions.list_summaries("alice", limit=20, offset=0) == ([], 0)


async def test_disconnect_during_extraction_cancels_cooperatively_before_persistence(monkeypatch):
    app, versions = fixtures()
    extracting = threading.Event()
    raw = json.dumps(_document_import(markup_bytes(), "html")).encode()
    delivered = False
    messages = []

    def processing(_body, checkpoint):
        extracting.set()
        while True:
            checkpoint()
            threading.Event().wait(0.005)

    async def receive():
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": raw}
        while not extracting.is_set():
            await asyncio.sleep(0.005)
        return {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    monkeypatch.setattr("app.source_versions.local_text_router.prepare_text_snapshot", processing)
    await app({
        "type": "http", "asgi": {"version": "3.0"}, "path": PATH, "raw_path": PATH.encode(),
        "method": "POST", "query_string": b"", "headers": [
            (b"x-owner", b"alice"), (b"content-type", b"application/json"),
        ],
    }, receive, send)
    assert messages[0]["status"] == 409
    assert versions.list_summaries("alice", limit=20, offset=0) == ([], 0)
