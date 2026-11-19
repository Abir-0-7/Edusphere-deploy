"""Source-grounded map actions and stable regeneration without learner-state writes."""

import hashlib
from typing import Any
from uuid import UUID

from app.concept_graph.contracts import (
    MAX_GRAPH_NODES,
    ConceptGraph,
    ConceptGraphBoardTarget,
    ConceptGraphDeckTarget,
    ConceptGraphLessonTarget,
    ConceptGraphNodeActions,
    ConceptGraphSourceTarget,
)
from app.courses.catalog import stable_id
from app.documents.store import DocumentRecord
from app.errors import Conflict, InvalidInput, NotFound


def _valid_evidence(document: DocumentRecord, evidence) -> bool:
    if str(evidence.source_document_id) != document.id:
        return False
    chunk = next((item for item in document.chunks if item.id == str(evidence.chunk_id)), None)
    if chunk is None or chunk.user_id != document.user_id or chunk.document_id != document.id:
        return False
    chapter_id = str(evidence.chapter_id) if evidence.chapter_id is not None else None
    if chapter_id is not None and not any(
        item.id == chapter_id and item.user_id == document.user_id and item.document_id == document.id
        for item in document.chapters
    ):
        return False
    return chunk.chapter_id == chapter_id and chunk.page == evidence.page and evidence.quote in chunk.content


def resolve_actions(record, node_id: str, document: DocumentRecord, documents, studio=None, courses=None):
    node = next((item for item in record.graph.nodes if item.id == node_id), None)
    if node is None:
        raise NotFound("Concept graph node not found")
    answer = ConceptGraphNodeActions(graph_revision=record.revision, node_id=node_id)
    references = [item for item in record.graph.evidence if item.id in node.evidence_ids]
    if not references:
        return answer
    if any(not _valid_evidence(document, item) for item in references):
        raise Conflict("This node's source changed. Regenerate the graph before opening learning actions.")
    evidence = references[0]
    source = ConceptGraphSourceTarget(
        document_id=UUID(document.id), chapter_id=evidence.chapter_id,
        chunk_id=evidence.chunk_id, page=evidence.page, quote=evidence.quote,
    )
    answer.source = source
    answer.board = ConceptGraphBoardTarget(
        document_id=source.document_id, node_id=node_id, label=node.label, quote=evidence.quote, page=evidence.page,
    )
    if studio is not None:
        chunk_ids = {str(item.chunk_id) for item in references}
        for deck in studio.list_decks(document.id, document.user_id):
            cards = documents.list_flashcards(
                document.id, document.user_id, deck_id=str(deck.id), limit=100, offset=0,
            )
            valid_cards = []
            for card in cards:
                if card.get("source_chunk_id") not in chunk_ids:
                    continue
                verified = documents.get_flashcard_source_for_user(card["id"], document.user_id)
                if verified is not None and verified.get("document_id") == document.id:
                    valid_cards.append(UUID(card["id"]))
            if valid_cards:
                answer.deck = ConceptGraphDeckTarget(
                    document_id=UUID(document.id), deck_id=deck.id, card_ids=valid_cards[:100],
                )
                break
    if courses is not None and evidence.chapter_id is not None:
        chapter_id = str(evidence.chapter_id)
        lesson = courses.graph_lesson_context(document.user_id, document.id, chapter_id)
        if lesson is not None:
            content = "\n\n".join(
                chunk.content for chunk in document.chunks
                if chunk.chapter_id == chapter_id and chunk.document_id == document.id
                and chunk.user_id == document.user_id
            )
            if (
                content == lesson["content"]
                and (node.objective_id is None or node.objective_id in lesson["objective_ids"])
            ):
                answer.lesson = ConceptGraphLessonTarget(
                    enrollment_id=UUID(str(lesson["enrollment_id"])), course_slug=lesson["course_slug"],
                    lesson_id=lesson["lesson_id"], objective_id=node.objective_id,
                    title=lesson["title"], content=content[:24000],
                )
    return answer


