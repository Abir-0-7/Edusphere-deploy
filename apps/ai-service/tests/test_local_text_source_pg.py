"""Local adapter acceptance against the immutable owner source store in disposable PostgreSQL."""

import json
from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient

from app.errors import ApiError, api_error_handler
from app.source_versions.contracts import EvidencePin
from app.source_versions.local_text import PastedNotesRequest, prepare_text_snapshot
from app.source_versions.local_text_router import local_text_router
from app.source_versions.store import PgSourceVersionStore
from tests.test_local_text_source import BASE, PATH, _document_import, epub_bytes, file_import, markup_bytes
from tests.test_source_versions_pg import _parents
from tests.test_source_versions_pg import source_database as source_database


def test_local_adapters_are_durable_exact_private_replay_safe_and_account_cascading(source_database):
    with psycopg.connect(source_database, autocommit=True) as conn:
        owner, other, _ = _parents(conn)
    owner, other = str(owner), str(other)
    versions = PgSourceVersionStore(source_database)
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)

    def user(x_owner: str = Header(owner)):
        return x_owner

    app.include_router(local_text_router(user, versions, enabled=True))
    requests = [
        {**BASE, "format": "notes", "text": "My notes\nSecond line."},
        file_import("Local text\nবাংলা".encode()),
        _document_import(markup_bytes(), "html"),
        _document_import(epub_bytes(), "epub"),
    ]
    with TestClient(app) as http:
        for body in requests:
            response = http.post(PATH, json=body)
            assert response.status_code == 200, response.text
            result = response.json()
            assert http.post(PATH, json=body).json() == result
            saved = PgSourceVersionStore(source_database).get(owner, result["id"])
            assert saved is not None
            segment = saved.snapshot.segments[0]
            pin = EvidencePin(version_id=saved.id, content_hash=saved.content_hash,
                              segment_id=segment.id, locator=segment.locator, quote=segment.text[:30])
            assert versions.resolve(owner, pin).content == segment.text
            assert versions.get(other, result["id"]) is None
    assert versions.list_summaries(owner, limit=20, offset=0)[1] == 4
    with psycopg.connect(source_database, autocommit=True) as conn:
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("UPDATE source_versions SET snapshot=%s::jsonb WHERE user_id=%s",
                         (json.dumps({"rewritten": True}), owner))
        conn.execute("DELETE FROM users WHERE id=%s", (owner,))
        assert conn.execute("SELECT count(*) FROM source_versions WHERE user_id=%s", (owner,)).fetchone()[0] == 0
    assert versions.list_summaries(owner, limit=20, offset=0)[1] == 0


def test_duplicate_note_submissions_use_one_owner_scoped_immutable_row(source_database):
    with psycopg.connect(source_database, autocommit=True) as conn:
        owner, _, _ = _parents(conn)
    versions = PgSourceVersionStore(source_database, max_versions_per_user=1)
    snapshot = prepare_text_snapshot(PastedNotesRequest(**BASE, format="notes", text="Same exact notes."))
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(lambda _: versions.save(str(owner), snapshot), range(8)))
    assert len({row.id for row in rows}) == 1
    assert versions.list_summaries(str(owner), limit=20, offset=0)[1] == 1
