"""Owner-only outline editing/approval, with no publication or generation action."""

from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query

from app.contracts import LEARNING_ERRORS, ErrorEnvelope
from app.course_outlines.contracts import (
    OutlineApprovalListResponse,
    OutlineApproveRequest,
    OutlineCreateRequest,
    OutlineDeleteResponse,
    OutlineListResponse,
    OutlineRecord,
    OutlineSourceListResponse,
    OutlineUpdateRequest,
)
from app.errors import ApiError, NotFound


def course_outline_router(user_dependency, store, source_versions, *, enabled=False) -> APIRouter:
    router = APIRouter(tags=["course-outlines"], responses={
        **LEARNING_ERRORS, 409: {"model": ErrorEnvelope, "description": "Outline revision or approval conflict"},
        503: {"model": ErrorEnvelope, "description": "Outline storage unavailable"},
    })
    User = Depends(user_dependency)

    def invoke(operation, *args, **kwargs):
        if not enabled:
            raise NotFound("Course outline planning is not enabled")
        try:
            return operation(*args, **kwargs)
        except psycopg.Error as exc:
            raise ApiError("Course outline storage is temporarily unavailable", status_code=503) from exc

    @router.get("/api/source-versions", response_model=OutlineSourceListResponse)
    def list_sources(user_id: str = User, limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0)):
        items, total = invoke(source_versions.list_summaries, user_id, limit=limit, offset=offset)
        return OutlineSourceListResponse(items=items, limit=limit, offset=offset, total_count=total)

    @router.get("/api/course-outlines", response_model=OutlineListResponse)
    def list_outlines(user_id: str = User, limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0)):
        return invoke(store.list, user_id, limit=limit, offset=offset)

    @router.post("/api/course-outlines", response_model=OutlineRecord)
    def create_outline(body: OutlineCreateRequest, user_id: str = User):
        return invoke(store.create, user_id, body)

    @router.get("/api/course-outlines/{outline_id}", response_model=OutlineRecord)
    def get_outline(outline_id: UUID, user_id: str = User):
        return invoke(store.get, user_id, str(outline_id))

    @router.put("/api/course-outlines/{outline_id}", response_model=OutlineRecord)
    def update_outline(outline_id: UUID, body: OutlineUpdateRequest, user_id: str = User):
        return invoke(store.update, user_id, str(outline_id), body)

    @router.post("/api/course-outlines/{outline_id}/approve", response_model=OutlineRecord)
    def approve_outline(outline_id: UUID, body: OutlineApproveRequest, user_id: str = User):
        return invoke(store.approve, user_id, str(outline_id), body)

    @router.get("/api/course-outlines/{outline_id}/approvals", response_model=OutlineApprovalListResponse)
    def list_approvals(outline_id: UUID, user_id: str = User):
        return invoke(store.history, user_id, str(outline_id))

    @router.delete("/api/course-outlines/{outline_id}", response_model=OutlineDeleteResponse)
    def delete_outline(outline_id: UUID, user_id: str = User):
        invoke(store.delete, user_id, str(outline_id))
        return OutlineDeleteResponse()

    return router
