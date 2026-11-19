"""Pinned private multi-source courses preserve the original study bridge."""

import hashlib
import json
import os
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.courses.catalog import python_foundations
from app.courses.contracts import CourseRelease
from app.courses.store import MemoryCourseStore
from app.documents.store import ChapterRecord, ChunkRecord, InMemoryDocumentStore
from app.errors import Conflict, InvalidInput, NotFound
from app.source_versions.contracts import EvidencePin, PdfSnapshotRequest, SourceSnapshot
from app.source_versions.service import pdf_snapshot
from app.source_versions.store import MemorySourceVersionStore


def pinned_course():
    documents = InMemoryDocumentStore()
    versions = MemorySourceVersionStore(documents)
    data = python_foundations().model_dump(mode="json")
    data.update(
        id=str(uuid4()), course_id=str(uuid4()), slug="private-multi-source", user_id="owner",
        visibility="private", status="published", origin="hybrid", size="full",
    )
    first_source, second_source = data["sources"][:2]
    document = documents.create(
        user_id="owner", filename="book.pdf", mime_type="application/pdf", size_bytes=10,
    )
    chapter_id, chunk_id = str(uuid4()), str(uuid4())
    documents.mark_parsed(document.id, markdown=first_source["body"], page_count=5)
    documents.replace_structure(document.id, [
        ChapterRecord(chapter_id, document.id, "owner", "Values", 0, 5, 5),
    ], [ChunkRecord(chunk_id, document.id, "owner", chapter_id, first_source["body"], 5, 0)])
    pdf = versions.save("owner", pdf_snapshot(document, PdfSnapshotRequest(
        book_title="Python Study Book", edition="Second", printed_page_labels={"5": "iii"},
    )))
    text = second_source["body"]
    repository = versions.save("owner", SourceSnapshot.model_validate({
        "title": "Pinned teaching repository",
        "origin": {"kind": "github", "owner": "studyvault", "repository": "teaching", "commit": "a" * 40},
        "provenance": {"adapter": "github_selected_text"},
        "segments": [{
            "id": "branches", "text": text, "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
            "locator": {"kind": "github", "path": "docs/branches.md", "start_line": 1,
                        "end_line": len(text.splitlines())},
        }],
    }))
    for evidence, version in zip(data["evidence"][:2], (pdf, repository), strict=True):
        segment = version.snapshot.segments[0]
        evidence["source_pin"] = EvidencePin(
            version_id=version.id, content_hash=version.content_hash, segment_id=segment.id,
            locator=segment.locator, quote=evidence["quote"],
        ).model_dump(mode="json")
    return documents, versions, CourseRelease.model_validate(data)


def test_legacy_course_hash_and_enrollment_evidence_stay_compatible():
    release = python_foundations()
    data = release.model_dump(mode="json")
    for evidence in data["evidence"]:
        assert "source_pin" not in evidence
    # This is the exact pre-F01 hash algorithm, including its default JSON spacing.
    if not release.labs:
        data.pop("labs", None)
    if not release.assignments:
        data.pop("assignments", None)
    expected = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
    assert release.content_hash() == expected
    store = MemoryCourseStore(InMemoryDocumentStore())
    session = store.enroll("legacy-owner", release.slug)
    assert store.enroll("legacy-owner", release.slug) == session
    assert all(ref.source_pin is None for ref in session.evidence)
    source = store.documents.get_for_user(str(session.document_id), "legacy-owner")
    assert all(ref.quote in next(c.content for c in source.chunks if c.id == str(ref.chunk_id))
               for ref in session.evidence)


def test_private_pdf_and_repository_course_pins_resolve_and_reach_learner():
    documents, versions, release = pinned_course()
    store = MemoryCourseStore(documents, releases=[], source_versions=versions)
    store.save_release(release)
    saved = store.get_release(release.slug, "owner")
    first, second = saved.evidence[:2]
    assert versions.resolve("owner", first.source_pin).pin.locator.printed_page_label == "iii"
    assert versions.resolve("owner", first.source_pin).pin.locator.pdf_page_index == 5
    assert versions.resolve("owner", second.source_pin).canonical_url == (
        "https://github.com/studyvault/teaching/blob/" + "a" * 40 + "/docs/branches.md#L1-L10"
    )
    session = store.enroll("owner", release.slug)
    assert session.evidence[0].source_pin == first.source_pin
    assert session.model_dump(mode="json")["evidence"][0]["source_pin"] == first.source_pin.model_dump(mode="json")
    # Legacy private study material remains valid alongside its external original pin.
    material = documents.get_for_user(str(session.document_id), "owner")
    assert session.evidence[0].quote in material.chunks[0].content
    with pytest.raises(NotFound):
        store.get_release(release.slug, "other")


