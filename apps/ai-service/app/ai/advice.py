"""Exam planner and weekly advice (tasks 3.5, 3.8).

Both are LLM features that must degrade gracefully: the plan falls back to an
even split, and the advice falls back to a plain metrics summary.
"""

import logging
from datetime import date
from typing import Any

from app.ai.exam_plan import ExamPlan, fallback_plan, generate_plan
from app.llm.router import LLMRouter

logger = logging.getLogger("studyvault.advice")

_ADVICE_SYSTEM = (
    "You are a study coach. Given the student's last-7-days metrics, write "
    "3-4 short, specific, encouraging suggestions for next week. Reference the "
    "numbers you were given. Plain text, no markdown headings, at most 120 words."
)


def plan_for_document(
    *,
    router: LLMRouter,
    chapters: list[Any],
    exam_date: date,
    today: date,
    minutes_per_day: int = 60,
) -> ExamPlan:
    return generate_plan(
        router=router,
        chapters=chapters,
        exam_date=exam_date,
        today=today,
        minutes_per_day=minutes_per_day,
    )


def advice_for_metrics(router: LLMRouter, metrics: dict[str, Any]) -> str:
    """LLM advice with a deterministic fallback (task 3.8). Never raises: the
    dashboard should still render when every provider is down."""
    from app.llm.router import AllProvidersFailed

    user = (
        f"Focus minutes (7 days): {metrics.get('focus_minutes_7d', 0)}\n"
        f"Flashcard reviews (7 days): {metrics.get('reviews_7d', 0)}\n"
        f"Cards due now: {metrics.get('due_flashcards', 0)}\n"
        f"Token balance: {metrics.get('token_balance', 0)}"
    )
    try:
        text = router.complete(
            [{"role": "system", "content": _ADVICE_SYSTEM}, {"role": "user", "content": user}]
        ).strip()
        if text:
            return text
    except AllProvidersFailed:
        logger.warning("advice generation failed; using the metrics fallback", exc_info=True)
    return _fallback_advice(metrics)


def _fallback_advice(metrics: dict[str, Any]) -> str:
    minutes = int(metrics.get("focus_minutes_7d", 0))
    reviews = int(metrics.get("reviews_7d", 0))
    due = int(metrics.get("due_flashcards", 0))
    lines = [f"You focused for {minutes} minutes and did {reviews} reviews in the last 7 days."]
    if due:
        lines.append(f"You have {due} card(s) due — clearing them first protects your retention.")
    if minutes < 120:
        lines.append("Try two 25-minute sessions on your weakest chapter to build momentum.")
    else:
        lines.append("Steady week: keep the routine and add one deep-dive summary.")
    return " ".join(lines)


__all__ = ["ExamPlan", "advice_for_metrics", "fallback_plan", "generate_plan", "plan_for_document"]
