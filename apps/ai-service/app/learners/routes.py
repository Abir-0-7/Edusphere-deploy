"""Authenticated profile routes, using the existing resolved-user dependency."""

from collections.abc import AsyncIterator, Callable
from typing import Annotated

import psycopg
from fastapi import APIRouter, Depends

from app.errors import ApiError, NotFound
from app.learners.contracts import (
    LearnerDiagnosticDefinition,
    LearnerDiagnosticRequest,
    LearnerProfileInput,
    LearnerProfileResponse,
)
from app.learners.diagnostic import DEFINITION, assess
from app.learners.store import LearnerStore


def profile_router(user_dependency: Callable[..., AsyncIterator[str]], store: LearnerStore) -> APIRouter:
    router = APIRouter(
        prefix="/api/learner-profile",
        tags=["Learner profile"],
        responses={503: {"description": "Profile storage is unavailable"}},
    )
    # FastAPI resolves this runtime dependency without duplicating auth or accepting user IDs.
    User = Annotated[str, Depends(user_dependency)]

    @router.get("", response_model=LearnerProfileResponse)
    def get_profile(user_id: User) -> LearnerProfileResponse:
        try:
            return LearnerProfileResponse(profile=store.get(user_id))
        except psycopg.Error as exc:
            raise ApiError("Learner profile is temporarily unavailable", status_code=503) from exc

    @router.put("", response_model=LearnerProfileResponse)
    def save_profile(body: LearnerProfileInput, user_id: User) -> LearnerProfileResponse:
        try:
            return LearnerProfileResponse(profile=store.save(user_id, body))
        except psycopg.Error as exc:
            raise ApiError("Could not save your profile; please retry", status_code=503) from exc

    @router.get("/diagnostic", response_model=LearnerDiagnosticDefinition)
    def diagnostic_definition(user_id: User) -> LearnerDiagnosticDefinition:
        return DEFINITION

    @router.post("/diagnostic", response_model=LearnerProfileResponse)
    def submit_diagnostic(body: LearnerDiagnosticRequest, user_id: User) -> LearnerProfileResponse:
        result = assess(body)
        try:
            profile = store.diagnose(user_id, result)
        except psycopg.Error as exc:
            raise ApiError("Could not save your starting check; please retry", status_code=503) from exc
        if profile is None:
            raise NotFound("Save your learning profile before the optional diagnostic")
        return LearnerProfileResponse(profile=profile)

    return router