def test_pinned_course_fails_closed_without_a_resolver_or_for_another_owner():
    documents, versions, release = pinned_course()
    with pytest.raises(InvalidInput, match="resolver is required"):
        MemoryCourseStore(documents, releases=[]).save_release(release)
    data = release.model_dump(mode="json")
    data["user_id"] = "other"
    store = MemoryCourseStore(documents, releases=[], source_versions=versions)
    with pytest.raises(NotFound, match="Source version"):
        store.save_release(CourseRelease.model_validate(data))
    assert store._releases == {}


@pytest.mark.parametrize("change", ["hash", "version", "locator", "segment"])
def test_wrong_version_hash_segment_and_locator_cannot_be_saved(change):
    documents, versions, release = pinned_course()
    data = release.model_dump(mode="json")
    pin = data["evidence"][0]["source_pin"]
    if change == "hash":
        pin["content_hash"] = "0" * 64
    elif change == "version":
        pin["version_id"] = str(uuid4())
    elif change == "locator":
        pin["locator"]["printed_page_label"] = "999"
    else:
        pin["segment_id"] = "missing"
    store = MemoryCourseStore(documents, releases=[], source_versions=versions)
    with pytest.raises((InvalidInput, Conflict, NotFound)):
        store.save_release(CourseRelease.model_validate(data))
    assert store._releases == {}


def test_pin_quote_and_course_quote_must_be_identical():
    _, _, release = pinned_course()
    data = release.model_dump(mode="json")
    data["evidence"][0]["source_pin"]["quote"] = "A different quotation"
    with pytest.raises(ValidationError, match="pinned evidence quote"):
        CourseRelease.model_validate(data)


def test_private_source_pins_cannot_be_promoted_into_catalog():
    _, _, release = pinned_course()
    data = release.model_dump(mode="json")
    data.update(visibility="catalog", user_id=None)
    with pytest.raises(ValidationError, match="editorial review"):
        CourseRelease.model_validate(data)


def test_removed_pdf_source_cannot_be_pinned_to_a_new_course():
    documents, versions, release = pinned_course()
    document_id = next(iter(documents._docs))
    del documents._docs[document_id]
    store = MemoryCourseStore(documents, releases=[], source_versions=versions)
    with pytest.raises(NotFound, match="Source version"):
        store.save_release(release)
    assert store._releases == {}


@pytest.mark.parametrize("removed_source", ["pdf_document", "repository_version"])
def test_dead_pin_revokes_existing_sessions_and_prevents_new_enrollment(removed_source):
    documents, versions, release = pinned_course()
    store = MemoryCourseStore(documents, releases=[], source_versions=versions)
    store.save_release(release)
    session = store.enroll("owner", release.slug)
    update = release.model_dump(mode="json")
    update.update(id=str(uuid4()), version=f"{release.version}-next")
    store.save_release(CourseRelease.model_validate(update))
    if removed_source == "pdf_document":
        version = versions.get("owner", str(release.evidence[0].source_pin.version_id))
        del documents._docs[str(version.snapshot.origin.document_id)]
    else:
        del versions._rows[("owner", str(release.evidence[1].source_pin.version_id))]
    before = len(documents._docs)
    with pytest.raises(NotFound, match="Source version"):
        store.get_release(release.slug, "owner")
    with pytest.raises(NotFound, match="Source version"):
        store.enroll("owner", release.slug)
    with pytest.raises(NotFound, match="Source version"):
        store.get_session("owner", str(session.id))
    with pytest.raises(NotFound, match="Source version"):
        store.list_sessions("owner")
    with pytest.raises(NotFound, match="Source version"):
        store.action("owner", str(session.id), "attempt", {
            "id": str(uuid4()), "exercise_id": session.lesson.checkpoint.id, "revision": 0, "answer": 13,
        })
    assert store._actions == {}
    assert store._enrollments[str(session.id)]["revision"] == 0
    assert len(documents._docs) == before
    # Revocation guards course API access; this does not change snapshot-retention policy.
    assert documents.get_for_user(str(session.document_id), "owner") is not None


