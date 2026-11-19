"""Authenticated owner-scoped bibliography REST routes."""

from collections.abc import AsyncIterator, Callable
from typing import Annotated, Protocol
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query, status

from app.bibliography.contracts import (
    BibliographyDeleteResponse,
    BibliographyItemInput,
    BibliographyItemResponse,
    BibliographyItemUpdate,
    BibliographyListResponse,
    LibraryDocumentListResponse,
    LibraryDocumentResponse,
)
from app.bibliography.store import BibliographyStore
from app.contracts import LEARNING_ERRORS, ErrorEnvelope
from app.errors import ApiError, Conflict, InvalidInput, NotFound


class OwnedDocumentStore(Protocol):
    def list_library_documents(
        self, user_id: str, *, limit: int, offset: int
    ) -> tuple[list[dict[str, str]], int]: ...
    def owns_document(self, document_id: str, user_id: str) -> bool: ...


def bibliography_router(
    user_dependency: Callable[..., AsyncIterator[str]],
    store: BibliographyStore,
    documents: OwnedDocumentStore,
) -> APIRouter:
    router = APIRouter(
        prefix="/api/bibliography",
        tags=["Academic bibliography"],
        responses={
            **LEARNING_ERRORS,
            409: {"model": ErrorEnvelope, "description": "Item revision conflict"},
            503: {"model": ErrorEnvelope, "description": "Bibliography storage is unavailable"},
        },
    )
    User = Annotated[str, Depends(user_dependency)]

    @router.get("", response_model=BibliographyListResponse)
    def list_items(
        user_id: User,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> BibliographyListResponse:
        try:
            items, total = store.list_items(user_id, limit=limit, offset=offset)
        except psycopg.Error as exc:
            raise ApiError("Bibliography storage is temporarily unavailable", status_code=503) from exc
        return BibliographyListResponse(items=items, limit=limit, offset=offset, total_count=total)

    @router.post("", response_model=BibliographyItemResponse, status_code=status.HTTP_201_CREATED)
    def create_item(body: BibliographyItemInput, user_id: User) -> BibliographyItemResponse:
        if body.source_document_id is not None and not documents.owns_document(str(body.source_document_id), user_id):
            raise NotFound("linked library document not found")
        try:
            return store.create_item(user_id, body)
        except psycopg.errors.ForeignKeyViolation as exc:
            raise NotFound("linked library document not found") from exc
        except ValueError as exc:
            raise InvalidInput(str(exc)) from exc
        except psycopg.Error as exc:
            raise ApiError("Could not save bibliography item", status_code=503) from exc

    @router.get("/library-documents", response_model=LibraryDocumentListResponse)
    def list_library_documents(
        user_id: User,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> LibraryDocumentListResponse:
        try:
            rows, total = documents.list_library_documents(user_id, limit=limit, offset=offset)
        except psycopg.Error as exc:
            raise ApiError("Library is temporarily unavailable", status_code=503) from exc
        return LibraryDocumentListResponse(
            documents=[LibraryDocumentResponse.model_validate(row) for row in rows],
            limit=limit,
            offset=offset,
            total_count=total,
        )

    @router.get("/{item_id}", response_model=BibliographyItemResponse)
    def get_item(item_id: UUID, user_id: User) -> BibliographyItemResponse:
        try:
            row = store.get_item(user_id, item_id)
        except psycopg.Error as exc:
            raise ApiError("Bibliography storage is temporarily unavailable", status_code=503) from exc
        if row is None:
            raise NotFound("bibliography item not found")
        return row

    @router.put("/{item_id}", response_model=BibliographyItemResponse)
    def update_item(item_id: UUID, body: BibliographyItemUpdate, user_id: User) -> BibliographyItemResponse:
        if body.source_document_id is not None and not documents.owns_document(str(body.source_document_id), user_id):
            raise NotFound("linked library document not found")
        payload = BibliographyItemInput.model_validate(body.model_dump(exclude={"expected_revision"}))
        try:
            row = store.update_item(
                user_id, item_id, payload, expected_revision=body.expected_revision
            )
        except Conflict:
            raise
        except psycopg.errors.ForeignKeyViolation as exc:
            raise NotFound("linked library document not found") from exc
        except psycopg.Error as exc:
            raise ApiError("Could not update bibliography item", status_code=503) from exc
        if row is None:
            raise NotFound("bibliography item not found")
        return row

    @router.delete("/{item_id}", response_model=BibliographyDeleteResponse)
    def delete_item(item_id: UUID, user_id: User) -> BibliographyDeleteResponse:
        try:
            deleted = store.delete_item(user_id, item_id)
        except psycopg.Error as exc:
            raise ApiError("Could not delete bibliography item", status_code=503) from exc
        if not deleted:
            raise NotFound("bibliography item not found")
        return BibliographyDeleteResponse(id=item_id)

    return router
