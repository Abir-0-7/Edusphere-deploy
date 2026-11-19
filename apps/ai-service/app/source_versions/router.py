"""Authenticated evidence bridge. Repository network import is not exposed here."""

from uuid import UUID

from fastapi import APIRouter, Depends

from app.contracts import LEARNING_ERRORS, ErrorEnvelope
from app.errors import InvalidInput, NotFound
from app.source_versions.contracts import EvidencePin, PdfSnapshotRequest, ResolvedEvidence, SourceVersion
from app.source_versions.service import pdf_snapshot


def source_version_router(user_dependency, store, documents) -> APIRouter:
    router = APIRouter(tags=["source-versions"], responses={
        **LEARNING_ERRORS, 409: {"model": ErrorEnvelope, "description": "Source version mismatch"},
    })
    User = Depends(user_dependency)

    @router.post("/api/documents/{document_id}/source-versions", response_model=SourceVersion)
    def snapshot_pdf(document_id: UUID, body: PdfSnapshotRequest, user_id: str = User):
        document = documents.get_for_user(str(document_id), user_id)
        if document is None:
            raise NotFound("Source document not found")
        return store.save(user_id, pdf_snapshot(document, body))

    @router.get("/api/source-versions/{version_id}", response_model=SourceVersion)
    def get_version(version_id: UUID, user_id: str = User):
        record = store.get(user_id, str(version_id))
        if record is None:
            raise NotFound("Source version not found")
        return record

    @router.post("/api/source-versions/{version_id}/resolve", response_model=ResolvedEvidence)
    def resolve(version_id: UUID, body: EvidencePin, user_id: str = User):
        # Look up first so different-owner guesses do not reveal version existence.
        if store.get(user_id, str(version_id)) is None:
            raise NotFound("Source version not found")
        if version_id != body.version_id:
            raise InvalidInput("Evidence version does not match the requested source")
        return store.resolve(user_id, body)

    return router
