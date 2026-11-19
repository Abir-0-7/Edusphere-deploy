"""Selected repository import against disposable F01 persistence, never production."""

import threading
from uuid import uuid4

import psycopg
import pytest

from app.errors import ApiError, InvalidInput, NotFound
from app.source_versions.contracts import EvidencePin
from app.source_versions.github_admission import GithubImportSlots, MemoryGithubImportLimiter
from app.source_versions.github_importer import GithubImporter
from app.source_versions.github_limits import ImportLimits
from app.source_versions.github_router import GithubImportService
from app.source_versions.store import PgSourceVersionStore
from tests.github_repo_fixture import RepoFixture
from tests.test_source_versions_pg import source_database as source_database


def test_selected_repository_import_is_durable_private_replay_safe_and_revoked_on_account_delete(source_database):
    owner, other = str(uuid4()), str(uuid4())
    with psycopg.connect(source_database, autocommit=True) as conn:
        assert conn.execute("SHOW server_encoding").fetchone() == ("UTF8",), "Use a disposable UTF-8 test database"
        conn.execute("INSERT INTO users (id) VALUES (%s),(%s)", (owner, other))
        fixture = RepoFixture()
        store = PgSourceVersionStore(source_database)
        service = GithubImportService(
            GithubImporter(fixture, ImportLimits()), store,
            MemoryGithubImportLimiter(100, 100), GithubImportSlots(2), enabled=True,
        )
        first = service.run(owner, fixture.request(), threading.Event())
        assert service.run(owner, fixture.request(), threading.Event()) == first
        restored = PgSourceVersionStore(source_database).get(owner, str(first.id))
        assert restored == first and len(restored.snapshot.provenance.repository_files) == 4
        assert store.get(other, str(first.id)) is None
        segment = next(item for item in restored.snapshot.segments if item.locator.notebook_cell is not None)
        pin = EvidencePin(version_id=first.id, content_hash=first.content_hash, segment_id=segment.id,
                          locator=segment.locator, quote=segment.text)
        assert store.resolve(owner, pin).content == segment.text
        with pytest.raises(NotFound):
            store.resolve(other, pin)
        assert conn.execute("SELECT count(*) FROM source_versions WHERE user_id=%s", (owner,)).fetchone() == (1,)
        assert conn.execute("SELECT count(*) FROM documents WHERE user_id=%s", (owner,)).fetchone() == (0,)
        conn.execute("DELETE FROM users WHERE id=%s", (owner,))
        assert store.get(owner, str(first.id)) is None
        with pytest.raises(NotFound):
            service.run(owner, fixture.request(), threading.Event())
        assert conn.execute("SELECT count(*) FROM source_versions").fetchone() == (0,)


def test_import_storage_lock_timeout_rolls_back_and_releases_import_slot(source_database):
    owner = str(uuid4())
    with psycopg.connect(source_database, autocommit=True) as conn:
        conn.execute("INSERT INTO users (id) VALUES (%s)", (owner,))
        fixture, slots = RepoFixture({"lesson.md": b"safe lesson"}), GithubImportSlots(1)
        service = GithubImportService(
            GithubImporter(fixture, ImportLimits()), PgSourceVersionStore(source_database),
            MemoryGithubImportLimiter(100, 100), slots, enabled=True, save_timeout_seconds=0.1,
        )
        with conn.transaction():
            conn.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (owner,))
            with pytest.raises(ApiError, match="storage") as error:
                service.run(owner, fixture.request(), threading.Event())
            assert error.value.status_code == 503
        assert conn.execute("SELECT count(*) FROM source_versions").fetchone() == (0,)
        assert service.run(owner, fixture.request(), threading.Event())


def test_invalid_late_file_never_partially_persists_a_repository(source_database):
    owner = str(uuid4())
    with psycopg.connect(source_database, autocommit=True) as conn:
        conn.execute("INSERT INTO users (id) VALUES (%s)", (owner,))
        fixture = RepoFixture({"first.md": b"safe chapter", "last.py": b"bad\x00content"})
        service = GithubImportService(
            GithubImporter(fixture, ImportLimits()), PgSourceVersionStore(source_database),
            MemoryGithubImportLimiter(100, 100), GithubImportSlots(2), enabled=True,
        )
        with pytest.raises(InvalidInput):
            service.run(owner, fixture.request(), threading.Event())
        assert conn.execute("SELECT count(*) FROM source_versions").fetchone() == (0,)
