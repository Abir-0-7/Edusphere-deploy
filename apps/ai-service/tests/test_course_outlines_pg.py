"""F03 additive migration, exact approval, race and deletion tests on disposable PG."""

import hashlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from app.course_outlines.contracts import (
    OutlineApproveRequest,
    OutlineCreateRequest,
    OutlinePlan,
    OutlineUpdateRequest,
)
from app.course_outlines.store import MemoryOutlineStore, PgOutlineStore
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, Conflict, InvalidInput, NotFound
from app.source_versions.contracts import EvidencePin, PdfSnapshotRequest, SourceSnapshot
from app.source_versions.service import pdf_snapshot
from app.source_versions.store import MemorySourceVersionStore, PgSourceVersionStore
from tests.course_outline_fixture import draft_plan, seed_sources
from tests.test_source_versions_pg import _pdf
from tests.test_source_versions_pg import source_database as source_database


@pytest.fixture()
def outline_database(source_database):
    migration = Path(__file__).resolve().parents[3] / "packages/db/drizzle/0019_course_outlines.sql"
    with psycopg.connect(source_database, autocommit=True) as conn:
        for statement in migration.read_text(encoding="utf-8").split("--> statement-breakpoint"):
            if statement.strip():
                conn.execute(statement)
    return source_database


def _repo_version(sources, owner, title="Second source"):
    text = "A second explanation supports practice."
    return sources.save(owner, SourceSnapshot.model_validate({
        "title": title,
        "origin": {"kind": "github", "owner": "studyvault", "repository": "learning", "commit": "a" * 40},
        "provenance": {"adapter": "github_selected_text"},
        "segments": [{"id": "readme", "locator": {
            "kind": "github", "path": "README.md", "start_line": 1, "end_line": 1,
        }, "text": text, "text_sha256": hashlib.sha256(text.encode()).hexdigest()}],
    }))


def _pin(version):
    segment = version.snapshot.segments[0]
    return EvidencePin(version_id=version.id, content_hash=version.content_hash, segment_id=segment.id,
                       locator=segment.locator, quote=segment.text).model_dump(mode="json")


def _setup(database, *, ready=True, **store_options):
    sources = PgSourceVersionStore(database)
    with psycopg.connect(database, autocommit=True) as conn:
        owner, other, document = _pdf(conn)
    pdf = sources.save(owner, pdf_snapshot(
        document, PdfSnapshotRequest(edition="Second", printed_page_labels={"2": "iv"}),
    ))
    repo = _repo_version(sources, owner)
    pins = [_pin(pdf), _pin(repo)]
    plan = OutlinePlan.model_validate({
        "title": "Two-source learning", "outcome": "Explain and practice the material.",
        "sources": [{"version_id": version.id, "content_hash": version.content_hash} for version in (pdf, repo)],
        "objectives": [
            {"id": "core", "title": "Explain the core idea", "estimated_minutes": 30,
             "review_status": "reviewed" if ready else "needs_review", "evidence": pins},
            {"id": "practice", "title": "Apply the idea", "estimated_minutes": 45,
             "prerequisite_ids": ["core"], "review_status": "reviewed" if ready else "needs_review",
             "evidence": [pins[1]] if ready else []},
        ],
        "modules": [{"id": "main", "title": "Learning path", "objective_ids": ["core", "practice"]}],
    })
    return owner, other, document, (pdf, repo), PgOutlineStore(database, sources, **store_options), plan


def _approve(store, owner, record):
    return store.approve(owner, str(record.id), OutlineApproveRequest(
        expected_revision=record.revision, content_hash=record.content_hash, reviewed_evidence=True,
    ))


