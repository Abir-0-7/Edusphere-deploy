"""Repository publication authorized after Abir's exact-packet human review.

The 2026-11-20 confirmation and completed receipt are recorded in
docs/curricula/practical-python-human-review.json. Deployment is not authorized
by this module. Any teaching/key/rubric change needs a new reviewed release.
"""

from app.courses.contracts import CourseRelease
from app.courses.full_course_candidate import practical_python_foundations

REVIEWED_DRAFT_SHA256 = "8d0d00657b631698c83363fa4f68fbc3d8f7a24ce75d66090310c32d9fb87f1e"
REVIEWER = "Abir"
REVIEW_DATE = "2026-11-20"


def practical_python_release() -> CourseRelease:
    draft = practical_python_foundations()
    if draft.content_hash() != REVIEWED_DRAFT_SHA256:
        raise ValueError("Practical Python content changed after human review; review a new release before publication")
    return CourseRelease.model_validate({**draft.model_dump(mode="json"), "status": "published"})
