"""E04: editable, owner-scoped bibliography CRUD and optional library links."""

import os
import uuid
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg.conninfo import make_conninfo

from app.bibliography.contracts import BibliographyItemInput
from app.bibliography.store import PgBibliographyStore
from app.errors import Conflict
from app.main import app, documents, verifier

client = TestClient(app)


@pytest.fixture()
def headers():
    return {"Authorization": f"Bearer bibliography-test-{uuid.uuid4()}"}


def payload(**overrides):
    return {
        "kind": "book",
        "title": "A title with missing date preserved",
        "authors": [
            {"family": "Lovelace", "given": "Ada"},
            {"literal": "Analytical Engine Group"},
        ],
        "item_pages": "Chapter 2, pp. 20-33",
        "issued": None,
        **overrides,
    }


def test_bibliography_routes_require_authentication():
    assert client.get("/api/bibliography").status_code == 401
    assert client.post("/api/bibliography", json=payload()).status_code == 401
    assert client.get("/api/bibliography/library-documents").status_code == 401


def test_crud_preserves_missing_data_and_isolates_users(headers):
    created_response = client.post("/api/bibliography", headers=headers, json=payload())
    assert created_response.status_code == 201
    created = created_response.json()
    assert created["revision"] == 1
    assert created["issued"] is None
    assert created["item_pages"] == "Chapter 2, pp. 20-33"
    assert len(created["authors"]) == 2

    owner_list = client.get("/api/bibliography", headers=headers, params={"limit": 10})
    assert owner_list.status_code == 200
    assert owner_list.json()["total_count"] == 1
    assert owner_list.json()["items"][0]["id"] == created["id"]

    other = {"Authorization": f"Bearer bibliography-other-{uuid.uuid4()}"}
    assert client.get("/api/bibliography", headers=other).json()["total_count"] == 0
    assert client.get(f"/api/bibliography/{created['id']}", headers=other).status_code == 404

    updated = client.put(
        f"/api/bibliography/{created['id']}",
        headers=headers,
        json=payload(
            kind="book_chapter",
            title="Chapter title",
            container_title="Collected Works",
            expected_revision=1,
        ),
    )
    assert updated.status_code == 200
    assert updated.json()["revision"] == 2
    assert updated.json()["container_title"] == "Collected Works"

    conflict = client.put(
        f"/api/bibliography/{created['id']}",
        headers=headers,
        json=payload(title="Lost update", expected_revision=1),
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "conflict"
    assert conflict.json()["error"]["details"]["current_revision"] == 2

    assert client.delete(f"/api/bibliography/{created['id']}", headers=other).status_code == 404
    assert client.delete(f"/api/bibliography/{created['id']}", headers=headers).json()["deleted"] is True
    assert client.get("/api/bibliography", headers=headers).json()["total_count"] == 0


def test_link_picker_and_mutations_accept_only_owned_library_documents(headers):
    token = headers["Authorization"].split(" ", 1)[1]
    resolved_owner = verifier.user_id(token)
    if hasattr(documents, "resolve_user"):
        resolved_owner = documents.resolve_user(resolved_owner)
    owned_doc = documents.create(
        user_id=resolved_owner, filename="Reference.pdf", mime_type="application/pdf", size_bytes=1024
    )
    foreign_doc = documents.create(
        user_id="some-other-owner", filename="Private.pdf", mime_type="application/pdf", size_bytes=1024
    )

    listing = client.get("/api/bibliography/library-documents", headers=headers)
    assert listing.status_code == 200
    assert {"id": owned_doc.id, "title": "Reference.pdf"} in listing.json()["documents"]
    assert all(item["id"] != foreign_doc.id for item in listing.json()["documents"])

    linked = client.post(
        "/api/bibliography",
        headers=headers,
        json=payload(source_document_id=owned_doc.id),
    )
    assert linked.status_code == 201
    assert linked.json()["source_document_id"] == owned_doc.id

    denied = client.post(
        "/api/bibliography",
        headers=headers,
        json=payload(source_document_id=foreign_doc.id),
    )
    assert denied.status_code == 404
    assert denied.json()["error"]["code"] == "not_found"

    changed_link = client.put(
        f"/api/bibliography/{linked.json()['id']}",
        headers=headers,
        json=payload(source_document_id=foreign_doc.id, expected_revision=1),
    )
    assert changed_link.status_code == 404
    assert client.get(
        "/api/bibliography/library-documents", headers=headers, params={"limit": 1, "offset": 0}
    ).status_code == 200


def test_validation_preserves_unconfirmed_import_suggestions(headers):
    invalid = client.post(
        "/api/bibliography",
        headers=headers,
        json=payload(metadata_provenance=[{"field": "title", "source": "manual", "confirmed": False}]),
    )
    assert invalid.status_code == 400
    good = client.post(
        "/api/bibliography",
        headers=headers,
        json=payload(metadata_suggestions=[{"field": "issued", "value": "2025-03", "source": "doi"}]),
    )
    assert good.status_code == 201
    assert good.json()["metadata_suggestions"] == [{"field": "issued", "value": "2025-03", "source": "doi"}]

    invalid_isbn = client.post("/api/bibliography", headers=headers, json=payload(isbn="9780306406158"))
    assert invalid_isbn.status_code == 400
    valid_isbn = client.post("/api/bibliography", headers=headers, json=payload(isbn="978-0-306-40615-7"))
    assert valid_isbn.status_code == 201
    assert valid_isbn.json()["isbn"] == "978-0-306-40615-7"


def test_bibliography_export_allowlist_contains_private_record_fields():
    from app.privacy import _OWNED_TABLES

    fields = next(columns for table, columns in _OWNED_TABLES if table == "bibliography_items")
    assert "user_id" not in fields
    assert {"id", "source_document_id", "metadata_provenance", "metadata_suggestions"} <= set(fields)


@pytest.mark.skipif(not os.environ.get("STUDYVAULT_TEST_DATABASE_URL"), reason="disposable PostgreSQL is opt-in")
def test_bibliography_migration_and_store():
    url = os.environ["STUDYVAULT_TEST_DATABASE_URL"]
    schema = f"bibliography_test_{uuid.uuid4().hex}"
    owner, other, document = (uuid.uuid4() for _ in range(3))
    migration_dir = Path(__file__).resolve().parents[3] / "packages/db/drizzle"
    with psycopg.connect(url, autocommit=True) as conn:
        ident = sql.Identifier(schema)
        conn.execute(sql.SQL("CREATE SCHEMA {}").format(ident))
        try:
            conn.execute(sql.SQL("SET search_path TO {}, public").format(ident))
            conn.execute("CREATE TABLE users (id uuid PRIMARY KEY)")
            conn.execute(
                "CREATE TABLE documents (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) "
                "ON DELETE CASCADE, UNIQUE(id,user_id))"
            )
            for migration_name in ("0016_bibliography_items.sql", "0017_bibliography_isbn.sql"):
                migration = migration_dir / migration_name
                for statement in migration.read_text(encoding="utf-8").split("--> statement-breakpoint"):
                    if statement.strip():
                        conn.execute(statement)
            conn.execute("INSERT INTO users VALUES (%s), (%s)", (owner, other))
            conn.execute("INSERT INTO documents VALUES (%s, %s)", (document, owner))
            store = PgBibliographyStore(make_conninfo(url, options=f"-c search_path={schema},public"))
            body = BibliographyItemInput(**payload(source_document_id=document, isbn="9780306406157"))
            saved = store.create_item(str(owner), body)
            assert saved.source_document_id == document
            assert saved.isbn == "9780306406157"
            assert store.get_item(str(other), saved.id) is None
            with pytest.raises(psycopg.errors.ForeignKeyViolation):
                store.create_item(str(other), body)
            with pytest.raises(Conflict):
                store.update_item(str(owner), saved.id, body, expected_revision=2)
            updated = store.update_item(str(owner), saved.id, body, expected_revision=1)
            assert updated is not None and updated.revision == 2
            conn.execute("DELETE FROM documents WHERE id = %s", (document,))
            unlinked = store.get_item(str(owner), saved.id)
            assert unlinked is not None and unlinked.source_document_id is None
            conn.execute("DELETE FROM users WHERE id = %s", (owner,))
            assert store.get_item(str(owner), saved.id) is None
        finally:
            conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(ident))