def test_two_source_gap_review_immutable_approval_and_edit_invalidates_current_approval(outline_database):
    owner, other, _, _, store, plan = _setup(outline_database, ready=False)
    identifier = str(uuid4())
    request = OutlineCreateRequest(id=identifier, plan=plan)
    first = store.create(owner, request)
    assert first.coverage.gap_objective_ids == ["practice"]
    assert first.coverage.overlap_objective_ids == ["core"]
    assert first.coverage.estimated_minutes == 75 and not first.coverage.ready_for_approval
    assert store.create(owner, request) == first
    with pytest.raises(InvalidInput):
        _approve(store, owner, first)
    with pytest.raises(NotFound):
        store.get(other, identifier)
    with pytest.raises(NotFound):
        store.create(other, request)
    edited = plan.model_dump(mode="json")
    edited["objectives"][1]["evidence"] = [edited["objectives"][0]["evidence"][1]]
    for objective in edited["objectives"]:
        objective["review_status"] = "reviewed"
    edited["conflicts"] = [{
        "id": "wording", "objective_id": "core", "first": edited["objectives"][0]["evidence"][0],
        "second": edited["objectives"][0]["evidence"][1], "description": "Review different source wording.",
    }]
    second = store.update(owner, identifier, OutlineUpdateRequest(expected_revision=1, plan=edited))
    assert second.coverage.unresolved_conflict_ids == ["wording"]
    with pytest.raises(InvalidInput):
        _approve(store, owner, second)
    edited["conflicts"][0]["resolution"] = "The different wording supports the same private-study objective."
    third = store.update(owner, identifier, OutlineUpdateRequest(expected_revision=2, plan=edited))
    approved = _approve(store, owner, third)
    assert approved.status == "approved" and approved.revision == 3
    assert approved.visibility == "private" and approved.editorial_status == "not_reviewed"
    assert _approve(store, owner, third) == approved
    history = store.history(owner, identifier)
    assert len(history.items) == 1 and history.items[0].snapshot.plan == third.plan
    assert history.items[0].content_hash == third.plan.content_hash()
    with psycopg.connect(outline_database, autocommit=True) as conn:
        with pytest.raises(psycopg.errors.CheckViolation, match="immutable"):
            conn.execute("UPDATE course_outline_approvals SET content_hash=%s WHERE id=%s",
                         ("c" * 64, str(approved.approval.id)))
    edited["title"] = "A revised private learning path"
    fourth = store.update(owner, identifier, OutlineUpdateRequest(expected_revision=3, plan=edited))
    assert fourth.status == "draft" and fourth.approval is None and fourth.revision == 4
    assert len(store.history(owner, identifier).items) == 1
    with pytest.raises(Conflict):
        _approve(store, owner, third)
    assert store.list(owner).items[0].id == fourth.id
    assert store.list(other).total_count == 0


def test_schema_blocks_cross_owner_sources_invalid_status_and_oversized_payloads(outline_database):
    owner, other, document, versions, store, plan = _setup(outline_database)
    first = store.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))
    with psycopg.connect(outline_database, autocommit=True) as conn:
        names = {row[0] for row in conn.execute(
            "SELECT conname FROM pg_constraint WHERE connamespace=current_schema()::regnamespace",
        ).fetchall()}
        assert {"course_outlines_user_id_users_id_fk", "course_outline_sources_user_id_users_id_fk",
                "course_outline_approvals_user_id_users_id_fk",
                "course_outline_sources_outline_id_source_version_id_pk"} <= names
        other_version = _repo_version(store.source_versions, other, "Other owner's source")
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            conn.execute("INSERT INTO course_outline_sources (outline_id,user_id,source_version_id) VALUES (%s,%s,%s)",
                         (str(first.id), owner, str(other_version.id)))
        for values in [
            ("approved", None, "2026-11-19T00:00:00Z"),
            ("approved", 99, "2026-11-19T00:00:00Z"),
            ("draft", 1, "2026-11-19T00:00:00Z"),
            ("published", None, None),
        ]:
            with pytest.raises(psycopg.errors.CheckViolation):
                conn.execute("UPDATE course_outlines SET status=%s,approved_revision=%s,approved_at=%s WHERE id=%s",
                             (*values, str(first.id)))
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(
                "UPDATE course_outlines SET plan=%s WHERE id=%s", (Jsonb({"text": "x" * 262144}), str(first.id)),
            )
        assert conn.execute("SELECT filename FROM documents WHERE id=%s", (document.id,)).fetchone() == ("legacy.pdf",)
        assert conn.execute("SELECT count(*) FROM source_versions WHERE user_id=%s", (owner,)).fetchone() == (2,)
        assert str(versions[0].snapshot.origin.document_id) == document.id


