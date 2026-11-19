"""Export implemented learning, tool, progress and streaming contracts. JSON is valid YAML 1.2.

Run from apps/ai-service: python -m scripts.export_openapi
Uses the in-memory test configuration; does not connect to providers or databases.
"""

import json
import os
import re
from pathlib import Path
from typing import Any

CORE_PATHS = (
    "/api/bibliography",
    "/api/bibliography/{item_id}",
    "/api/bibliography/library-documents",
    "/api/learner-profile",
    "/api/learner-profile/diagnostic",
    "/api/learner-profile/track-plan",
    "/api/learner-profile/track-plan/options",
    "/api/learner-profile/track-plan/history",
    "/api/learner-profile/track-plan/preview",
    "/api/learner-profile/track-plan/apply",
    "/api/learner-profile/recommendations",
    "/api/parse-pdf",
    "/api/jobs/{job_id}",
    "/api/jobs/{job_id}/cancel",
    "/api/courses",
    "/api/courses/{slug}",
    "/api/courses/{slug}/diagnostic",
    "/api/courses/{slug}/enroll",
    "/api/course-enrollments",
    "/api/course-enrollments/{enrollment_id}",
    "/api/course-enrollments/{enrollment_id}/attempts",
    "/api/course-enrollments/{enrollment_id}/assistance",
    "/api/course-enrollments/{enrollment_id}/advance",
    "/api/course-enrollments/{enrollment_id}/study-notes",
    "/api/course-enrollments/{enrollment_id}/assignments",
    "/api/course-enrollments/{enrollment_id}/labs",
    "/api/course-enrollments/{enrollment_id}/tutor",
    "/api/course-enrollments/{enrollment_id}/tutor/stream",
    "/api/documents/{document_id}/concept-graph",
    "/api/documents/{document_id}/concept-graph/import",
    "/api/documents/{document_id}/concept-graph/regenerate",
    "/api/documents/{document_id}/concept-graph/nodes/{node_id}/actions",
    "/api/documents/{document_id}/chapters",
    "/api/documents/{document_id}/flashcards",
    "/api/documents/{document_id}/flashcard-quizzes",
    "/api/documents/{document_id}/flashcard-decks/{deck_id}/export.csv",
    "/api/documents/{document_id}/flashcard-studio/drafts",
    "/api/documents/{document_id}/flashcard-studio/drafts/{draft_id}",
    "/api/documents/{document_id}/flashcard-studio/drafts/{draft_id}/merge",
    "/api/documents/{document_id}/flashcard-studio/decks",
    "/api/flashcards/review-queue",
    "/api/flashcards/{card_id}/explain",
    "/api/flashcards/{card_id}",
    "/api/flashcards/{card_id}/retire",
    "/api/flashcards/{card_id}/report",
    "/api/flashcards/{card_id}/review",
    "/api/flashcard-quizzes/{session_id}",
    "/api/flashcard-quizzes/{session_id}/grade",
    "/api/documents/{document_id}/chat",
    "/api/chapters/{chapter_id}/summary",
    "/api/focus-sessions",
    "/api/focus-sessions/current",
    "/api/focus-sessions/{session_id}/complete",
    "/api/tokens/balance",
    "/api/dashboard",
    "/api/readiness",
    "/api/documents/{document_id}/study-plan",
    "/api/advice/weekly",
    "/api/tts",
    "/api/tts/stream",
    "/api/documents/{document_id}/viva-questions",
    "/api/viva-grade",
    "/api/documents/{document_id}/mindmap",
    "/api/code-review",
    "/api/citations",
)


def core_openapi(spec: dict[str, Any]) -> dict[str, Any]:
    """Keep the referenced schema closure, so every documented model is executable."""
    paths = {path: spec["paths"][path] for path in CORE_PATHS if path in spec["paths"]}
    names = set(re.findall(r'"\$ref": "#/components/schemas/([^\"]+)"', json.dumps(paths)))
    schemas = {}
    while names:
        name = names.pop()
        if name in schemas:
            continue
        schemas[name] = spec["components"]["schemas"][name]
        names.update(re.findall(r'"\$ref": "#/components/schemas/([^\"]+)"', json.dumps(schemas[name])))
    return {
        "openapi": spec["openapi"],
        "info": {
            "title": "StudyVault learning and study tools API",
            "version": "0.1.0",
            "description": (
                "Generated from FastAPI response/request models with python -m scripts.export_openapi. "
                "Scope: learner profiles, optional diagnostics, learning JSON, summary/TTS streams, "
                "focus, progress, plans, bibliography records and academic tools. "
                "Named/data SSE event payloads are documented in x-event-schemas. "
                "Health and privacy export remain in the runtime /openapi.json. "
                "Requests are authenticated with a Clerk bearer token."
            ),
        },
        "security": [{"ClerkBearer": []}],
        "paths": paths,
        "x-event-schemas": {
            "course-tutor-stream": {
                "mediaType": "text/event-stream",
                "events": {
                    "token": {"text": "string"},
                    "done": "CourseChatResponse",
                    "error": "ErrorEnvelope",
                },
                "cancellation": "Disconnect aborts provider generation; incomplete turns are not persisted.",
            }
        },
        "components": {
            "securitySchemes": {"ClerkBearer": {"type": "http", "scheme": "bearer"}},
            "schemas": dict(sorted(schemas.items())),
        },
    }


if __name__ == "__main__":
    # Pin the same isolated configuration used by pytest before importing the app.
    os.environ["AI_SERVICE_JOB_STORE"] = "memory"
    os.environ["AI_SERVICE_WORKER_ENABLED"] = "false"
    os.environ["AI_SERVICE_EMBEDDING_BACKEND"] = "hash"
    os.environ["AI_SERVICE_OCR_ENABLED"] = "false"
    os.environ["AI_SERVICE_SENTRY_DSN"] = ""
    os.environ["AI_SERVICE_DATABASE_URL"] = "postgresql://test:test@localhost:5432/test"
    os.environ["AI_SERVICE_JWT_JWKS_URL"] = "http://localhost/test-jwks"
    os.environ["AI_SERVICE_LLM_LOGFARE_BASE_URL"] = "https://primary.test/v1"
    os.environ["AI_SERVICE_LLM_LOGFARE_MODELS"] = "test-model"
    os.environ["AI_SERVICE_LLM_PROVIDER_ORDER"] = "logfare,groq"
    from app.main import app

    target = Path(__file__).resolve().parents[3] / "docs" / "openapi.yaml"
    target.write_text(json.dumps(core_openapi(app.openapi()), indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(CORE_PATHS)} core paths to {target}")
