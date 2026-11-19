"""F03 owner review: two sources -> visible gaps/conflicts -> exact private approval."""

import copy
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.course_outlines.contracts import (
    OutlineApproveRequest,
    OutlineCoverage,
    OutlineCreateRequest,
    OutlineDeleteResponse,
    OutlinePlan,
    OutlineUpdateRequest,
)
from app.course_outlines.coverage import analyze_plan
from app.course_outlines.store import MemoryOutlineStore
from app.courses.catalog import python_foundations
from app.courses.contracts import CourseRelease
from app.courses.store import MemoryCourseStore
from app.documents.store import InMemoryDocumentStore
from app.errors import Conflict, InvalidInput, NotFound
from app.source_versions.store import MemorySourceVersionStore
from tests.course_outline_fixture import draft_plan, reviewed_plan, seed_sources


def setup_outline(**limits):
    documents = InMemoryDocumentStore()
    sources = MemorySourceVersionStore(documents)
    book, repo = seed_sources(documents, sources, "owner")
    plan = draft_plan(book, repo)
    store = MemoryOutlineStore(sources, **limits)
    record = store.create("owner", OutlineCreateRequest(id=uuid4(), plan=plan))
    return store, sources, plan, record


def approve_request(record):
    return OutlineApproveRequest(
        expected_revision=record.revision, content_hash=record.content_hash, reviewed_evidence=True,
    )


def test_two_sources_expose_gaps_overlap_conflicts_effort_and_need_explicit_human_review():
    store, sources, plan, first = setup_outline()
    coverage = first.coverage
    assert coverage.gap_objective_ids == ["quantum"]
    assert coverage.overlap_objective_ids == ["energy"]
    assert coverage.unreviewed_objective_ids == ["energy", "momentum", "quantum"]
    assert coverage.unresolved_conflict_ids == ["system-boundary"]
    assert coverage.estimated_minutes == 95 and coverage.ready_for_approval is False
    with pytest.raises(InvalidInput, match="Resolve coverage"):
        store.approve("owner", str(first.id), approve_request(first))
    updated = store.update("owner", str(first.id), OutlineUpdateRequest(
        expected_revision=first.revision, plan=reviewed_plan(plan),
    ))
    assert updated.coverage.ready_for_approval and updated.coverage.estimated_minutes == 50
    approved = store.approve("owner", str(first.id), approve_request(updated))
    assert approved.status == "approved" and approved.visibility == "private"
    assert approved.editorial_status == "not_reviewed" and approved.approval.revision == updated.revision
    assert store.approve("owner", str(first.id), approve_request(updated)) == approved
    approval = store.history("owner", str(first.id)).items[0]
    assert approval.snapshot.plan == updated.plan and approval.snapshot.coverage == updated.coverage
    assert approval.content_hash == updated.plan.content_hash()
    assert analyze_plan("owner", updated.plan, sources) == updated.coverage


def test_update_invalidates_approval_keeps_prior_history_and_rejects_stale_revision_or_hash():
    store, _, plan, first = setup_outline()
    ready = store.update("owner", str(first.id), OutlineUpdateRequest(expected_revision=1, plan=reviewed_plan(plan)))
    approved = store.approve("owner", str(first.id), approve_request(ready))
    edited = ready.plan.model_dump(mode="json")
    edited["title"] = "An edited outline"
    changed = store.update("owner", str(first.id), OutlineUpdateRequest(expected_revision=2, plan=edited))
    assert changed.revision == 3 and changed.status == "draft" and changed.approval is None
    assert store.history("owner", str(first.id)).items[0].id == approved.approval.id
    with pytest.raises(Conflict):
        store.approve("owner", str(first.id), approve_request(ready))
    with pytest.raises(Conflict):
        store.approve("owner", str(first.id), OutlineApproveRequest(
            expected_revision=3, content_hash="0" * 64, reviewed_evidence=True,
        ))
    with pytest.raises(Conflict):
        store.update("owner", str(first.id), OutlineUpdateRequest(expected_revision=2, plan=edited))
    assert store.get("owner", str(first.id)) == changed


def test_idempotent_creation_and_owner_scoping_never_exposes_private_draft():
    store, _, plan, first = setup_outline()
    assert store.create("owner", OutlineCreateRequest(id=first.id, plan=plan)) == first
    for operation in (
        lambda: store.get("other", str(first.id)),
        lambda: store.history("other", str(first.id)),
        lambda: store.delete("other", str(first.id)),
        lambda: store.approve("other", str(first.id), approve_request(first)),
        lambda: store.update("other", str(first.id), OutlineUpdateRequest(expected_revision=1, plan=plan)),
        lambda: store.create("other", OutlineCreateRequest(id=first.id, plan=plan)),
        lambda: store.create("other", OutlineCreateRequest(id=uuid4(), plan=plan)),
    ):
        with pytest.raises(NotFound):
            operation()
    assert store.list("other").items == []