def grounded_graph(document: DocumentRecord, courses=None) -> ConceptGraph:
    """Build an extractive hierarchy from actual source IDs; never infer a target from a label."""
    nodes: list[dict[str, Any]] = [{
        "id": f"document:{document.id}", "label": document.filename[:200], "kind": "root", "evidence_ids": [],
    }]
    edges, evidence = [], []
    root_id = nodes[0]["id"]
    course_objectives: dict[str, list[str]] = {}
    if courses is not None:
        for session in courses.list_sessions(document.user_id):
            if str(session.document_id) == document.id:
                for lesson in session.lessons:
                    course_objectives[stable_id(f"{session.id}/chapter/{lesson.id}")] = lesson.objective_ids
    for chapter in sorted(document.chapters, key=lambda item: (item.ordinal, item.id)):
        if chapter.user_id != document.user_id or chapter.document_id != document.id:
            continue
        chunks = [
            chunk for chunk in sorted(document.chunks, key=lambda item: (item.ordinal, item.id))
            if chunk.chapter_id == chapter.id and chunk.document_id == document.id
            and chunk.user_id == document.user_id and chunk.content.strip()
        ]
        if not chunks or len(nodes) >= MAX_GRAPH_NODES:
            continue
        chapter_node = f"chapter:{chapter.id}"
        chapter_evidence = []
        for chunk in chunks[:4]:
            if len(nodes) >= MAX_GRAPH_NODES - 1:
                break
            quote = chunk.content.strip()[:1000]
            evidence_id = f"evidence:{chunk.id}:{hashlib.sha256(quote.encode()).hexdigest()[:12]}"
            evidence.append({
                "id": evidence_id, "source_document_id": document.id, "chapter_id": chapter.id,
                "chunk_id": chunk.id, "page": chunk.page, "quote": quote, "kind": "source_quote",
            })
            chapter_evidence.append(evidence_id)
            chunk_node = f"chunk:{chunk.id}"
            nodes.append({
                "id": chunk_node, "label": quote.split("\n", 1)[0][:200], "kind": "concept",
                "evidence_ids": [evidence_id],
            })
            edges.append({
                "id": f"contains:{chunk.id}", "source": chapter_node, "target": chunk_node,
                "relation": "contains", "evidence_ids": [evidence_id],
            })
        if not chapter_evidence:
            continue
        nodes.append({
            "id": chapter_node, "label": chapter.title[:200], "kind": "chapter",
            "evidence_ids": chapter_evidence,
        })
        edges.append({
            "id": f"chapter-edge:{chapter.id}", "source": root_id, "target": chapter_node,
            "relation": "contains", "evidence_ids": [],
        })
        for objective_id in course_objectives.get(chapter.id, []):
            if len(nodes) >= MAX_GRAPH_NODES:
                break
            token = hashlib.sha256(objective_id.encode()).hexdigest()[:24]
            objective_node = f"objective:{token}"
            if any(item["id"] == objective_node for item in nodes):
                continue
            nodes.append({
                "id": objective_node, "label": objective_id, "kind": "objective",
                "objective_id": objective_id, "evidence_ids": chapter_evidence[:1],
            })
            edges.append({
                "id": f"objective-edge:{token}", "source": chapter_node, "target": objective_node,
                "relation": "contains", "evidence_ids": chapter_evidence[:1],
            })
    if len(nodes) < 2:
        raise InvalidInput("This source needs a chapter with readable text before a grounded graph can be generated.")
    return ConceptGraph.model_validate({
        "version": 1, "nodes": nodes, "edges": edges, "evidence": evidence, "annotations": {}, "layout": {},
    })


def regenerate_graph(previous: ConceptGraph, generated: ConceptGraph, document: DocumentRecord) -> ConceptGraph:
    """Keep identities, learner labels, notes and layout while refreshing source-derived content."""
    old_objectives = {
        item.objective_id: item.id for item in previous.nodes if item.objective_id is not None
    }
    remap = {
        item.id: old_objectives[item.objective_id]
        for item in generated.nodes if item.objective_id in old_objectives
    }
    fresh = generated.model_dump(mode="json")
    for node in fresh["nodes"]:
        node["id"] = remap.get(node["id"], node["id"])
    for edge in fresh["edges"]:
        edge["source"] = remap.get(edge["source"], edge["source"])
        edge["target"] = remap.get(edge["target"], edge["target"])
    valid_old_evidence = [item for item in previous.evidence if _valid_evidence(document, item)]
    evidence_by_id = {item.id: item.model_dump(mode="json") for item in valid_old_evidence}
    evidence_by_id.update({item["id"]: item for item in fresh["evidence"]})
    valid_ids = set(evidence_by_id)
    nodes_by_id = {item["id"]: item for item in fresh["nodes"]}
    for item in previous.nodes:
        if item.id in nodes_by_id:
            # A learner may have renamed a source node; regeneration never overwrites that edit.
            nodes_by_id[item.id]["label"] = item.label
        else:
            saved = item.model_dump(mode="json")
            saved["evidence_ids"] = [identifier for identifier in item.evidence_ids if identifier in valid_ids]
            nodes_by_id[item.id] = saved
    if len(nodes_by_id) > MAX_GRAPH_NODES:
        raise InvalidInput("Regeneration would exceed the graph limit; remove unneeded nodes before trying again.")
    edge_keys = {(item.source, item.target, item.relation) for item in previous.edges}
    merged_edges = [item.model_dump(mode="json") for item in previous.edges]
    edge_ids = {item["id"] for item in merged_edges}
    for edge in fresh["edges"]:
        key = (edge["source"], edge["target"], edge["relation"])
        if key not in edge_keys:
            candidate = {**edge, "id": edge["id"] if edge["id"] not in edge_ids else f"generated:{edge['id']}"}
            merged_edges.append(candidate)
            edge_keys.add(key)
            edge_ids.add(candidate["id"])
    for edge in merged_edges:
        edge["evidence_ids"] = [identifier for identifier in edge["evidence_ids"] if identifier in valid_ids]
    return ConceptGraph.model_validate({
        "version": 1,
        "nodes": list(nodes_by_id.values()),
        "edges": merged_edges,
        "evidence": list(evidence_by_id.values()),
        "annotations": previous.annotations,
        "layout": previous.layout,
    })
