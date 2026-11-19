"""Authored, catalog-backed tracks for C02 recommendations and C04 planning.

Track requirements reference immutable course releases by their stable slug and
objective IDs. These definitions never claim a learner has demonstrated mastery.
"""

from dataclasses import dataclass

from app.courses.catalog import python_foundations, pytorch_fundamentals


@dataclass(frozen=True)
class Track:
    id: str
    goal_kind: str
    title: str
    description: str
    required_course_slugs: tuple[str, ...]
    required_objective_ids: tuple[str, ...]


_PYTHON = python_foundations()
_PYTORCH = pytorch_fundamentals()

TRACKS: dict[str, Track] = {
    "analyst": Track(
        id="analyst",
        goal_kind="career",
        title="Data analyst foundations",
        description="Start with Python fundamentals; the same objectives remain useful if your role changes.",
        required_course_slugs=("python-foundations",),
        required_objective_ids=tuple(item.id for item in _PYTHON.objectives),
    ),
    "developer": Track(
        id="developer",
        goal_kind="career",
        title="Python developer to machine learning",
        description="Build Python foundations, then reason about tensor operations and model training.",
        required_course_slugs=("python-foundations", "pytorch-fundamentals"),
        required_objective_ids=tuple(item.id for item in (*_PYTHON.objectives, *_PYTORCH.objectives)),
    ),
    "programming-exam": Track(
        id="programming-exam",
        goal_kind="academic",
        title="Programming exam foundations",
        description="Prepare for an academic assessment using the authored Python foundations course.",
        required_course_slugs=("python-foundations",),
        required_objective_ids=tuple(item.id for item in _PYTHON.objectives),
    ),
}


def default_track(goal_kind: str) -> str:
    """Return the initial authored path implied by the saved goal category."""
    return "programming-exam" if goal_kind == "academic" else "analyst"