def test_mismatched_source_hash_wrong_locator_or_quote_fails_without_mutating_saved_plan():
    store, _, plan, first = setup_outline()
    for change in ("hash", "quote", "locator"):
        data = plan.model_dump(mode="json")
        if change == "hash":
            for objective in data["objectives"]:
                for pin in objective["evidence"]:
                    if pin["version_id"] == data["sources"][0]["version_id"]:
                        pin["content_hash"] = "c" * 64
            data["sources"][0]["content_hash"] = "c" * 64
            data["conflicts"][0]["first"]["content_hash"] = "c" * 64
        else:
            pin = data["objectives"][0]["evidence"][0]
            if change == "quote":
                pin["quote"] = "Unsupported invented source text"
            else:
                pin["locator"]["pdf_page_index"] = 2
            data["conflicts"][0]["first"] = copy.deepcopy(pin)
        with pytest.raises((InvalidInput, Conflict)):
            store.update("owner", str(first.id), OutlineUpdateRequest(expected_revision=1, plan=data))
        assert store.get("owner", str(first.id)) == first


def test_unmapped_objective_is_reported_and_unused_sources_are_explicit():
    store, sources, plan, _ = setup_outline()
    data = reviewed_plan(plan).model_dump(mode="json")
    data["modules"][0]["objective_ids"].remove("momentum")
    data["objectives"][0]["evidence"] = data["objectives"][0]["evidence"][:1]
    data["conflicts"] = []
    coverage = analyze_plan("owner", OutlinePlan.model_validate(data), sources)
    assert coverage.unmapped_objective_ids == ["momentum"] and not coverage.ready_for_approval
    assert [str(value) for value in coverage.unused_source_version_ids] == [str(plan.sources[1].version_id)]


def test_source_deletion_revokes_current_draft_and_approval_history():
    store, sources, plan, first = setup_outline()
    ready = store.update("owner", str(first.id), OutlineUpdateRequest(expected_revision=1, plan=reviewed_plan(plan)))
    store.approve("owner", str(first.id), approve_request(ready))
    sources._rows.pop(("owner", str(plan.sources[1].version_id)))
    with pytest.raises(NotFound):
        store.get("owner", str(first.id))
    assert store.list("owner").total_count == 0


def test_later_prerequisite_is_reported_and_cannot_be_approved_until_order_is_fixed():
    store, _, plan, first = setup_outline()
    data = reviewed_plan(plan).model_dump(mode="json")
    data["modules"][0]["objective_ids"] = ["momentum", "energy"]
    reversed_order = store.update("owner", str(first.id), OutlineUpdateRequest(expected_revision=1, plan=data))
    assert reversed_order.coverage.misordered_objective_ids == ["momentum"]
    assert reversed_order.coverage.ready_for_approval is False
    with pytest.raises(InvalidInput, match="prerequisite order"):
        store.approve("owner", str(first.id), approve_request(reversed_order))
    data["modules"][0]["objective_ids"] = ["energy", "momentum"]
    corrected = store.update("owner", str(first.id), OutlineUpdateRequest(expected_revision=2, plan=data))
    assert corrected.coverage.misordered_objective_ids == [] and corrected.coverage.ready_for_approval
    assert store.approve("owner", str(first.id), approve_request(corrected)).status == "approved"


def test_draft_and_approval_caps_are_bounded_and_replay_is_free():
    store, _, plan, first = setup_outline(max_outlines_per_user=1, max_approvals_per_outline=1)
    with pytest.raises(InvalidInput, match="limit"):
        store.create("owner", OutlineCreateRequest(id=uuid4(), plan=plan))
    ready = store.update("owner", str(first.id), OutlineUpdateRequest(expected_revision=1, plan=reviewed_plan(plan)))
    approved = store.approve("owner", str(first.id), approve_request(ready))
    assert store.approve("owner", str(first.id), approve_request(ready)) == approved
    newer = store.update("owner", str(first.id), OutlineUpdateRequest(expected_revision=2, plan=ready.plan))
    with pytest.raises(InvalidInput, match="history limit"):
        store.approve("owner", str(first.id), approve_request(newer))


def test_competing_updates_one_wins_and_competing_approvals_share_one_receipt():
    store, _, plan, first = setup_outline()

    def edit(_):
        try:
            return store.update("owner", str(first.id), OutlineUpdateRequest(
                expected_revision=1, plan=reviewed_plan(plan),
            ))
        except Conflict:
            return None

    with ThreadPoolExecutor(max_workers=4) as pool:
        updates = list(pool.map(edit, range(8)))
    assert len([value for value in updates if value is not None]) == 1
    current = store.get("owner", str(first.id))
    with ThreadPoolExecutor(max_workers=4) as pool:
        approvals = list(pool.map(lambda _: store.approve("owner", str(first.id), approve_request(current)), range(8)))
    assert len({str(record.approval.id) for record in approvals}) == 1


