"""F05 localhost acceptance of the approved repository release; no deployment."""

import json
import os
from pathlib import Path

os.environ.update(
    AI_SERVICE_JOB_STORE="memory", AI_SERVICE_WORKER_ENABLED="false", AI_SERVICE_JWT_DEV_MODE="true",
    AI_SERVICE_JWT_JWKS_URL="http://127.0.0.1:4338/no-jwks",
    AI_SERVICE_DATABASE_URL="postgresql://fixture:fixture@127.0.0.1:1/fixture",
    AI_SERVICE_CORS_ORIGINS="http://127.0.0.1:4337", AI_SERVICE_EMBEDDING_BACKEND="hash",
    AI_SERVICE_OCR_ENABLED="false", AI_SERVICE_SENTRY_DSN="", AI_SERVICE_LLM_PROVIDER_ORDER="logfare",
    AI_SERVICE_LLM_LOGFARE_BASE_URL="http://127.0.0.1:1/no-provider",
    AI_SERVICE_LLM_LOGFARE_MODELS="fixture", AI_SERVICE_LLM_LOGFARE_API_KEY="",
)

from app.courses.catalog import DIAGNOSTIC  # noqa: E402
from app.courses.full_course_release import practical_python_release  # noqa: E402
from app.courses.store import MemoryCourseStore  # noqa: E402
from app.main import app, course_store  # noqa: E402,F401

assert isinstance(course_store, MemoryCourseStore)
release = practical_python_release()
assert course_store.get_release(release.slug, "fixture-catalog-check").content_hash() == release.content_hash()

# Private test-driver vectors remain on disk. Learner HTTP responses still redact
# every answer key. Tests exercise UI/progression, not independent editorial review.
folder = Path(__file__).resolve().parents[2] / "web/.tmp-playwright/f05"
folder.mkdir(parents=True, exist_ok=True)
(folder / "keys.json").write_text(json.dumps({
    "slug": release.slug, "title": release.title,
    "lessons": [{"id": lesson.id, "title": lesson.title, "practice_ids": lesson.practice_ids,
                 "checkpoint_ids": lesson.checkpoint_ids} for lesson in release.lessons],
    "exercises": [{"id": exercise.id, "answer": exercise.answer} for exercise in release.exercises],
    "sections": release.assignments[0].model_dump(mode="json")["sections"],
    "diagnostic": [{"id": identifier, "prompt": prompt, "answer": answer}
                   for identifier, (prompt, answer) in DIAGNOSTIC.items()],
}, ensure_ascii=False), encoding="utf-8")