def test_update_and_approval_races_are_fenced_and_exactly_one_receipt_is_created(outline_database):
    owner, _, _, _, store, plan = _setup(outline_database)
    first = store.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))

    def update(index):
        value = plan.model_dump(mode="json")
        value["title"] = f"Edit {index}"
        try:
            return store.update(owner, str(first.id), OutlineUpdateRequest(expected_revision=1, plan=value)).revision
        except Conflict:
            return None

    with ThreadPoolExecutor(max_workers=4) as pool:
        outcomes = list(pool.map(update, range(8)))
    assert outcomes.count(2) == 1 and outcomes.count(None) == 7
    second = store.get(owner, str(first.id))
    with ThreadPoolExecutor(max_workers=4) as pool:
        receipts = list(pool.map(lambda _: str(_approve(store, owner, second).approval.id), range(8)))
    assert len(set(receipts)) == 1
    with psycopg.connect(outline_database, autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM course_outline_approvals").fetchone() == (1,)


def test_outline_quota_is_atomic_and_approval_cap_preserves_existing_history(outline_database):
    owner, _, _, _, store, plan = _setup(outline_database, max_outlines_per_user=2, max_approvals_per_outline=1)

    def create(_):
        try:
            return store.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))
        except InvalidInput:
            return None

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(create, range(8)))
    successful = [row for row in results if row is not None]
    assert len(successful) == 2
    first = successful[0]
    approved = _approve(store, owner, first)
    second = store.update(owner, str(first.id), OutlineUpdateRequest(expected_revision=1, plan=plan))
    with pytest.raises(InvalidInput, match="history limit"):
        _approve(store, owner, second)
    assert len(store.history(owner, str(first.id)).items) == 1
    assert store.history(owner, str(first.id)).items[0].id == approved.approval.id
    store.delete(owner, str(successful[1].id))
    assert store.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))


def test_deleting_historical_source_cascades_outline_approvals_without_deleting_library_document(outline_database):
    owner, _, document, versions, store, plan = _setup(outline_database)
    first = store.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))
    _approve(store, owner, first)
    edited = plan.model_dump(mode="json")
    removed = str(versions[0].id)
    edited["sources"] = [item for item in edited["sources"] if item["version_id"] != removed]
    for objective in edited["objectives"]:
        objective["evidence"] = [pin for pin in objective["evidence"] if pin["version_id"] != removed]
    store.update(owner, str(first.id), OutlineUpdateRequest(expected_revision=1, plan=edited))
    with psycopg.connect(outline_database, autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM course_outline_sources").fetchone() == (2,)
        conn.execute("DELETE FROM source_versions WHERE id=%s AND user_id=%s", (removed, owner))
        for table in ("course_outlines", "course_outline_sources", "course_outline_approvals"):
            assert conn.execute(f"SELECT count(*) FROM {table} WHERE user_id=%s", (owner,)).fetchone() == (0,)
        assert conn.execute("SELECT id FROM documents WHERE id=%s", (document.id,)).fetchone() is not None
    with pytest.raises(NotFound):
        store.get(owner, str(first.id))


def test_removed_unapproved_source_does_not_delete_a_revised_outline(outline_database):
    owner, _, document, versions, store, plan = _setup(outline_database)
    first = store.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))
    edited = plan.model_dump(mode="json")
    removed = str(versions[0].id)
    edited["sources"] = [item for item in edited["sources"] if item["version_id"] != removed]
    for objective in edited["objectives"]:
        objective["evidence"] = [pin for pin in objective["evidence"] if pin["version_id"] != removed]
    revised = store.update(owner, str(first.id), OutlineUpdateRequest(expected_revision=1, plan=edited))
    with psycopg.connect(outline_database, autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM course_outline_sources").fetchone() == (1,)
        conn.execute("DELETE FROM documents WHERE id=%s AND user_id=%s", (document.id, owner))
    assert store.get(owner, str(first.id)) == revised
    assert store.history(owner, str(first.id)).items == []


def test_memory_removed_unapproved_selection_also_survives_source_deletion():
    documents = InMemoryDocumentStore()
    sources = MemorySourceVersionStore(documents)
    book, repo = seed_sources(documents, sources, "owner")
    plan = draft_plan(book, repo)
    store = MemoryOutlineStore(sources)
    first = store.create("owner", OutlineCreateRequest(id=uuid4(), plan=plan))
    edited = plan.model_dump(mode="json")
    edited["sources"] = [edited["sources"][1]]
    edited["conflicts"] = []
    for objective in edited["objectives"]:
        objective["evidence"] = [pin for pin in objective["evidence"] if pin["version_id"] != str(book.id)]
    revised = store.update("owner", str(first.id), OutlineUpdateRequest(expected_revision=1, plan=edited))
    documents._docs.pop(str(book.snapshot.origin.document_id))
    assert store.get("owner", str(first.id)) == revised
    assert store.history("owner", str(first.id)).items == []


def test_configured_storage_timeout_rolls_back_a_blocked_write(outline_database):
    owner, _, _, _, store, plan = _setup(outline_database, timeout_seconds=0.1)
    with psycopg.connect(outline_database) as blocking:
        blocking.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (owner,))
        with pytest.raises(ApiError, match="temporarily unavailable") as error:
            store.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))
        assert error.value.status_code == 503
    assert store.list(owner).total_count == 0
    assert store.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))


