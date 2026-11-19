"""Local Playwright server for the Python/PyTorch course journeys."""

import os

os.environ.update(
    AI_SERVICE_JOB_STORE="memory",
    AI_SERVICE_WORKER_ENABLED="false",
    AI_SERVICE_JWT_DEV_MODE="true",
    AI_SERVICE_JWT_JWKS_URL="http://127.0.0.1:4325/no-jwks",
    AI_SERVICE_DATABASE_URL="postgresql://fixture:fixture@127.0.0.1:1/fixture",
    AI_SERVICE_CORS_ORIGINS="http://127.0.0.1:4324",
    AI_SERVICE_EMBEDDING_BACKEND="hash",
    AI_SERVICE_OCR_ENABLED="false",
    AI_SERVICE_SENTRY_DSN="",
    AI_SERVICE_LLM_PROVIDER_ORDER="logfare",
    AI_SERVICE_LLM_LOGFARE_BASE_URL="http://127.0.0.1:1/no-provider",
    AI_SERVICE_LLM_LOGFARE_MODELS="fixture",
    AI_SERVICE_LLM_LOGFARE_API_KEY="",
)

from app.courses.catalog import catalog  # noqa: E402
from app.courses.contracts import CourseRelease  # noqa: E402
from app.main import (  # noqa: E402
    app,  # noqa: F401 - re-export the isolated fixture app to uvicorn.
    course_store,
)

# Test-only publication so the browser journey can exercise an approved release.
for release in catalog():
    course_store.save_release(
        CourseRelease.model_validate(
            {**release.model_dump(mode="json"), "status": "published", "visibility": "catalog"}
        )
    )