def test_unreviewed_and_owner_approved_plans_have_no_catalog_authority():
    store, _, plan, first = setup_outline()
    courses = MemoryCourseStore(InMemoryDocumentStore())
    before = [item.id for item in courses.list_courses("owner")]
    ready = store.update("owner", str(first.id), OutlineUpdateRequest(expected_revision=1, plan=reviewed_plan(plan)))
    approved = store.approve("owner", str(first.id), approve_request(ready))
    assert approved.visibility == "private" and approved.editorial_status == "not_reviewed"
    assert [item.id for item in courses.list_courses("owner")] == before
    release = python_foundations().model_dump(mode="json")
    release["evidence"][0]["source_pin"] = ready.plan.objectives[0].evidence[0].model_dump(mode="json")
    release["evidence"][0]["quote"] = ready.plan.objectives[0].evidence[0].quote
    with pytest.raises(ValidationError, match="editorial review"):
        CourseRelease.model_validate(release)


def test_http_owner_review_replay_edit_history_privacy_and_injected_authority_rejection():
    from tests.course_outline_browser_fixture import app, documents, outlines, sources

    owner = "outline-fixture-api-" + str(uuid4())
    auth = {"Authorization": f"Bearer {owner}"}
    client = TestClient(app)
    source_response = client.get("/api/source-versions", headers=auth)
    assert source_response.status_code == 200
    assert source_response.json()["total_count"] == 2
    versions = [sources.get(owner, str(item["id"])) for item in source_response.json()["items"]]
    book = next(value for value in versions if value.snapshot.origin.kind == "pdf")
    repo = next(value for value in versions if value.snapshot.origin.kind == "github")
    plan = draft_plan(book, repo)
    identifier = str(uuid4())
    path = "/api/course-outlines"
    body = {"id": identifier, "plan": plan.model_dump(mode="json")}
    assert client.post(path, json=body).status_code == 401
    response = client.post(path, json=body, headers=auth)
    assert response.status_code == 200, response.text
    assert client.post(path, json=body, headers=auth).json() == response.json()
    assert client.get(
        f"{path}/{identifier}", headers={"Authorization": "Bearer outline-fixture-other"},
    ).status_code == 404
    assert client.post(path, json={**body, "visibility": "catalog"}, headers=auth).status_code == 400
    assert client.put(f"{path}/{identifier}", json={"expected_revision": 1, "plan": {
        **body["plan"], "editorial_status": "reviewed",
    }}, headers=auth).status_code == 400
    changed = client.put(f"{path}/{identifier}", json={
        "expected_revision": 1, "plan": reviewed_plan(plan).model_dump(mode="json"),
    }, headers=auth)
    assert changed.status_code == 200
    approval = {"expected_revision": 2, "content_hash": changed.json()["content_hash"], "reviewed_evidence": True}
    assert client.post(
        f"{path}/{identifier}/approve", json={**approval, "status": "published"}, headers=auth,
    ).status_code == 400
    assert client.post(
        f"{path}/{identifier}/approve", json={**approval, "reviewed_evidence": False}, headers=auth,
    ).status_code == 400
    approved = client.post(f"{path}/{identifier}/approve", json=approval, headers=auth)
    assert approved.status_code == 200 and approved.json()["status"] == "approved"
    assert client.get(f"{path}/{identifier}/approvals", headers=auth).json()["items"][0]["revision"] == 2
    assert client.put(
        f"{path}/{identifier}", json={"expected_revision": 1, "plan": body["plan"]}, headers=auth,
    ).status_code == 409
    assert client.delete(f"{path}/{identifier}", headers=auth).json() == {"deleted": True}
    assert client.get(f"{path}/{identifier}", headers=auth).status_code == 404
    assert client.get("/api/source-versions?limit=51", headers=auth).status_code == 400
    # Keep imported names exercised: this is a real store/router, not a transport mock.
    assert outlines.source_versions is sources and documents is sources.documents


def test_default_feature_flag_and_export_registry_and_strict_wire_literals():
    from app.main import app
    from app.privacy import _OWNED_TABLES
    from app.settings import Settings

    assert Settings(_env_file=None).course_outlines_enabled is False
    client = TestClient(app)
    assert client.get("/api/course-outlines").status_code == 401
    assert client.get("/api/course-outlines", headers={"Authorization": "Bearer feature-off"}).status_code == 404
    owned = dict(_OWNED_TABLES)
    assert {"plan", "content_hash", "approved_revision"} <= set(owned["course_outlines"])
    assert "snapshot" in owned["course_outline_approvals"] and "source_version_id" in owned["course_outline_sources"]
    with pytest.raises(ValidationError):
        OutlineDeleteResponse.model_validate({"deleted": 1})
    _, _, _, record = setup_outline()
    with pytest.raises(ValidationError):
        OutlineCoverage.model_validate({**record.coverage.model_dump(mode="json"), "coverage_version": True})
