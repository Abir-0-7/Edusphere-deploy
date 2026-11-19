"""Owner-scoped deck and draft endpoints."""

from collections.abc import AsyncIterator, Callable
from typing import Any, Protocol
from uuid import UUID

from fastapi import APIRouter, Depends

from app.contracts import LEARNING_ERRORS, ErrorEnvelope
from app.documents.store import DocumentRecord
from app.errors import InvalidInput, NotFound
from app.flashcard_studio.contracts import (
    DeckSummary,
    GenerationDraft,
    GenerationQueued,
    GenerationSettings,
    MergeDraftRequest,
    MergeResult,
)
from app.flashcard_studio.service import STUDIO_JOB, DraftWriter, prompt_input
from app.flashcard_studio.source import source_revision, validate_evidence
from app.jobs.worker import Job


class StudioStore(DraftWriter, Protocol):
    def list_decks(self, document_id: str, user_id: str) -> list[DeckSummary]: ...
    def merge_draft(self, document_id: str, user_id: str, draft_id: str, request: MergeDraftRequest) -> MergeResult: ...


def create_studio_router(
    get_user_id: Callable[..., AsyncIterator[str]],
    store: StudioStore,
    get_document: Callable[[str, str], DocumentRecord | None],
    enqueue: Callable[[str, dict[str, Any]], str],
    get_job: Callable[[str, str], Job | None],
    max_input_chars: int,
) -> APIRouter:
    router = APIRouter(
        prefix="/api/documents/{document_id}/flashcard-studio",
        tags=["flashcard-studio"],
        responses={**LEARNING_ERRORS, 409: {"model": ErrorEnvelope, "description": "Draft or source has changed"}},
    )
    user_dependency = Depends(get_user_id)

    def require_finished_draft(document_id: str, user_id: str, draft_id: str) -> None:
        job = get_job(draft_id, user_id)
        if (
            job is None or job.kind != STUDIO_JOB or job.status != "done"
            or job.payload.get("document_id") != document_id
        ):
            raise NotFound("Flashcard draft not found")

    @router.post("/drafts", status_code=202, response_model=GenerationQueued)
    def queue_draft(
        document_id: UUID,
        settings: GenerationSettings,
        user_id: str = user_dependency,
    ) -> GenerationQueued:
        doc = get_document(str(document_id), user_id)
        if doc is None:
            raise NotFound("Source not found")
        revision = source_revision(doc, settings)
        prompt_input(doc, settings, max_input_chars)
        job_id = UUID(enqueue(STUDIO_JOB, {
            "document_id": doc.id,
            "user_id": user_id,
            "source_revision": revision,
            "settings": settings.model_dump(mode="json"),
        }))
        return GenerationQueued(job_id=job_id, draft_id=job_id)

    @router.get("/drafts/{draft_id}", response_model=GenerationDraft)
    def get_draft(document_id: UUID, draft_id: UUID, user_id: str = user_dependency) -> GenerationDraft:
        source_id = str(document_id)
        require_finished_draft(source_id, user_id, str(draft_id))
        draft = store.get_draft(source_id, user_id, str(draft_id))
        doc = get_document(source_id, user_id)
        if doc is None:
            raise NotFound("Source not found")
        if source_revision(doc, draft.settings) != draft.source_revision:
            raise InvalidInput("The source changed; generate a new draft before reviewing these cards", status_code=409)
        validate_evidence(doc, draft.cards)
        return draft

    @router.post("/drafts/{draft_id}/merge", response_model=MergeResult)
    def merge_draft(
        document_id: UUID, draft_id: UUID, request: MergeDraftRequest, user_id: str = user_dependency
    ) -> MergeResult:
        require_finished_draft(str(document_id), user_id, str(draft_id))
        return store.merge_draft(str(document_id), user_id, str(draft_id), request)

    @router.get("/decks", response_model=list[DeckSummary])
    def list_decks(document_id: UUID, user_id: str = user_dependency) -> list[DeckSummary]:
        return store.list_decks(str(document_id), user_id)

    return router
