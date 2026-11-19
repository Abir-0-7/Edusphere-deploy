"""F06 impact and selective refresh through real HTTP routes and the in-memory worker."""

import hashlib
from uuid import uuid4

import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient

from app.concept_graph.actions import grounded_graph
from app.concept_graph.store import MemoryConceptGraphStore
from app.course_generation.contracts import GenerationApprovalRef, LessonDraft, LessonEditRequest
from app.course_generation.refresh import refresh_router
from app.course_outlines.contracts import OutlineApproveRequest, OutlinePlan, OutlineUpdateRequest
from app.courses.store import MemoryCourseStore
from app.errors import ApiError, api_error_handler
from app.source_refresh.impact import compare_segments
from app.source_refresh.index import MemoryImpactIndex
from app.source_refresh.router import source_refresh_router
from app.source_versions.contracts import SourceSnapshot, SourceVersion
from tests.course_outline_fixture import evidence_pin
from tests.test_course_generation import Harness, lesson
from tests.test_course_source_versions import pinned_course


def updated_snapshot(version, index=0):
    data = version.snapshot.model_dump(mode="json")
    item = data["segments"][index]
    item["text"] = "The updated source gives a new example."
    item["text_sha256"] = hashlib.sha256(item["text"].encode()).hexdigest()
    return SourceSnapshot.model_validate(data)


def update_pdf(documents, versions, version):
    snapshot = updated_snapshot(version)
    document = documents.get_internal(str(version.snapshot.origin.document_id))
    segment = snapshot.segments[0]
    next(chunk for chunk in document.chunks if chunk.id == segment.id).content = segment.text
    return versions.save(document.user_id, snapshot)


def target_approval(outlines, user, parent, previous, after, objective_id):
    data = parent.plan.model_dump(mode="json")
    data["sources"].append({"version_id": after.id, "content_hash": after.content_hash})
    new_pin = evidence_pin(after).model_dump(mode="json")
    for objective in data["objectives"]:
        if objective["id"] == objective_id:
            objective["evidence"] = [
                new_pin if pin["version_id"] == str(previous.id) else pin for pin in objective["evidence"]
            ]
    for conflict in data["conflicts"]:
        if conflict["objective_id"] == objective_id:
            for key in ("first", "second"):
                if conflict[key]["version_id"] == str(previous.id):
                    conflict[key] = new_pin
    if not any(pin["version_id"] == str(previous.id) for item in data["objectives"] for pin in item["evidence"]):
        data["sources"] = [entry for entry in data["sources"] if entry["version_id"] != str(previous.id)]
    draft = outlines.update(
        user,
        str(parent.outline_id),
        OutlineUpdateRequest(
            expected_revision=parent.outline_revision,
            plan=OutlinePlan.model_validate(data),
        ),
    )
    approved = outlines.approve(
        user,
        str(draft.id),
        OutlineApproveRequest(
            expected_revision=draft.revision,
            content_hash=draft.content_hash,
            reviewed_evidence=True,
        ),
    )
    return GenerationApprovalRef(
        outline_id=approved.id,
        approval_id=approved.approval.id,
        outline_revision=approved.revision,
        outline_content_hash=approved.content_hash,
    )


def client(h, *, enabled=True, courses=None, graphs=None):
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)

    def user(x_user: str = Header("owner")):
        return x_user

    courses = courses if courses is not None else MemoryCourseStore(h.documents, [], source_versions=h.sources)
    graphs = graphs if graphs is not None else MemoryConceptGraphStore()
    impact = MemoryImpactIndex(h.documents, h.outlines, h.store, graphs, courses, h.service.edits)
    app.include_router(source_refresh_router(user, h.sources, impact, enabled=enabled))
    app.include_router(refresh_router(user, h.service, enabled=enabled))
    return TestClient(app)


def _source_body(before, after, **changes):
    return {"old_version_id": str(before.id), "new_version_id": str(after.id), **changes}


