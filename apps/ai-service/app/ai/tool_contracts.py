"""Bounded HTTP input for the qualified static code reviewer."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

from app.ai.code_review import MAX_CODE_CHARS


class CodeReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=MAX_CODE_CHARS)]
    language: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, max_length=100)] = "unknown"
    context: Annotated[str, StringConstraints(strict=True, max_length=1500)] = ""

    @field_validator("code")
    @classmethod
    def nonblank_code(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("code is required")
        return value

    @field_validator("language")
    @classmethod
    def default_language(cls, value: str) -> str:
        return value or "unknown"
