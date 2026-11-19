"""Isolated unsigned-token test service used only by the C04 Playwright fixture."""

from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, Header
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.courses.store import MemoryCourseStore
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, Unauthorized, api_error_handler, error_body
from app.learners.contracts import LearnerProfileInput
from app.learners.store import MemoryLearnerStore
from app.learners.track_routes import track_progress, track_router
from app.learners.track_store import MemoryTrackPlanStore

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:4324"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["authorization", "content-type", "idempotency-key"],
)
app.add_exception_handler(ApiError, api_error_handler)


@app.exception_handler(RequestValidationError)
async def validation_error(_, __):
    return JSONResponse(status_code=400, content=error_body("Invalid request", "invalid_input"))


profiles = MemoryLearnerStore()
plans = MemoryTrackPlanStore()
courses = MemoryCourseStore(InMemoryDocumentStore())
_created: set[str] = set()


async def fixture_user(authorization: Annotated[str | None, Header()] = None):
    if authorization is None or not authorization.startswith("Bearer track-fixture-"):
        raise Unauthorized()
    user_id = authorization.removeprefix("Bearer ")
    if user_id not in _created:
        profiles.save(
            user_id,
            LearnerProfileInput.model_validate(
                {
                    "goal_kind": "career",
                    "goal": "Become a developer",
                    "familiarity": "some",
                    "weekly_minutes": 90,
                    "deadline": None,
                    "language": "en",
                    "accessibility": {
                        "reduced_motion": False,
                        "larger_text": False,
                        "text_alternative": False,
                    },
                }
            ),
        )
        release = courses.get_release("python-foundations", user_id)
        session = courses.enroll(user_id, release.slug)
        checkpoint = next(item for item in release.exercises if item.id == session.lesson.checkpoint.id)
        courses.action(
            user_id,
            str(session.id),
            "attempt",
            {
                "id": str(uuid4()),
                "exercise_id": checkpoint.id,
                "revision": session.revision,
                "answer": checkpoint.answer,
            },
        )
        _created.add(user_id)
    return user_id


user_dependency = Depends(fixture_user)
app.include_router(
    track_router(
        fixture_user,
        profiles,
        plans,
        lambda user_id: track_progress(courses, user_id),
    )
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
