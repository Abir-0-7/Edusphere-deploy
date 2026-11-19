"""Source-grounded deterministic fallback for guided mini-course questions."""

import re

from app.courses.contracts import SessionResponse

_WORD = re.compile(r"[a-z][a-z0-9_'-]{2,}")
_STOP = {
    "about", "after", "again", "also", "and", "are", "does", "from", "have", "how", "into", "that", "the",
    "their", "these", "this", "what", "when", "where", "which", "with", "your",
}
_FOLLOW_UP_CUES = {"it", "that", "those", "they", "this", "these", "why", "how", "mean", "example"}
_DECLINE = "I don't know based on this lesson. Ask about a concept or example shown here."


def answer_course_question(session: SessionResponse, question: str) -> tuple[str, list[str]]:
    """Quote only active lesson evidence; do not turn a question into authority."""
    active_ids = {identifier for block in session.lesson.blocks for identifier in block.evidence_ids}
    evidence = {item.id: item for item in session.evidence}
    query_terms = {word for word in _WORD.findall(question.lower()) if word not in _STOP}
    if set(_WORD.findall(question.lower())) & _FOLLOW_UP_CUES:
        history = " ".join(message.content for message in session.conversation[-4:])
        query_terms |= {word for word in _WORD.findall(history.lower()) if word not in _STOP}
    ranked = sorted(
        (
            (
                len(query_terms & {word for word in _WORD.findall(evidence[item].quote.lower()) if word not in _STOP}),
                item,
            )
            for item in active_ids
            if item in evidence
        ),
        key=lambda pair: (-pair[0], pair[1]),
    )
    selected = [identifier for score, identifier in ranked[:2] if score > 0]
    if not selected:
        return _DECLINE, []
    quote = " ".join(evidence[identifier].quote.strip() for identifier in selected)
    return f"From this lesson: {quote}", selected
