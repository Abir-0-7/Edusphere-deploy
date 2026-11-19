"""Core learning JSON wire contracts; mirrored in packages/types/src/learning-api.ts."""

from datetime import date
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator


class ErrorDetail(BaseModel):
    code: Literal[
        "invalid_input", "unauthorized", "not_found", "rate_limited", "file_too_large", "conflict", "internal"
    ]
    message: str
    details: Any = None


class ErrorEnvelope(BaseModel):
    error: ErrorDetail


# "default" prevents FastAPI from advertising its unused 422 error body:
# the application validation handler returns the shared 400 envelope instead.
LEARNING_ERRORS = {
    400: {"model": ErrorEnvelope, "description": "Invalid request"},
    401: {"model": ErrorEnvelope, "description": "Missing or invalid authentication"},
    404: {"model": ErrorEnvelope, "description": "Resource not found or not owned by caller"},
    429: {
        "model": ErrorEnvelope,
        "description": "AI usage limit reached",
        "headers": {
            "Retry-After": {"description": "Seconds until retry", "schema": {"type": "integer", "minimum": 1}},
        },
    },
    "default": {"description": "Unexpected service response; clients must also handle non-JSON errors"},
}


class ParsePdfResponse(BaseModel):
    job_id: UUID
    document_id: UUID


class JobResponse(BaseModel):
    id: UUID
    kind: str
    status: Literal["pending", "running", "done", "failed", "cancelled"]
    attempts: Annotated[int, Field(ge=0)]
    error_reason: str | None = None
    result: dict[str, Any] | None = None


class JobCancelResponse(BaseModel):
    id: UUID
    status: Literal["cancelled"]


class ChapterResponse(BaseModel):
    id: UUID
    title: str
    ordinal: Annotated[int, Field(ge=0)]
    start_page: Annotated[int, Field(gt=0)] | None
    end_page: Annotated[int, Field(gt=0)] | None


class FlashcardResponse(BaseModel):
    id: UUID
    front: str
    back: str
    ease_factor: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    interval_days: Annotated[int, Field(ge=0)]
    repetitions: Annotated[int, Field(ge=0)]
    due_date: date
    document_id: UUID | None = None
    chapter_id: UUID | None = None
    source_chunk_id: UUID | None = None
    tags: list[str] = Field(default_factory=list, max_length=20)
    status: Literal["active", "retired"] = "active"
    needs_review: bool = False


class FlashcardGenerationResponse(BaseModel):
    job_id: UUID


class FlashcardExplanationResponse(BaseModel):
    card_id: UUID
    explanation: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1200)]
    source_quote: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1600)]
    page: Annotated[int, Field(gt=0)] | None
    available: bool = True
    source_excerpt: str | None = None


class FlashcardEditRequest(BaseModel):
    front: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)] | None = None
    back: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)] | None = None
    tags: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]] | None = Field(
        default=None, max_length=20
    )

    @model_validator(mode="after")
    def has_change(self) -> "FlashcardEditRequest":
        if self.front is None and self.back is None and self.tags is None:
            raise ValueError("provide front, back or tags")
        if self.tags is not None and len(set(self.tags)) != len(self.tags):
            raise ValueError("tags must be unique")
        return self


class FlashcardReportRequest(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class FlashcardReportResponse(BaseModel):
    card_id: UUID
    report_id: UUID
    status: Literal["received"]


class FlashcardDeleteResponse(BaseModel):
    card_id: UUID
    deleted: bool


class ReviewRequest(BaseModel):
    grade: Annotated[int, Field(strict=True, ge=0, le=5)]
    review_id: UUID | None = None


class ReviewResult(BaseModel):
    id: UUID
    ease_factor: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    interval_days: Annotated[int, Field(ge=0)]
    repetitions: Annotated[int, Field(ge=0)]
    due_date: date
    replayed: bool | None = None


class ChatRequest(BaseModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class ChatCitationResponse(BaseModel):
    chunk_id: UUID
    page: Annotated[int, Field(gt=0)] | None
    quote: str


class ChatReply(BaseModel):
    answer: str
    citations: list[ChatCitationResponse]
