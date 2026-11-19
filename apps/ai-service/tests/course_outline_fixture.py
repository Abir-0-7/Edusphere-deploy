"""Two-source, three-objective F03 acceptance fixtures, without any AI calls."""

import hashlib
from uuid import uuid4

from app.course_outlines.contracts import OutlinePlan
from app.documents.store import ChapterRecord, ChunkRecord
from app.source_versions.contracts import EvidencePin, PdfSnapshotRequest, SourceSnapshot
from app.source_versions.service import pdf_snapshot


def seed_sources(documents, sources, owner):
    doc = documents.create(user_id=owner, filename="Physics book", mime_type="application/pdf", size_bytes=10)
    documents.mark_parsed(doc.id, markdown="Physics lessons", page_count=2)
    chapter_id = str(uuid4())
    chapter = ChapterRecord(chapter_id, doc.id, owner, "Conservation", 0, 1, 2)
    doc.chapters = [chapter]
    doc.chunks = [ChunkRecord(str(uuid4()), doc.id, owner, chapter_id, text, index, index - 1)
                  for index, text in enumerate([
                      "Energy is conserved in an isolated system.",
                      "Momentum is conserved without external force.",
                  ], start=1)]
    book = sources.save(owner, pdf_snapshot(doc, PdfSnapshotRequest(edition="Second")))
    segments = []
    for identifier, text in (
        ("energy", "Energy is transferred between interacting systems."),
        ("momentum", "External forces change total momentum."),
    ):
        segments.append({
            "id": identifier, "text": text, "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
            "locator": {"kind": "github", "path": f"docs/{identifier}.md", "start_line": 1, "end_line": 1},
        })
    repo = sources.save(owner, SourceSnapshot.model_validate({
        "title": "Teaching repository",
        "origin": {"kind": "github", "owner": "studyvault", "repository": "teaching", "commit": "a" * 40},
        "provenance": {"adapter": "github_selected_text"}, "segments": segments,
    }))
    return book, repo


def evidence_pin(version, index=0):
    item = version.snapshot.segments[index]
    return EvidencePin(version_id=version.id, content_hash=version.content_hash, segment_id=item.id,
                       locator=item.locator, quote=item.text)


def draft_plan(book, repo):
    first, second = evidence_pin(book), evidence_pin(repo)
    return OutlinePlan.model_validate({
        "title": "Conservation course", "outcome": "Explain conservation and distinguish transfers from creation.",
        "sources": [{"version_id": version.id, "content_hash": version.content_hash} for version in (book, repo)],
        "objectives": [
            {"id": "energy", "title": "Explain energy conservation", "estimated_minutes": 30,
             "evidence": [first, second], "review_status": "needs_review"},
            {"id": "momentum", "title": "Explain momentum conservation", "estimated_minutes": 20,
             "prerequisite_ids": ["energy"], "evidence": [evidence_pin(book, 1)]},
            {"id": "quantum", "title": "Derive a quantum result", "estimated_minutes": 45},
        ],
        "modules": [{"id": "foundations", "title": "Foundations", "objective_ids": ["energy", "momentum", "quantum"]}],
        "conflicts": [{"id": "system-boundary", "objective_id": "energy", "first": first, "second": second,
                       "description": "Check whether these statements use the same system boundary."}],
    })


def reviewed_plan(plan):
    data = plan.model_dump(mode="json")
    data["objectives"] = [objective for objective in data["objectives"] if objective["id"] != "quantum"]
    for objective in data["objectives"]:
        objective["review_status"] = "reviewed"
    data["modules"][0]["objective_ids"].remove("quantum")
    data["conflicts"][0]["resolution"] = "An isolated system conserves energy; interacting subsystems exchange it."
    return OutlinePlan.model_validate(data)
