"""Rehearse the three additive E/F migrations together in a disposable schema."""

import os
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo


def test_completed_ef_migrations_preserve_existing_rows_and_scope_cascades():
    url = os.getenv("STUDYVAULT_SOURCE_TEST_DATABASE_URL") or os.getenv("STUDYVAULT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("A disposable E/F migration Postgres URL is not configured")
    schema = f"phase8_ef_{uuid4().hex}"
    scoped = make_conninfo(url, options=f"-c search_path={schema},public")
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    try:
        with psycopg.connect(scoped, autocommit=True) as conn:
            # These are the existing parent contracts used by migrations 0016-18.
            conn.execute("CREATE TABLE users (id uuid PRIMARY KEY)")
            conn.execute(
                "CREATE TABLE documents (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) "
                "ON DELETE CASCADE, UNIQUE(id,user_id))"
            )
            conn.execute("CREATE TABLE legacy_review_sentinel (id uuid PRIMARY KEY, history jsonb NOT NULL)")
            owner, other, document, legacy = (uuid4() for _ in range(4))
            conn.execute("INSERT INTO users VALUES (%s),(%s)", (owner, other))
            conn.execute("INSERT INTO documents VALUES (%s,%s)", (document, owner))
            conn.execute("INSERT INTO legacy_review_sentinel VALUES (%s,'{\"schedule\":3}')", (legacy,))
            root = Path(__file__).resolve().parents[3]
            for filename in (
                "0016_bibliography_items.sql", "0017_bibliography_isbn.sql", "0018_source_versions.sql",
            ):
                migration = root / "packages/db/drizzle" / filename
                for statement in migration.read_text(encoding="utf-8").split("--> statement-breakpoint"):
                    if statement.strip():
                        conn.execute(statement)
            assert conn.execute("SELECT history FROM legacy_review_sentinel WHERE id=%s", (legacy,)).fetchone() == (
                {"schedule": 3},
            )
            item = conn.execute(
                "INSERT INTO bibliography_items (user_id,kind,title,isbn,source_document_id) "
                "VALUES (%s,'book','Existing-source reference','9780132350884',%s) RETURNING id",
                (owner, document),
            ).fetchone()[0]
            version = conn.execute(
                "INSERT INTO source_versions (user_id,document_id,content_hash,snapshot) "
                "VALUES (%s,%s,%s,'{\"schema_version\":1}') RETURNING id",
                (owner, document, "a" * 64),
            ).fetchone()[0]
            with pytest.raises(psycopg.errors.ForeignKeyViolation):
                conn.execute(
                    "INSERT INTO bibliography_items (user_id,kind,source_document_id) VALUES (%s,'book',%s)",
                    (other, document),
                )
            with pytest.raises(psycopg.errors.ForeignKeyViolation):
                conn.execute(
                    "INSERT INTO source_versions (user_id,document_id,content_hash,snapshot) "
                    "VALUES (%s,%s,%s,'{}')", (other, document, "b" * 64),
                )
            with pytest.raises(psycopg.errors.CheckViolation, match="immutable"):
                conn.execute("UPDATE source_versions SET content_hash=%s WHERE id=%s", ("c" * 64, version))
            # Source deletion keeps the bibliographic record but revokes evidence.
            conn.execute("DELETE FROM documents WHERE id=%s", (document,))
            assert conn.execute(
                "SELECT isbn,source_document_id FROM bibliography_items WHERE id=%s", (item,),
            ).fetchone() == ("9780132350884", None)
            assert conn.execute("SELECT count(*) FROM source_versions WHERE id=%s", (version,)).fetchone() == (0,)
            # Owner deletion removes private references, while another owner survives.
            conn.execute("DELETE FROM users WHERE id=%s", (owner,))
            assert conn.execute("SELECT count(*) FROM bibliography_items WHERE id=%s", (item,)).fetchone() == (0,)
            assert conn.execute("SELECT id FROM users WHERE id=%s", (other,)).fetchone() == (other,)
            assert conn.execute("SELECT count(*) FROM legacy_review_sentinel").fetchone() == (1,)
    finally:
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
