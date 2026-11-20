"""Authenticated owner-scoped board and raster-asset APIs."""

from collections.abc import AsyncIterator, Callable
from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query, Response, status

from app.contracts import LEARNING_ERRORS, ErrorEnvelope
from app.errors import ApiError, Conflict, InvalidInput, NotFound, TooLarge
from app.llm.router import LLMRouter
from app.whiteboards.contracts import (
    MAX_ASSET_BYTES,
    MAX_SNAPSHOT_BYTES,
    BoardLearningPreview,
    BoardLearningRequest,
    WhiteboardAssetDeleteResponse,
    WhiteboardAssetListResponse,
    WhiteboardAssetResponse,
    WhiteboardAssetUpload,
    WhiteboardCreateRequest,
    WhiteboardDeleteResponse,
    WhiteboardListResponse,
    WhiteboardSnapshot,
    WhiteboardUpdateRequest,
)
from app.whiteboards.learning import preview_board_learning
from app.whiteboards.store import WhiteboardStore


def whiteboard_router(
    user_dependency: Callable[..., AsyncIterator[str]], store: WhiteboardStore, llm_router: LLMRouter | None = None,
) -> APIRouter:
    router = APIRouter(
        prefix="/api/whiteboards",
        tags=["Whiteboards"],
        responses={
            **LEARNING_ERRORS,
            409: {"model": ErrorEnvelope, "description": "Whiteboard revision or asset conflict"},
            503: {"model": ErrorEnvelope, "description": "Whiteboard storage is unavailable"},
        },
    )
    User = Annotated[str, Depends(user_dependency)]

    @router.get("", response_model=WhiteboardListResponse)
    def list_boards(
        user_id: User,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> WhiteboardListResponse:
        try:
            items, total = store.list_boards(user_id, limit=limit, offset=offset)
        except psycopg.Error as exc:
            raise ApiError("Whiteboard storage is temporarily unavailable", status_code=503) from exc
        return WhiteboardListResponse(items=items, limit=limit, offset=offset, total_count=total)

    @router.post("", response_model=WhiteboardSnapshot, status_code=status.HTTP_201_CREATED)
    def create_board(body: WhiteboardCreateRequest, user_id: User) -> WhiteboardSnapshot:
        if len(body.model_dump_json().encode("utf-8")) > MAX_SNAPSHOT_BYTES:
            raise TooLarge("Whiteboard snapshot is limited to 5 MiB.")
        try:
            return store.create_board(user_id, body.title, body.scene)
        except ValueError as exc:
            raise InvalidInput(str(exc)) from exc
        except psycopg.Error as exc:
            raise ApiError("Could not save this whiteboard", status_code=503) from exc

    @router.get("/{board_id}", response_model=WhiteboardSnapshot)
    def get_board(board_id: UUID, user_id: User) -> WhiteboardSnapshot:
        try:
            board = store.get_board(user_id, board_id)
        except psycopg.Error as exc:
            raise ApiError("Whiteboard storage is temporarily unavailable", status_code=503) from exc
        if board is None:
            raise NotFound("whiteboard not found")
        return board

    @router.post(
        "/{board_id}/learning-preview", response_model=BoardLearningPreview,
        responses={502: {"model": ErrorEnvelope, "description": "Invalid learning suggestion"}},
    )
    def learning_preview(board_id: UUID, body: BoardLearningRequest, user_id: User,
                         response: Response) -> BoardLearningPreview:
        response.headers["Cache-Control"] = "private, no-store"
        if llm_router is None:
            raise ApiError("Board learning suggestions are temporarily unavailable", status_code=503)
        try:
            return preview_board_learning(store, llm_router, user_id, board_id, body)
        except psycopg.Error as exc:
            raise ApiError("Whiteboard storage is temporarily unavailable", status_code=503) from exc

    @router.put("/{board_id}", response_model=WhiteboardSnapshot)
    def update_board(board_id: UUID, body: WhiteboardUpdateRequest, user_id: User) -> WhiteboardSnapshot:
        if len(body.model_dump_json().encode("utf-8")) > MAX_SNAPSHOT_BYTES:
            raise TooLarge("Whiteboard snapshot is limited to 5 MiB.")
        try:
            board = store.update_board(
                user_id,
                board_id,
                body.title,
                body.scene,
                expected_revision=body.expected_revision,
            )
        except Conflict:
            raise
        except ValueError as exc:
            raise InvalidInput(str(exc)) from exc
        except psycopg.Error as exc:
            raise ApiError("Could not update this whiteboard", status_code=503) from exc
        if board is None:
            raise NotFound("whiteboard not found")
        return board

    @router.delete("/{board_id}", response_model=WhiteboardDeleteResponse)
    def delete_board(board_id: UUID, user_id: User) -> WhiteboardDeleteResponse:
        try:
            deleted = store.delete_board(user_id, board_id)
        except psycopg.Error as exc:
            raise ApiError("Could not delete this whiteboard", status_code=503) from exc
        if not deleted:
            raise NotFound("whiteboard not found")
        return WhiteboardDeleteResponse(id=board_id)

    @router.get("/{board_id}/assets", response_model=WhiteboardAssetListResponse)
    def list_assets(board_id: UUID, user_id: User) -> WhiteboardAssetListResponse:
        try:
            assets = store.list_assets(user_id, board_id)
        except psycopg.Error as exc:
            raise ApiError("Whiteboard assets are temporarily unavailable", status_code=503) from exc
        if assets is None:
            raise NotFound("whiteboard not found")
        return WhiteboardAssetListResponse(assets=assets)

    @router.post("/{board_id}/assets", response_model=WhiteboardAssetResponse, status_code=status.HTTP_201_CREATED)
    def create_asset(board_id: UUID, body: WhiteboardAssetUpload, user_id: User) -> WhiteboardAssetResponse:
        if len(body.data_base64) > ((MAX_ASSET_BYTES + 2) // 3) * 4 + 4:
            raise TooLarge("Each whiteboard image is limited to 10 MiB.")
        try:
            data = body.decode_asset()
            asset = store.create_asset(user_id, board_id, body.file_id, body.mime_type, data)
        except Conflict:
            raise
        except ValueError as exc:
            raise InvalidInput(str(exc)) from exc
        except psycopg.errors.ForeignKeyViolation as exc:
            raise NotFound("whiteboard not found") from exc
        except psycopg.Error as exc:
            raise ApiError("Could not save this whiteboard image", status_code=503) from exc
        if asset is None:
            raise NotFound("whiteboard not found")
        return asset.response()

    @router.get("/{board_id}/assets/{asset_id}/content")
    def get_asset(board_id: UUID, asset_id: UUID, user_id: User) -> Response:
        try:
            asset = store.get_asset(user_id, board_id, asset_id)
        except psycopg.Error as exc:
            raise ApiError("Whiteboard image is temporarily unavailable", status_code=503) from exc
        if asset is None:
            raise NotFound("whiteboard asset not found")
        return Response(
            content=asset.data,
            media_type=asset.mime_type,
            headers={"ETag": f'"{asset.sha256}"', "Cache-Control": "private, no-store"},
        )

    @router.delete("/{board_id}/assets/{asset_id}", response_model=WhiteboardAssetDeleteResponse)
    def delete_asset(board_id: UUID, asset_id: UUID, user_id: User) -> WhiteboardAssetDeleteResponse:
        try:
            deleted = store.delete_asset(user_id, board_id, asset_id)
        except Conflict:
            raise
        except psycopg.Error as exc:
            raise ApiError("Could not delete this whiteboard image", status_code=503) from exc
        if deleted is None or deleted is False:
            raise NotFound("whiteboard asset not found")
        return WhiteboardAssetDeleteResponse(id=asset_id)

    return router
