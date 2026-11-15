"""Readiness score (task 3.6).

Formula (documented in docs/readiness.md, unit tested here):

    readiness = 100 * (0.45 * coverage + 0.35 * retention + 0.20 * activity)

  coverage  = share of chapters that have a summary, capped at 1
  retention = share of due flashcards graded 3+ in the last 7 days, capped at 1
              (no reviews yet -> 0.5 neutral, so a new user is not punished)
  activity  = focus minutes over the last 7 days / 210 (30 min x 7 days), capped
              at 1

Every input is "at most 1", so the score is 0-100 and monotonic: doing more of
any component never lowers the score.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ReadinessInputs:
    chapters_total: int
    chapters_summarised: int
    reviews_due_recent: int
    reviews_passed_recent: int
    focus_minutes_last_7d: int


NEUTRAL_RETENTION = 0.5
ACTIVITY_TARGET_MINUTES = 210


def _rate(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return min(1.0, max(0.0, numerator / denominator))


def readiness_score(inputs: ReadinessInputs) -> int:
    coverage = _rate(inputs.chapters_summarised, inputs.chapters_total)
    retention = (
        NEUTRAL_RETENTION
        if inputs.reviews_due_recent <= 0
        else _rate(inputs.reviews_passed_recent, inputs.reviews_due_recent)
    )
    activity = _rate(inputs.focus_minutes_last_7d, ACTIVITY_TARGET_MINUTES)
    score = 100.0 * (0.45 * coverage + 0.35 * retention + 0.20 * activity)
    return int(round(min(100.0, max(0.0, score))))


def breakdown(inputs: ReadinessInputs) -> dict[str, float | int]:
    """Same numbers, exposed so the UI can explain the score."""
    coverage = _rate(inputs.chapters_summarised, inputs.chapters_total)
    retention = (
        NEUTRAL_RETENTION
        if inputs.reviews_due_recent <= 0
        else _rate(inputs.reviews_passed_recent, inputs.reviews_due_recent)
    )
    activity = _rate(inputs.focus_minutes_last_7d, ACTIVITY_TARGET_MINUTES)
    return {
        "score": readiness_score(inputs),
        "coverage": round(coverage, 3),
        "retention": round(retention, 3),
        "activity": round(activity, 3),
    }