def test_document_and_account_deletion_cascade_all_derived_outlines(outline_database):
    owner, other, document, _, store, plan = _setup(outline_database)
    first = store.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))
    _approve(store, owner, first)
    with psycopg.connect(outline_database, autocommit=True) as conn:
        conn.execute("DELETE FROM documents WHERE id=%s AND user_id=%s", (document.id, owner))
        assert conn.execute("SELECT count(*) FROM course_outlines WHERE user_id=%s", (owner,)).fetchone() == (0,)
    version = _repo_version(store.source_versions, owner, "Remaining repository")
    single = plan.model_dump(mode="json")
    single["sources"] = [{"version_id": str(version.id), "content_hash": version.content_hash}]
    for objective in single["objectives"]:
        objective["evidence"] = [_pin(version)]
    second = store.create(owner, OutlineCreateRequest(id=uuid4(), plan=single))
    _approve(store, owner, second)
    other_version = _repo_version(store.source_versions, other)
    other_plan = json.loads(json.dumps(single).replace(str(version.id), str(other_version.id)).replace(
        version.content_hash, other_version.content_hash,
    ))
    survivor = store.create(other, OutlineCreateRequest(id=uuid4(), plan=other_plan))
    with psycopg.connect(outline_database, autocommit=True) as conn:
        conn.execute("DELETE FROM users WHERE id=%s", (owner,))
        for table in ("course_outlines", "course_outline_sources", "course_outline_approvals"):
            assert conn.execute(f"SELECT count(*) FROM {table} WHERE user_id=%s", (owner,)).fetchone() == (0,)
    assert store.get(other, str(survivor.id)).id == survivor.id


