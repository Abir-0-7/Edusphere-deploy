"""Schema-validated LLM outputs with retry (task 2.4).

Validate the model's JSON against a pydantic schema; on failure, re-ask once
with the validation error appended; then fail gracefully (caller treats it as
a failed job, which the job system retries).
"""

import json
import logging

from pydantic import BaseModel, Field, ValidationError

from app.llm.router import LLMRouter

logger = logging.getLogger("studyvault.ai")


class StructuredOutputError(Exception):
    pass


class ChapterOutline(BaseModel):
    title: str = Field(min_length=1)
    start_page: int = Field(ge=1)
    end_page: int = Field(ge=1)
    summary: str = ""


class ChapterOutlineList(BaseModel):
    chapters: list[ChapterOutline]


def complete_validated[T: BaseModel](
    router: LLMRouter,
    schema: type[T],
    system: str,
    user: str,
    max_attempts: int = 2,
) -> T:
    """Ask the LLM for JSON, validate against `schema`, retry once on failure."""
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    validation_error: str | None = None
    for attempt in range(max_attempts):
        content = router.complete(messages)
        parsed = _extract_json(content)
        if parsed is not None:
            try:
                return schema.model_validate(parsed)
            except ValidationError as exc:
                validation_error = str(exc)
                logger.warning("LLM output failed schema validation (attempt %d): %s", attempt + 1, validation_error)
        else:
            validation_error = "response was not valid JSON"
        # Re-ask with the error appended so the model can correct itself.
        messages = messages[:2] + [
            {"role": "assistant", "content": content},
            {
                "role": "user",
                "content": f"Your previous response was invalid: {validation_error}. "
                "Respond again with ONLY valid JSON matching the schema.",
            },
        ]
    raise StructuredOutputError(f"LLM output failed validation after {max_attempts} attempts: {validation_error}")


def _extract_json(content: str) -> object | None:
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip()
    try:
        return json.loads(text)
    except ValueError:
        # Tolerate prose around a JSON object.
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except ValueError:
                return None
        return None