def test_source_impact_finds_cards_map_evidence_and_old_approval_without_mutating_them():
    h = Harness()
    h.start()
    assert h.worker.process_one()
    parent = h.get()
    doc = h.documents.get_internal(str(h.book.snapshot.origin.document_id))
    first, second = h.book.snapshot.segments
    card_ids = [str(uuid4()), str(uuid4())]
    h.documents.add_flashcards(
        [
            {
                "id": card_ids[0],
                "front": "Energy card",
                "back": "Saved text",
                "source_chunk_id": first.id,
                "chapter_id": str(first.locator.chapter_id),
            },
            {
                "id": card_ids[1],
                "front": "Momentum card",
                "back": "Saved text",
                "source_chunk_id": second.id,
                "chapter_id": str(second.locator.chapter_id),
            },
        ],
        document_id=doc.id,
        user_id="owner",
        due_date="2026-11-23",
    )
    cards_before = h.documents.list_flashcards(doc.id, "owner")
    graph = grounded_graph(doc)
    graph.annotations[f"chunk:{first.id}"] = "Preserve this annotation"
    graphs = MemoryConceptGraphStore()
    before = graphs.save("owner", doc.id, graph, expected_revision=None)
    after = update_pdf(h.documents, h.sources, h.book)
    target_approval(h.outlines, "owner", parent, h.book, after, "energy")

    http = client(h, graphs=graphs)
    path = "/api/source-refresh/impact"
    response = http.post(path, json=_source_body(h.book, after))
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["counts"] == {"unchanged": 1, "changed": 1, "moved": 0, "removed": 0, "added": 0}
    assert [entry["old_segment_id"] for entry in report["segments"]] == [first.id]
    assert {
        (item["kind"], item["id"], item["reason"])
        for item in report["artifacts"]
        if item["kind"] in {"card", "generated_lesson", "outline_objective"}
    } == {
        ("card", card_ids[0], "changed"),
        ("generated_lesson", "energy", "changed"),
        ("outline_objective", "energy", "changed"),
    }
    (outline_impact,) = [item for item in report["artifacts"] if item["kind"] == "outline_objective"]
    assert outline_impact["revision"] == parent.outline_revision
    assert {"map_node", "map_edge"} <= {item["kind"] for item in report["artifacts"]}
    assert graphs.get("owner", doc.id) == before
    assert h.documents.list_flashcards(doc.id, "owner") == cards_before
    assert h.get() == parent

    first_page = http.post(path, json=_source_body(h.book, after, limit=1)).json()
    second_page = http.post(path, json=_source_body(h.book, after, limit=1, offset=1)).json()
    assert first_page["artifacts_truncated"] and first_page["artifacts"] != second_page["artifacts"]
    assert first_page["total_artifacts"] == second_page["total_artifacts"] == len(report["artifacts"])
    assert second_page["segments"] == [] and not second_page["segments_truncated"]
    assert http.post(path, json=_source_body(h.book, after), headers={"x-user": "other"}).status_code == 404
    assert client(h, enabled=False).post(path, json=_source_body(h.book, after)).status_code == 404


def test_impact_includes_private_published_lesson_with_pinned_source():
    docs, versions, release = pinned_course()
    assessment_lesson = release.lessons[2]
    evidence_id = release.evidence[0].id
    assert all(evidence_id not in block.evidence_ids for block in assessment_lesson.blocks)
    checkpoint = next(item for item in release.exercises if item.id == assessment_lesson.checkpoint_ids[0])
    checkpoint.evidence_ids = [evidence_id]
    h = Harness()
    h.documents, h.sources = docs, versions
    old = versions.get("owner", str(release.evidence[0].source_pin.version_id))
    after = update_pdf(docs, versions, old)
    courses = MemoryCourseStore(docs, [release], source_versions=versions)
    enrollment = courses.enroll("owner", release.slug)

    result = client(h, courses=courses).post("/api/source-refresh/impact", json=_source_body(old, after))
    assert result.status_code == 200, result.text
    impacted_lessons = {
        item["id"]
        for item in result.json()["artifacts"]
        if item["kind"] == "course_lesson" and item["parent_id"] == str(release.id)
    }
    assert {release.lessons[0].id, assessment_lesson.id} <= impacted_lessons
    assert courses.get_session("owner", str(enrollment.id)) == enrollment