def test_source_delete_winning_approval_race_cannot_recreate_outline_or_history(outline_database):
    owner, _, document, _, store, plan = _setup(outline_database)
    first = store.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))
    entered = threading.Event()
    original = store._sources

    def before_source_lock(*args, **kwargs):
        entered.set()
        return original(*args, **kwargs)

    store._sources = before_source_lock
    with ThreadPoolExecutor(max_workers=1) as pool:
        with psycopg.connect(outline_database) as deleting:
            deleting.execute("SELECT id FROM documents WHERE id=%s FOR UPDATE", (document.id,))
            waiting = pool.submit(_approve, store, owner, first)
            assert entered.wait(2)
            deleting.execute("DELETE FROM documents WHERE id=%s AND user_id=%s", (document.id, owner))
        with pytest.raises(NotFound):
            waiting.result(timeout=5)
    with psycopg.connect(outline_database, autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM course_outlines").fetchone() == (0,)
        assert conn.execute("SELECT count(*) FROM course_outline_approvals").fetchone() == (0,)


def test_persisted_outline_reads_use_only_bulk_source_metadata_on_the_existing_connection(
    outline_database, monkeypatch,
):
    owner, _, _, _, store, plan = _setup(outline_database)
    first = store.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))
    approved = _approve(store, owner, first)

    def forbidden_source_fetch(*_args, **_kwargs):
        raise AssertionError("Read paths must not fetch or rehash immutable source payloads")

    monkeypatch.setattr(store.source_versions, "get", forbidden_source_fetch)
    monkeypatch.setattr(store.source_versions, "get_locked", forbidden_source_fetch)
    assert store.get(owner, str(first.id)) == approved
    assert store.list(owner).items[0].id == approved.id
    history = store.history(owner, str(first.id))
    assert history.items[0].content_hash == approved.content_hash
    with psycopg.connect(outline_database, autocommit=True) as conn:
        # Stored plans normally only enter through validated writes. A damaged
        # metadata hash still fails closed without reading the source payload.
        damaged = plan.model_dump(mode="json")
        version_id = damaged["sources"][0]["version_id"]
        damaged["sources"][0]["content_hash"] = "c" * 64
        for objective in damaged["objectives"]:
            for pin in objective["evidence"]:
                if pin["version_id"] == version_id:
                    pin["content_hash"] = "c" * 64
        conn.execute("UPDATE course_outlines SET plan=%s WHERE id=%s", (Jsonb(damaged), str(first.id)))
        for read in (lambda: store.get(owner, str(first.id)), lambda: store.list(owner),
                     lambda: store.history(owner, str(first.id))):
            with pytest.raises(Conflict, match="source hash"):
                read()


def test_missing_retained_source_fails_closed_even_if_cleanup_trigger_was_bypassed(outline_database):
    owner, _, _, versions, store, plan = _setup(outline_database)
    first = store.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))
    with psycopg.connect(outline_database, autocommit=True) as conn:
        # Simulate an incomplete restore using only this disposable schema.
        conn.execute("ALTER TABLE source_versions DISABLE TRIGGER source_versions_delete_outlines")
        conn.execute("DELETE FROM source_versions WHERE id=%s AND user_id=%s", (str(versions[0].id), owner))
        conn.execute("ALTER TABLE source_versions ENABLE TRIGGER source_versions_delete_outlines")
    with pytest.raises(NotFound):
        store.get(owner, str(first.id))
    with pytest.raises(NotFound):
        store.list(owner)


def test_missing_approved_historical_source_fails_closed_when_its_link_has_cascaded(outline_database):
    owner, _, _, versions, store, plan = _setup(outline_database)
    first = store.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))
    _approve(store, owner, first)
    edited = plan.model_dump(mode="json")
    removed = str(versions[0].id)
    edited["sources"] = [item for item in edited["sources"] if item["version_id"] != removed]
    for objective in edited["objectives"]:
        objective["evidence"] = [pin for pin in objective["evidence"] if pin["version_id"] != removed]
    store.update(owner, str(first.id), OutlineUpdateRequest(expected_revision=1, plan=edited))
    with psycopg.connect(outline_database, autocommit=True) as conn:
        # The immutable approval retains an expected ID even if an incomplete
        # restore lost its normalized source link through the FK cascade.
        conn.execute("ALTER TABLE source_versions DISABLE TRIGGER source_versions_delete_outlines")
        conn.execute("DELETE FROM source_versions WHERE id=%s AND user_id=%s", (removed, owner))
        conn.execute("ALTER TABLE source_versions ENABLE TRIGGER source_versions_delete_outlines")
        assert conn.execute("SELECT count(*) FROM course_outline_sources").fetchone() == (1,)
    for read in (lambda: store.get(owner, str(first.id)), lambda: store.list(owner),
                 lambda: store.history(owner, str(first.id))):
        with pytest.raises(NotFound):
            read()
