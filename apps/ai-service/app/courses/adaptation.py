"""Small deterministic authored overlays; the pinned course remains canonical.

Only approved examples and presentation cues vary. Objective IDs, source evidence,
facts, exercise definitions, answer keys and rubrics always come from the release.
No user text is evaluated and this module never executes a learner program.
"""

from typing import Literal

from app.courses.catalog import stable_id
from app.courses.contracts import (
    Exercise,
    ExerciseKey,
    LearningAdaptation,
    ObjectiveAdaptation,
    RemediationView,
    SessionResponse,
)

Role = Literal["analyst", "developer"]
Depth = Literal["guided", "standard", "concise"]
Pace = Literal["short_sessions", "standard"]
PYTHON_RELEASE_ID = stable_id("python-foundations/release/2")
REMEDIATION_ERROR_LIMIT = 2


def infer_role(goal: str, goal_kind: str = "career") -> Role:
    """Choose only between authored contexts based on explicit goal wording."""
    words = set("".join(char.lower() if char.isalnum() else " " for char in goal).split())
    if words & {"analyst", "analysis", "data", "research", "academic", "exam", "student"}:
        return "analyst"
    if words & {"developer", "engineer", "software", "backend", "programmer"}:
        return "developer"
    return "analyst" if goal_kind == "academic" else "developer"


# Example calculations intentionally share inputs and results across roles so
# context changes cannot silently alter what an objective means.
_VARIANTS: dict[str, dict[Role, tuple[str, str, str]]] = {
    "py-values-objective": {
        "analyst": (
            "Count items in grouped orders",
            "orders = 4 * 3 + 2\n# Four groups of three, then two loose items: 14.",
            "Four equal groups contribute twelve items; the two extras make fourteen.",
        ),
        "developer": (
            "Count packets in grouped batches",
            "packets = 4 * 3 + 2\n# Four batches of three, then two loose packets: 14.",
            "Four equal batches contribute twelve packets; the two extras make fourteen.",
        ),
    },
    "py-branches-objective": {
        "analyst": (
            "Classify a score at the readiness boundary",
            "score = 60\nif score >= 60:\n    band = 'ready'\nelse:\n    band = 'practice'\n# band is 'ready'.",
            "The inclusive comparison >= makes a score of exactly 60 ready.",
        ),
        "developer": (
            "Classify a response at the same threshold",
            "response_score = 60\nif response_score >= 60:\n    band = 'ready'\n"
            "else:\n    band = 'practice'\n# band is 'ready'.",
            "The inclusive comparison >= makes a score of exactly 60 ready.",
        ),
    },
    "py-loops-objective": {
        "analyst": (
            "Accumulate ordered daily readings",
            "readings = [2, 3, 4]\ntotal = 0\nfor value in readings:\n    total += value\n# total is 9.",
            "The accumulator is zero, then becomes 2, 5, and 9 in list order.",
        ),
        "developer": (
            "Accumulate ordered retry delays",
            "retry_delays = [2, 3, 4]\ntotal = 0\nfor delay in retry_delays:\n    total += delay\n# total is 9.",
            "The accumulator is zero, then becomes 2, 5, and 9 in list order.",
        ),
    },
    "py-functions-objective": {
        "analyst": (
            "Calculate an invoice amount with a function",
            "def add_fee(price, fee):\n    return price + fee\n\ninvoice = add_fee(12, 3)\n# invoice is 15.",
            "The arguments bind to price and fee, and return passes their sum to the caller.",
        ),
        "developer": (
            "Calculate a timeout with a function",
            "def add_timeout(base, extra):\n    return base + extra\n\n"
            "request_timeout = add_timeout(12, 3)\n# request_timeout is 15.",
            "The arguments bind to base and extra, and return passes their sum to the caller.",
        ),
    },
    "py-records-objective": {
        "analyst": (
            "Sum paid order amounts",
            'orders = [{"paid": True, "amount": 7}, {"paid": False, "amount": 5}, {"paid": True, "amount": 4}]\n'
            'total = 0\nfor order in orders:\n    if order["paid"]:\n        total += order["amount"]\n# total is 11.',
            "The condition includes the first and third orders, so 7 + 4 is 11.",
        ),
        "developer": (
            "Sum authorized request amounts",
            'requests = [{"authorized": True, "amount": 7}, {"authorized": False, "amount": 5},\n'
            '            {"authorized": True, "amount": 4}]\n'
            'total = 0\nfor request in requests:\n    if request["authorized"]:\n'
            '        total += request["amount"]\n# total is 11.',
            "The condition includes the first and third requests, so 7 + 4 is 11.",
        ),
    },
}

_DEPTH_NOTES: dict[Depth, str] = {
    "guided": "Trace each stated step in order. The original lesson remains available alongside this example.",
    "standard": "Apply the lesson's stated rule to this example; the original explanation and rubric are unchanged.",
    "concise": "Focus on the rule and result. The original explanation remains available whenever you want it.",
}
_PACE_NOTES: dict[Pace, str] = {
    "short_sessions": "Keep this to one example, then pause or continue when ready; the checkpoint is still required.",
    "standard": "Work through the example and continue at your own pace; the checkpoint is still required.",
}