def test_refresh_reuses_unchanged_lesson_and_its_edits_then_refreshes_only_changed_evidence():
    h = Harness()
    h.start()
    assert h.worker.process_one()
    parent = h.get()
    after = update_pdf(h.documents, h.sources, h.book)
    target = target_approval(h.outlines, "owner", parent, h.book, after, "energy")
    http = client(h)
    base = "/api/course-generations"

    def edit(objective, expected, title):
        return http.put(
            f"{base}/{parent.id}/lessons/{objective}",
            json={
                "expected_run_revision": parent.revision,
                "expected_edit_revision": expected,
                "output": lesson(title),
            },
        )

    assert edit("energy", 0, "Keep my old energy lesson").status_code == 200
    assert edit("momentum", 0, "Keep my momentum lesson").status_code == 200
    body = {
        "parent_run_id": str(parent.id),
        "expected_parent_revision": parent.revision,
        "target": target.model_dump(mode="json"),
        "regenerate_objective_ids": [],
    }
    preview_response = http.post(f"{base}/refresh/preview", json=body)
    assert preview_response.status_code == 200, preview_response.text
    preview = preview_response.json()
    assert [(item["objective_id"], item["action"], item["edit_disposition"]) for item in preview["decisions"]] == [
        ("energy", "generate", "retained_in_parent"),
        ("momentum", "reuse", "reused"),
    ]
    assert preview["retained_parent_allocated_tokens"] == parent.allocated_tokens
    assert preview["new_work_token_ceiling"] == (
        preview["target"]["stages"][0]["token_upper_bound"] * h.service.policy.max_stage_attempts
    )
    assert edit("momentum", 1, "Keep this revision too").status_code == 200
    identity = str(uuid4())
    start = {**body, "id": identity, "preview_hash": preview["preview_hash"], "accept_budget": True}
    assert http.post(f"{base}/refresh", json=start).status_code == 409
    assert len(h.jobs.jobs) == 1
    preview = http.post(f"{base}/refresh/preview", json=body).json()
    start["preview_hash"] = preview["preview_hash"]
    assert http.post(f"{base}/refresh", json={**start, "accept_budget": False}).status_code == 422
    assert http.post(f"{base}/refresh", json=start, headers={"x-user": "other"}).status_code == 404
    response = http.post(f"{base}/refresh", json=start)
    assert response.status_code == 202, response.text
    assert http.post(f"{base}/refresh", json=start).json() == response.json()
    assert len(h.jobs.jobs) == 2 and h.worker.process_one()
    fork = h.service.get("owner", identity)
    assert fork.status == "done" and fork.stages[1].output == parent.stages[1].output
    assert [stage.attempts for stage in fork.stages] == [1, 0]
    assert len(h.calls) == 3
    saved = http.get(f"{base}/{identity}/lesson-edits").json()["items"]
    assert [(item["objective_id"], item["copied_from_revision"]) for item in saved] == [
        ("momentum", 1),
        ("momentum", 2),
    ]
    assert all(item["copied_from_run_id"] == str(parent.id) for item in saved)
    assert {item.objective_id for item in h.service.edits.list("owner", str(parent.id)).items} == {"energy", "momentum"}
    assert http.get(f"{base}/{identity}/lesson-edits", headers={"x-user": "other"}).status_code == 404
    assert h.get() == parent


def test_all_reused_lessons_need_no_provider_work_and_keep_parent_budget():
    h = Harness()
    h.start()
    assert h.worker.process_one()
    parent = h.get()
    h.service.edits.save(
        "owner",
        str(parent.id),
        "momentum",
        LessonEditRequest(
            expected_run_revision=parent.revision,
            expected_edit_revision=0,
            output=LessonDraft.model_validate(lesson()),
        ),
    )
    body = {
        "parent_run_id": str(parent.id),
        "expected_parent_revision": parent.revision,
        "target": h.reference.model_dump(mode="json"),
    }
    http = client(h)
    preview = http.post("/api/course-generations/refresh/preview", json=body).json()
    assert preview["new_work_token_ceiling"] == 0
    identity = str(uuid4())
    response = http.post(
        "/api/course-generations/refresh",
        json={
            **body,
            "id": identity,
            "accept_budget": True,
            "preview_hash": preview["preview_hash"],
        },
    )
    assert response.status_code == 202, response.text
    assert h.worker.process_one()
    fork = h.service.get("owner", identity)
    assert fork.status == "done" and fork.allocated_tokens == 0
    assert len(h.calls) == 2 and h.get().allocated_tokens == parent.allocated_tokens


def test_repository_exact_text_move_precedes_structural_replacement():
    h = Harness()
    origin = h.repo.snapshot.model_dump(mode="json")
    origin["origin"]["commit"] = "b" * 40
    original = origin["segments"][0]
    inserted = {**original, "text": "Inserted line.", "text_sha256": hashlib.sha256(b"Inserted line.").hexdigest()}
    moved = {**original, "id": "energy-later", "locator": {**original["locator"], "start_line": 2, "end_line": 2}}
    origin["segments"] = [inserted, moved]
    after = h.sources.save("owner", SourceSnapshot.model_validate(origin))
    changes, counts = compare_segments(h.repo, after)
    assert [(item.change, item.old_segment_id, item.new_segment_id) for item in changes] == [
        ("moved", "energy", "energy-later"),
        ("removed", "momentum", None),
        ("added", None, "energy"),
    ]
    assert counts.moved == counts.removed == counts.added == 1
    origin["origin"]["repository"] = "different"
    unrelated = SourceSnapshot.model_validate(origin)
    unrelated = SourceVersion(
        id=uuid4(), content_hash=unrelated.content_hash(), snapshot=unrelated, created_at=after.created_at
    )
    with pytest.raises(ApiError, match="same GitHub repository"):
        compare_segments(h.repo, unrelated)
