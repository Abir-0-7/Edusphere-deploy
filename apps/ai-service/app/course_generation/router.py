"""Owner-only preview, progress, cancellation and bounded explicit resume."""

from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query

from app.contracts import LEARNING_ERRORS, ErrorEnvelope
from app.course_generation.contracts import (
    GenerationActionRequest,
    GenerationApprovalRef,
    GenerationListResponse,
    GenerationPreview,
    GenerationResumeRequest,
    GenerationRun,
    GenerationStartRequest,
)
from app.errors import ApiError, NotFound


def course_generation_router(user_dependency, service, *, enabled=False):
    router = APIRouter(tags=["course-generation"], responses={
        **LEARNING_ERRORS, 409: {"model": ErrorEnvelope, "description": "Generation revision or policy conflict"},
        503: {"model": ErrorEnvelope, "description": "Generation storage unavailable"},
    })
    User = Depends(user_dependency)

    def invoke(operation, *args, **kwargs):
        if not enabled:
            raise NotFound("Course module generation is not enabled")
        try:
            return operation(*args, **kwargs)
        except psycopg.Error as exc:
            raise ApiError("Course generation storage is temporarily unavailable", status_code=503) from exc

    @router.post("/api/course-generations/preview", response_model=GenerationPreview)
    def preview(body: GenerationApprovalRef, user_id: str = User):
        return invoke(service.preview, user_id, body)

    @router.post("/api/course-generations", response_model=GenerationRun)
    def start(body: GenerationStartRequest, user_id: str = User):
        return invoke(service.start, user_id, body)

    @router.get("/api/course-generations", response_model=GenerationListResponse)
    def list_runs(user_id: str = User, limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0)):
        return invoke(service.store.list, user_id, limit=limit, offset=offset)

    @router.get("/api/course-generations/{generation_id}", response_model=GenerationRun)
    def get_run(generation_id: UUID, user_id: str = User):
        return invoke(service.get, user_id, str(generation_id))

    @router.post("/api/course-generations/{generation_id}/cancel", response_model=GenerationRun)
    def cancel(generation_id: UUID, body: GenerationActionRequest, user_id: str = User):
        return invoke(service.cancel, user_id, str(generation_id), body)

    @router.post("/api/course-generations/{generation_id}/resume", response_model=GenerationRun)
    def resume(generation_id: UUID, body: GenerationResumeRequest, user_id: str = User):
        return invoke(service.resume, user_id, str(generation_id), body)

    return router