# Each remediation item is a deterministic fresh number-tracing question whose
# rule and source locator come from the immutable authored lesson. It is never an
# answer copied from the original checkpoint or a claim of objective mastery.
_BRIDGES: dict[str, tuple[str, str, str, int, str]] = {
    "py-values-objective": (
        "Trace multiplication before addition",
        "Write the multiplication result first, then add the remaining value.",
        "groups = 3 * 4 + 2\n# Multiply 3 by 4, then add 2.",
        13,
        "Trace a different bundle: what is 3 + 2 * 5?",
    ),
    "py-branches-objective": (
        "Check the boundary before choosing a branch",
        "Evaluate the comparison first. Exactly 60 satisfies a >= 60 test.",
        "score = 60\nready = score >= 60\n# ready is True.",
        0,
        "If score = 59, does score >= 60 hold? Answer 1 for yes or 0 for no.",
    ),
    "py-loops-objective": (
        "Trace one accumulator update at a time",
        "Start at zero and add each value in order. Keep the running total after every step.",
        "values = [1, 2, 3]\ntotal = 0\nfor value in values:\n    total += value\n# 0 -> 1 -> 3 -> 6.",
        5,
        "Start total at 0. Add the values in [2, 1, 2] in order. What is the final total?",
    ),
    "py-functions-objective": (
        "Substitute arguments, then follow return",
        "Bind each argument to its matching parameter. Then calculate and return the expression to the caller.",
        "def add_fee(price, fee):\n    return price + fee\ninvoice = add_fee(4, 3)\n# invoice is 7.",
        11,
        "Using the same add_fee function, what does add_fee(5, 6) return?",
    ),
    "py-records-objective": (
        "Filter records before adding a field",
        "Check each record's boolean first. Only add the amount for records that pass the condition.",
        'orders = [{"paid": True, "amount": 3}, {"paid": False, "amount": 8}, {"paid": True, "amount": 4}]\n'
        'total = 0\nfor order in orders:\n    if order["paid"]:\n        total += order["amount"]\n# total is 7.',
        6,
        'For orders [{"paid": False, "amount": 4}, {"paid": True, "amount": 6}], what is the paid total?',
    ),
}


def adaptation_for_session(
    session: SessionResponse,
    *,
    role: Role,
    explanation_depth: Depth = "standard",
    pace: Pace = "standard",
) -> SessionResponse:
    """Return a copy carrying an overlay, without changing pinned lesson content."""
    if str(session.release_id) != PYTHON_RELEASE_ID:
        return session
    locators = {ref.id for ref in session.evidence}
    variants: list[ObjectiveAdaptation] = []
    for objective_id in session.lesson.objective_ids:
        contexts = _VARIANTS.get(objective_id)
        evidence_id = objective_id.removesuffix("-objective") + "-evidence"
        if contexts is None or evidence_id not in locators:
            continue
        title, example, reasoning = contexts[role]
        variants.append(
            ObjectiveAdaptation(
                objective_id=objective_id,
                role=role,
                example_title=title,
                example=example,
                explanation_depth=explanation_depth,
                depth_note=(
                    f"{reasoning} {_DEPTH_NOTES[explanation_depth]}"
                    if explanation_depth != "concise"
                    else _DEPTH_NOTES[explanation_depth]
                ),
                pace=pace,
                pace_note=_PACE_NOTES[pace],
                evidence_ids=[evidence_id],
            )
        )
    if not variants:
        return session
    return session.model_copy(
        update={
            "adaptation": LearningAdaptation(
                role=role,
                explanation_depth=explanation_depth,
                pace=pace,
                variants=variants,
            )
        }
    )


def supports_bridge(release_id: str, objective_id: str) -> bool:
    return release_id == PYTHON_RELEASE_ID and objective_id in _BRIDGES


def bridge_exercise(objective_id: str, evidence_ids: list[str]) -> ExerciseKey:
    """The answer is available to server grading only."""
    title, _explanation, _example, answer, prompt = _BRIDGES[objective_id]
    return ExerciseKey(
        id=f"bridge-{objective_id}",
        kind="number",
        mode="practice",
        prompt=prompt,
        choices=[],
        objective_ids=[objective_id],
        evidence_ids=evidence_ids,
        answer=answer,
        explanation="Bridge complete. Try the new checkpoint without help to demonstrate this objective.",
        hint=f"{title}: calculate the value one step at a time.",
    )


def remediation_view(objective_id: str, step: Literal["bridge", "checkpoint"], exercise: Exercise) -> RemediationView:
    title, explanation, example, _answer, _prompt = _BRIDGES[objective_id]
    return RemediationView(
        objective_id=objective_id,
        step=step,
        title=title,
        explanation=explanation,
        worked_example=example,
        evidence_ids=exercise.evidence_ids,
        exercise=exercise,
    )