def test_legacy_course_reads_never_call_source_version_resolver():
    class UnusedResolver:
        def resolve(self, *_args, **_kwargs):
            raise AssertionError("Legacy course made a source-version query")

    store = MemoryCourseStore(InMemoryDocumentStore(), source_versions=UnusedResolver())
    release = store.get_release("python-foundations", "owner")
    session = store.enroll("owner", release.slug)
    assert store.get_session("owner", str(session.id)) == session
    assert store.list_sessions("owner") == [session]


def test_pg_deployed_course_pins_resume_and_revoke_after_original_source_deletion():
    """Requires a migrated disposable baseline; never uses the application's URL."""
    url = os.getenv("STUDYVAULT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("A migrated disposable course/source Postgres URL is not configured")
    from app.courses.store import PgCourseStore
    from app.documents.pg_store import PgDocumentStore
    from app.source_versions.store import PgSourceVersionStore

    documents = PgDocumentStore(url)
    owner = documents.resolve_user(f"f01-course-pin-{uuid4().hex}")
    try:
        release_data = python_foundations().model_dump(mode="json")
        source = release_data["sources"][0]
        document = documents.create(
            user_id=owner, filename="pinned-book.pdf", mime_type="application/pdf", size_bytes=10,
        )
        documents.mark_parsed(document.id, markdown=source["body"], page_count=4)
        chapter_id, chunk_id = str(uuid4()), str(uuid4())
        documents.replace_structure(document.id, [
            ChapterRecord(chapter_id, document.id, owner, "Pinned source", 0, 4, 4),
        ], [ChunkRecord(chunk_id, document.id, owner, chapter_id, source["body"], 4, 0)])
        versions = PgSourceVersionStore(url)
        snapshot = versions.save(owner, pdf_snapshot(
            documents.get_for_user(document.id, owner),
            PdfSnapshotRequest(edition="Fixture edition", printed_page_labels={"4": "ii"}),
        ))
        for evidence in release_data["evidence"]:
            if evidence["source_id"] == source["id"]:
                evidence["source_pin"] = EvidencePin(
                    version_id=snapshot.id, content_hash=snapshot.content_hash,
                    segment_id=snapshot.snapshot.segments[0].id,
                    locator=snapshot.snapshot.segments[0].locator, quote=evidence["quote"],
                ).model_dump(mode="json")
        release_data.update(
            id=str(uuid4()), course_id=str(uuid4()), slug=f"pinned-deployed-{uuid4().hex}",
            visibility="private", user_id=owner,
        )
        release = CourseRelease.model_validate(release_data)
        store = PgCourseStore(url, source_versions=versions)
        store.save_release(release)
        session = store.enroll(owner, release.slug)
        resumed_store = PgCourseStore(url, source_versions=PgSourceVersionStore(url))
        assert resumed_store.get_session(owner, str(session.id)) == session
        assert any(item.source_pin is not None for item in session.evidence)
        key = next(item for item in release.exercises if item.id == session.lesson.checkpoint.id)
        result = store.action(owner, str(session.id), "attempt", {
            "id": str(uuid4()), "exercise_id": key.id, "revision": session.revision, "answer": key.answer,
        })
        assert result["correct"]
        before = resumed_store.get_session(owner, str(session.id)).revision
        with store._connect() as conn:
            conn.execute("DELETE FROM documents WHERE id=%s AND user_id=%s", (document.id, owner))
        with pytest.raises(NotFound, match="Source version"):
            resumed_store.get_session(owner, str(session.id))
        with pytest.raises(NotFound, match="Source version"):
            resumed_store.enroll(owner, release.slug)
        with store._connect() as conn:
            assert conn.execute(
                "SELECT revision FROM course_enrollments WHERE id=%s AND user_id=%s", (str(session.id), owner),
            ).fetchone() == (before,)
    finally:
        with documents._conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id=%s", (owner,))
        documents._conn.close()
