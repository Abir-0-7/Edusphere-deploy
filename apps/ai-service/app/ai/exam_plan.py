"""Exam scheduler (task 3.5): exam date + material -> day-by-day JSON plan.

The plan is schema-validated (pydantic) before it is stored or shown. An invalid
LLM response is re-asked once with the validation error, then falls back to a
deterministic even-split plan so the user still gets something usable — the same
graceful-degradation rule the chapter structurer follows.
"""

import logging
from datetime import date, timedelta

from pydantic import BaseModel, Field, ValidationError

from app.ai.schemas import StructuredOutputError, complete_validated
from app.documents.store import ChapterRecord
from app.llm.router import LLMRouter

logger = logging.getLogger("studyvault.exam")


class PlanDay(BaseModel):
    date: date
    chapters: list[str] = Field(default_factory=list)
    minutes: int = Field(ge=15, le=480)
    focus: str = ""


class ExamPlan(BaseModel):
    exam_date: date
    days: list[PlanDay] = Field(min_length=1)

    def covers(self, titles: list[str]) -> bool:
        planned = {c for d in self.days for c in d.chapters}
        return set(titles) <= planned


def _system() -> str:
    return (
        "You are a study planner. Given an exam date, today's date, a list of "
        "chapter titles and how many minutes the student can study per day, "
        "produce a day-by-day revision plan from today to the exam (exam day "
        "excluded). Return ONLY JSON: {\"exam_date\": \"YYYY-MM-DD\", \"days\": "
        "[{\"date\": \"YYYY-MM-DD\", \"chapters\": [\"<exact title>\"], "
        "\"minutes\": <15-480>, \"focus\": \"<one short sentence>\"}]}. "
        "Every chapter title must appear in at least one day, and titles must "
        "be copied exactly."
    )


def generate_plan(
    *,
    router: LLMRouter,
    chapters: list[ChapterRecord],
    exam_date: date,
    today: date,
    minutes_per_day: int = 60,
) -> ExamPlan:
    titles = [c.title for c in chapters]
    if exam_date <= today:
        raise ValueError("exam_date must be after today")
    if not titles:
        raise ValueError("no chapters to plan")
    user = (
        f"Today: {today.isoformat()}\nExam date: {exam_date.isoformat()}\n"
        f"Minutes per day: {minutes_per_day}\nChapters: {titles}"
    )
    try:
        plan = complete_validated(router, ExamPlan, _system(), user)
        if plan.covers(titles):
            return plan
        missing = set(titles) - {c for d in plan.days for c in d.chapters}
        logger.warning("LLM plan omitted chapters %s; falling back", missing)
    except (StructuredOutputError, ValidationError, ValueError):
        logger.warning("LLM plan invalid after retries; using deterministic fallback", exc_info=True)
    return fallback_plan(chapters=titles, exam_date=exam_date, today=today, minutes_per_day=minutes_per_day)


def fallback_plan(*, chapters: list[str], exam_date: date, today: date, minutes_per_day: int) -> ExamPlan:
    """Even split over the available days, excluding the exam day itself."""
    span = (exam_date - today).days
    if span <= 0:
        raise ValueError("exam_date must be after today")
    buckets: list[list[str]] = [[] for _ in range(span)]
    for i, title in enumerate(chapters):
        buckets[i % span].append(title)
    days = [
        PlanDay(
            date=today + timedelta(days=i),
            chapters=titles_today,
            minutes=minutes_per_day,
            focus="Revise the chapter(s) above, then recall them without notes.",
        )
        for i, titles_today in enumerate(buckets)
    ]
    return ExamPlan(exam_date=exam_date, days=days)
