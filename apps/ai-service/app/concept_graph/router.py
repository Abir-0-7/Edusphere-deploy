"""Owner and source scoped saved concept graph endpoints."""

from collections.abc import AsyncIterator, Callable
from typing import Protocol
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.concept_graph.actions import grounded_graph, regenerate_graph, resolve_actions
from app.concept_graph.contracts import (
    ConceptGraphImportRequest,
    ConceptGraphNodeActions,
    ConceptGraphRecord,
    ConceptGraphRegenerateRequest,
    ConceptGraphSaveRequest,
)
from app.concept_graph.store import ConceptGraphStore
from app.contracts import LEARNING_ERRORS, ErrorEnvelope
from app.documents.store import DocumentRecord
from app.errors import Conflict, InvalidInput, NotFound


class OwnedDocuments(Protocol):
    def get_for_user(self, document_id: str, user_id: str) -> DocumentRecord | None: ...


def _validate_source(document_id: str, user_id: str, graph, documents: OwnedDocuments) -> None:
    document = documents.get_for_user(document_id, user_id)
    if document is None:
        raise NotFound("Source document not found")
    chunks = {chunk.id: chunk for chunk in document.chunks}
    for evidence in graph.evidence:
        if str(evidence.source_document_id) != document_id:
            raise InvalidInput("Evidence source does not belong to this document")
        chunk = chunks.get(str(evidence.chunk_id))
        if chunk is None:
            raise InvalidInput("Evidence chunk does not belong to this document")
        if (str(evidence.chapter_id) if evidence.chapter_id is not None else None) != chunk.chapter_id:
            raise InvalidInput("Evidence chapter does not match its source chunk")
        if evidence.page != chunk.page:
            raise InvalidInput("Evidence page does not match its source chunk")
        if evidence.quote not in chunk.content:
            raise InvalidInput("Evidence quote does not match its source chunk")


def create_concept_graph_router(
    user_dependency: Callable[..., AsyncIterator[str]],
    store: ConceptGraphStore,
    documents: OwnedDocuments,
    studio=None,
    courses=None,
) -> APIRouter:
    router = APIRouter(
        prefix="/api/documents/{document_id}/concept-graph",
        tags=["concept-graph"],
        responses={**LEARNING_ERRORS, 409: {"model": ErrorEnvelope, "description": "Revision conflict"}},
    )
    User = Depends(user_dependency)

    @router.get("", response_model=ConceptGraphRecord)
    def get_graph(document_id: UUID, user_id: str = User) -> ConceptGraphRecord:
        if documents.get_for_user(str(document_id), user_id) is None:
            raise NotFound("Source document not found")
        record = store.get(user_id, str(document_id))
        if record is None:
            raise NotFound("Concept graph not found")
        return record

    @router.put("", response_model=ConceptGraphRecord)
    def save_graph(document_id: UUID, body: ConceptGraphSaveRequest, user_id: str = User) -> ConceptGraphRecord:
        _validate_source(str(document_id), user_id, body.graph, documents)
        return store.save(user_id, str(document_id), body.graph, expected_revision=body.expected_revision)

    @router.post("/import", response_model=ConceptGraphRecord)
    def import_graph(
        document_id: UUID, body: ConceptGraphImportRequest, user_id: str = User
    ) -> ConceptGraphRecord:
        if documents.get_for_user(str(body.source_document_id), user_id) is None:
            raise NotFound("Source document not found")
        if body.source_document_id != document_id:
            raise InvalidInput("Imported graph source does not match the target document")
        _validate_source(str(document_id), user_id, body.graph, documents)
        return store.save(user_id, str(document_id), body.graph, expected_revision=body.expected_revision)

    @router.get("/nodes/{node_id:path}/actions", response_model=ConceptGraphNodeActions)
    def get_node_actions(
        document_id: UUID, node_id: str, revision: int = Query(..., ge=1), user_id: str = User
    ) -> ConceptGraphNodeActions:
        document = documents.get_for_user(str(document_id), user_id)
        if document is None:
            raise NotFound("Source document not found")
        record = store.get(user_id, str(document_id))
        if record is None:
            raise NotFound("Concept graph not found")
        if record.revision != revision:
            raise Conflict("The saved graph changed. Reload it before opening a learning action.")
        return resolve_actions(record, node_id, document, documents, studio, courses)

    @router.post("/regenerate", response_model=ConceptGraphRecord)
    def regenerate(
        document_id: UUID, body: ConceptGraphRegenerateRequest, user_id: str = User
    ) -> ConceptGraphRecord:
        document = documents.get_for_user(str(document_id), user_id)
        if document is None:
            raise NotFound("Source document not found")
        previous = store.get(user_id, str(document_id))
        if previous is None:
            raise NotFound("Save the concept graph before regenerating it")
        if previous.revision != body.expected_revision:
            raise Conflict("The saved graph changed. Reload it before regenerating.")
        generated = grounded_graph(document, courses)
        merged = regenerate_graph(previous.graph, generated, document)
        _validate_source(str(document_id), user_id, merged, documents)
        return store.save(user_id, str(document_id), merged, expected_revision=previous.revision)

    return router
