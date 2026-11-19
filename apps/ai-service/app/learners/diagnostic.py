"""Original static Python tracing questions; no model calls or code execution.

One brief answer is a starting signal, never independent mastery evidence.
This module's private keys are never part of the learner definition response.
"""

from datetime import UTC, datetime
from typing import Literal

from app.errors import InvalidInput
from app.learners.contracts import (
    DiagnosticSkill,
    LearnerDiagnosticDefinition,
    LearnerDiagnosticRequest,
    LearnerDiagnosticSummary,
)

DEFINITION = LearnerDiagnosticDefinition(
    title="Optional Python starting check",
    description=(
        "Three short tracing questions for learners considering Python. Leave any question unanswered or skip. "
        "Results only describe a starting point; they do not prove mastery or complete course prerequisites."
    ),
    questions=[
        {
            "id": "expression-v1",
            "skill_id": "python-expressions",
            "prompt": "In Python, what is the value of 2 + 3 * 4?",
            "choices": [{"id": "a", "label": "20"}, {"id": "b", "label": "14"}, {"id": "c", "label": "24"}],
        },
        {
            "id": "loop-v1",
            "skill_id": "python-loops",
            "prompt": (
                "What is total after this Python code?\ntotal = 0\nfor value in [2, 4]:\n    total = total + value"
            ),
            "choices": [{"id": "a", "label": "6"}, {"id": "b", "label": "4"}, {"id": "c", "label": "2"}],
        },
        {
            "id": "function-v1",
            "skill_id": "python-functions",
            "prompt": (
                "What is result after this Python code?\n"
                "def double(value):\n    return value * 2\nresult = double(3) + 1"
            ),
            "choices": [{"id": "a", "label": "8"}, {"id": "b", "label": "6"}, {"id": "c", "label": "7"}],
        },
    ],
)
_ANSWER_KEYS = {"expression-v1": "b", "loop-v1": "a", "function-v1": "c"}


def unknown_diagnostic(status: Literal["not_started", "skipped"] = "not_started") -> LearnerDiagnosticSummary:
    return LearnerDiagnosticSummary(
        status=status,
        skills=[DiagnosticSkill(skill_id=question.skill_id, state="unknown") for question in DEFINITION.questions],
        completed_at=None,
    )


def assess(body: LearnerDiagnosticRequest) -> LearnerDiagnosticSummary:
    if body.action == "skip":
        return unknown_diagnostic("skipped")
    questions = {question.id: question for question in DEFINITION.questions}
    answers = {}
    for answer in body.answers:
        question = questions.get(answer.question_id)
        if question is None or (
            answer.choice_id is not None and answer.choice_id not in {choice.id for choice in question.choices}
        ):
            raise InvalidInput("unknown diagnostic question or choice")
        answers[answer.question_id] = answer.choice_id
    return LearnerDiagnosticSummary(
        status="completed",
        skills=[
            DiagnosticSkill(
                skill_id=question.skill_id,
                state=(
                    "unknown"
                    if answers.get(question.id) is None
                    else "developing"
                    if answers[question.id] == _ANSWER_KEYS[question.id]
                    else "needs_practice"
                ),
            )
            for question in DEFINITION.questions
        ],
        completed_at=datetime.now(UTC),
    )
