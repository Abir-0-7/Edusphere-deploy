"""Wire contracts for source-grounded quiz sessions."""

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class QuizContract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QuizStartRequest(QuizContract):
    deck_id: UUID
    count: Annotated[int, Field(strict=True, ge=1, le=20)] = 10


class QuizChoice(QuizContract):
    id: UUID
    text: Annotated[str, Field(min_length=1, max_length=600)]


class QuizQuestion(QuizContract):
    id: UUID
    prompt: Annotated[str, Field(min_length=1, max_length=300)]
    choices: list[QuizChoice] = Field(min_length=2, max_length=4)

    @model_validator(mode="after")
    def unique_choices(self):
        if len({choice.id for choice in self.choices}) != len(self.choices):
            raise ValueError("Quiz choice IDs must be unique")
        return self


class QuizSession(QuizContract):
    id: UUID
    document_id: UUID
    deck_id: UUID
    questions: list[QuizQuestion] = Field(min_length=1, max_length=20)


class QuizAnswer(QuizContract):
    question_id: UUID
    choice_id: UUID


class QuizGradeRequest(QuizContract):
    answers: list[QuizAnswer] = Field(max_length=20)

    @model_validator(mode="after")
    def unique_questions(self):
        if len({answer.question_id for answer in self.answers}) != len(self.answers):
            raise ValueError("Each quiz question may be answered once")
        return self


class QuizFeedback(QuizContract):
    question_id: UUID
    answered: bool
    correct: bool
    source_quote: Annotated[str, Field(min_length=1, max_length=1600)]
    page: Annotated[int, Field(strict=True, ge=1)] | None


class QuizGradeResult(QuizContract):
    session_id: UUID
    answered: Annotated[int, Field(strict=True, ge=0, le=20)]
    correct: Annotated[int, Field(strict=True, ge=0, le=20)]
    total: Annotated[int, Field(strict=True, ge=1, le=20)]
    percent: Annotated[int, Field(strict=True, ge=0, le=100)]
    feedback: list[QuizFeedback] = Field(min_length=1, max_length=20)

