"""Loopback acceptance for F06 with real routes and the F04 worker fixture."""

from uuid import uuid4

from fastapi import Depends
from fastapi.middleware.cors import CORSMiddleware

from app.concept_graph.contracts import ConceptGraph
from app.concept_graph.store import MemoryConceptGraphStore
from app.course_generation.refresh import refresh_router
from app.course_outlines.contracts import OutlineApproveRequest, OutlinePlan, OutlineUpdateRequest
from app.course_outlines.router import course_outline_router
from app.courses.catalog import python_foundations
from app.courses.contracts import CourseRelease
from app.courses.router import create_course_router
from app.courses.store import MemoryCourseStore
from app.source_refresh.index import MemoryImpactIndex
from app.source_refresh.router import source_refresh_router
from app.source_versions.contracts import PdfSnapshotRequest
from app.source_versions.service import pdf_snapshot
from tests.course_generation_browser_fixture import app, documents, outlines, owner, service, sources, store
from tests.course_outline_fixture import evidence_pin

app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:4341"], allow_methods=["*"], allow_headers=["*"])
original = python_foundations()
courses = MemoryCourseStore(documents, [original], source_versions=sources)
graphs = MemoryConceptGraphStore()
app.include_router(course_outline_router(owner, outlines, sources, enabled=True))
app.include_router(refresh_router(owner, service, enabled=True))
app.include_router(source_refresh_router(
    owner, sources, MemoryImpactIndex(documents, outlines, store, graphs, courses, service.edits), enabled=True,
))
app.include_router(create_course_router(owner, courses, upgrades_enabled=True))
User = Depends(owner)


@app.post("/api/fixture/replace-source/{outline_id}")
def replace_source(outline_id: str, user_id=User):
    outline = outlines.get(user_id, outline_id)
    book = sources.get(user_id, str(outline.plan.sources[0].version_id))
    first = book.snapshot.segments[0]
    document_id = str(book.snapshot.origin.document_id)
    document = documents.get_for_user(document_id, user_id)
    changed = next(chunk for chunk in document.chunks if chunk.id == str(first.locator.chunk_id))
    documents.add_flashcards([{
        "id": str(uuid4()), "chapter_id": str(first.locator.chapter_id), "source_chunk_id": changed.id,
        "front": "Where does conserved energy go?", "back": "Track transfers across the chosen boundary.",
    }], document_id=document_id, user_id=user_id, due_date="2026-11-20")
    graphs.save(user_id, document_id, ConceptGraph.model_validate({
        "nodes": [
            {"id": "root", "label": "Conservation map", "kind": "root"},
            {"id": "energy", "label": "Energy boundary", "evidence_ids": ["quote"]},
        ],
        "edges": [{"id": "energy-edge", "source": "root", "target": "energy",
                   "relation": "contains", "evidence_ids": ["quote"]}],
        "evidence": [{"id": "quote", "source_document_id": document_id, "chunk_id": changed.id,
                      "kind": "source_quote", "quote": first.text}],
    }), expected_revision=None)
    changed.content = "An isolated system conserves energy even when energy changes form."
    replacement = sources.save(
        user_id, pdf_snapshot(document, PdfSnapshotRequest(book_title="Physics book, third edition", edition="Third")),
    )
    plan = outline.plan.model_dump(mode="json")
    plan["sources"].append({"version_id": replacement.id, "content_hash": replacement.content_hash})
    pin = evidence_pin(replacement).model_dump(mode="json")
    plan["objectives"][0]["evidence"][0] = pin
    plan["conflicts"][0]["first"] = pin
    saved = outlines.update(user_id, outline_id, OutlineUpdateRequest(
        expected_revision=outline.revision, plan=OutlinePlan.model_validate(plan),
    ))
    outlines.approve(user_id, outline_id, OutlineApproveRequest(
        expected_revision=saved.revision, content_hash=saved.content_hash, reviewed_evidence=True,
    ))
    return {"old": book.id, "new": replacement.id, "document": document_id}


@app.get("/api/fixture/release")
def release_fixture(user_id=User):
    first_lesson = original.lessons[0]
    checkpoint = next(item for item in original.exercises if item.id == first_lesson.checkpoint_ids[0])
    return {"slug": original.slug, "version": original.version, "checkpoint_answer": checkpoint.answer}


@app.post("/api/fixture/publish-replacement")
def publish_replacement(user_id=User):
    data = original.model_dump(mode="json")
    data.update(id=str(uuid4()), version="1.1.0")
    data["lessons"][1]["blocks"][0]["content"] += "\n\nNew release example for the changed lesson."
    updated = CourseRelease.model_validate(data)
    courses.save_release(updated)
    return {"id": updated.id, "version": updated.version}
