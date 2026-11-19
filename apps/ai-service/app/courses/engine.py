"""Deterministic course progression; answer keys remain server-side."""

import json
from typing import Any

from app.courses.catalog import DIAGNOSTIC, stable_id
from app.courses.contracts import (
    CourseRelease,
    CourseSummary,
    Exercise,
    ExerciseKey,
    SessionResponse,
    StudyNotesRequest,
)
from app.errors import InvalidInput


def summary(release: CourseRelease) -> CourseSummary:
    return CourseSummary(
        id=release.course_id,
        release_id=release.id,
        slug=release.slug,
        title=release.title,
        description=release.description,
        version=release.version,
        size=release.size,
        origin=release.origin,
        estimated_minutes=release.estimated_minutes,
        lesson_count=len(release.lessons),
        prerequisites=release.prerequisites,
    )


def initial_state() -> dict[str, Any]:
    return {
        "lesson_index": 0,
        "completed_lesson_ids": [],
        "assisted_ids": [],
        "checkpoint_indices": {},
        "notes": [],
        "bookmarks": [],
        "conversation": [],
        "chat_actions": {},
    }


def prerequisite_met(release: CourseRelease, completed_slugs: set[str], diagnostic: dict | None = None) -> bool:
    if set(release.prerequisites) <= completed_slugs:
        return True
    if release.prerequisites == ["python-foundations"] and diagnostic is not None:
        return set(diagnostic) == set(DIAGNOSTIC) and all(
            type(diagnostic[key]) is type(answer) and diagnostic[key] == answer
            for key, (_, answer) in DIAGNOSTIC.items()
        )
    return False


def public_exercise(exercise: ExerciseKey) -> Exercise:
    return Exercise.model_validate(exercise.model_dump(exclude={"answer", "explanation", "hint"}))


def session_view(enrollment: dict, release: CourseRelease) -> SessionResponse:
    state = enrollment["state"]
    lesson = release.lessons[state["lesson_index"]]
    completed = state["completed_lesson_ids"]
    checkpoint_index = state["checkpoint_indices"].get(lesson.id, 0)
    exercises = {exercise.id: exercise for exercise in release.exercises}
    checkpoint = None if lesson.id in completed else exercises[lesson.checkpoint_ids[checkpoint_index]]
    return SessionResponse.model_validate(
        {
            "id": enrollment["id"],
            "release_id": release.id,
            "document_id": enrollment["document_id"],
            "course_slug": release.slug,
            "course_title": release.title,
            "revision": enrollment["revision"],
            "status": enrollment["status"],
            "completed_lesson_ids": completed,
            "lessons": [
                {
                    "id": item.id,
                    "title": item.title,
                    "completed": item.id in completed,
                    "objective_ids": item.objective_ids,
                    "demonstrated_objective_ids": (
                        exercises[item.checkpoint_ids[state["checkpoint_indices"].get(item.id, 0)]].objective_ids
                        if item.id in completed
                        else []
                    ),
                }
                for item in release.lessons
            ],
            "lesson": {
                "id": lesson.id,
                "title": lesson.title,
                "objective_ids": lesson.objective_ids,
                "blocks": [block.model_dump() for block in lesson.blocks],
                "practice": [public_exercise(exercises[identifier]) for identifier in lesson.practice_ids],
                "checkpoint": public_exercise(checkpoint) if checkpoint else None,
            },
            "evidence": [
                {
                    **evidence.model_dump(),
                    "document_id": enrollment["document_id"],
                    "chapter_id": stable_id(f"{enrollment['id']}/chapter/{lesson.id}"),
                    "chunk_id": stable_id(f"{enrollment['id']}/chunk/{lesson.id}"),
                }
                for evidence in release.evidence
                if evidence.id in {ref for block in lesson.blocks for ref in block.evidence_ids}
            ],
            "last_action": state.get("last_action"),
            "notes": state.get("notes", []),
            "bookmarks": state.get("bookmarks", []),
            "conversation": state.get("conversation", [])[-40:],
        }
    )


def require_revision(enrollment: dict, revision: int) -> None:
    if enrollment["revision"] != revision:
        raise InvalidInput("Learning session changed; reload it before submitting", status_code=409)


def require_tutor_available(enrollment: dict, revision: int) -> None:
    require_revision(enrollment, revision)


def current_exercise(release: CourseRelease, state: dict, exercise_id: str) -> ExerciseKey:
    lesson = release.lessons[state["lesson_index"]]
    if lesson.id in state["completed_lesson_ids"]:
        raise InvalidInput("This lesson is complete; continue to the next lesson")
    checkpoint_id = lesson.checkpoint_ids[state["checkpoint_indices"].get(lesson.id, 0)]
    allowed = {*lesson.practice_ids, checkpoint_id}
    if exercise_id not in allowed:
        raise InvalidInput("Exercise is not the active practice or checkpoint")
    return next(exercise for exercise in release.exercises if exercise.id == exercise_id)


def grade(exercise: ExerciseKey, answer: object) -> bool:
    choices = {choice.id for choice in exercise.choices}
    if exercise.kind == "number":
        if type(answer) not in {int, float}:
            raise InvalidInput("Answer must be a number")
        return answer == exercise.answer
    if exercise.kind == "choice":
        if not isinstance(answer, str) or answer not in choices:
            raise InvalidInput("Answer must identify an offered choice")
        return answer == exercise.answer
    if not isinstance(answer, list) or not all(isinstance(item, str) for item in answer):
        raise InvalidInput("Answer must be a list of choice identifiers")
    if len(answer) != len(set(answer)) or not set(answer) <= choices:
        raise InvalidInput("Answer contains duplicate or unknown choices")
    if exercise.kind == "ordered":
        if len(answer) != len(choices):
            raise InvalidInput("Ordered answer must include every choice once")
        return answer == exercise.answer
    return set(answer) == set(exercise.answer)


def attempt(enrollment: dict, release: CourseRelease, request: dict) -> dict:
    require_revision(enrollment, request["revision"])
    state = enrollment["state"]
    exercise = current_exercise(release, state, request["exercise_id"])
    correct = grade(exercise, request["answer"])
    independent = exercise.mode == "checkpoint" and exercise.id not in state["assisted_ids"]
    lesson = release.lessons[state["lesson_index"]]
    if correct and independent:
        state["completed_lesson_ids"].append(lesson.id)
    complete = len(state["completed_lesson_ids"]) == len(release.lessons)
    enrollment["status"] = "completed" if complete else "active"
    enrollment["revision"] += 1
    feedback = exercise.explanation if correct else "That answer is incorrect. Review the lesson and try again."
    result = {
        "id": request["id"],
        "exercise_id": exercise.id,
        "correct": correct,
        "independent": independent,
        "lesson_complete": lesson.id in state["completed_lesson_ids"],
        "course_complete": complete,
        "feedback": feedback,
        "revision": enrollment["revision"],
        "replayed": False,
    }
    state["last_action"] = {
        "id": request["id"],
        "exercise_id": exercise.id,
        "kind": "attempt",
        "answer": request["answer"],
        "correct": correct,
        "message": feedback,
        "revision": enrollment["revision"],
    }
    return result


def assist(enrollment: dict, release: CourseRelease, request: dict) -> dict:
    require_revision(enrollment, request["revision"])
    state = enrollment["state"]
    exercise = current_exercise(release, state, request["exercise_id"])
    lesson = release.lessons[state["lesson_index"]]
    if exercise.mode == "checkpoint":
        index = state["checkpoint_indices"].get(lesson.id, 0)
        if index + 1 >= len(lesson.checkpoint_ids):
            raise InvalidInput("This is the final independent checkpoint. Review the lesson before attempting it.")
        state["checkpoint_indices"][lesson.id] = index + 1
    if exercise.id not in state["assisted_ids"]:
        state["assisted_ids"].append(exercise.id)
    enrollment["revision"] += 1
    message = exercise.hint if request["kind"] == "hint" else (
        exercise.explanation + " Answer: " + json.dumps(exercise.answer)
    )
    if exercise.mode == "checkpoint":
        message += " A fresh checkpoint is now active; the assisted item cannot complete this lesson."
    state["last_action"] = {
        "id": request["id"],
        "exercise_id": exercise.id,
        "kind": request["kind"],
        "answer": None,
        "correct": None,
        "message": message,
        "revision": enrollment["revision"],
    }
    return {
        "id": request["id"],
        "exercise_id": exercise.id,
        "kind": request["kind"],
        "message": message,
        "revision": enrollment["revision"],
        "replayed": False,
    }


def advance(enrollment: dict, release: CourseRelease, revision: int) -> None:
    require_revision(enrollment, revision)
    lesson = release.lessons[enrollment["state"]["lesson_index"]]
    if lesson.id not in enrollment["state"]["completed_lesson_ids"]:
        raise InvalidInput("Pass an independent checkpoint before continuing")
    if enrollment["state"]["lesson_index"] < len(release.lessons) - 1:
        enrollment["state"]["lesson_index"] += 1
        enrollment["state"].pop("last_action", None)
        enrollment["revision"] += 1


def save_study_notes(enrollment: dict, release: CourseRelease, request: StudyNotesRequest) -> None:
    require_revision(enrollment, request.revision)
    lessons = {lesson.id for lesson in release.lessons}
    allowed_evidence = {
        lesson.id: {evidence_id for block in lesson.blocks for evidence_id in block.evidence_ids}
        for lesson in release.lessons
    }
    if any(note.lesson_id not in lessons for note in request.notes):
        raise InvalidInput("Note refers to a lesson outside this release")
    if len({str(note.id) for note in request.notes}) != len(request.notes):
        raise InvalidInput("Note IDs must be unique")
    if any(
        bookmark.lesson_id not in allowed_evidence or bookmark.evidence_id not in allowed_evidence[bookmark.lesson_id]
        for bookmark in request.bookmarks
    ):
        raise InvalidInput("Bookmark source is not part of its lesson")
    if len({(item.lesson_id, item.evidence_id) for item in request.bookmarks}) != len(request.bookmarks):
        raise InvalidInput("Bookmarks must be unique")
    enrollment["state"]["notes"] = [note.model_dump(mode="json") for note in request.notes]
    enrollment["state"]["bookmarks"] = [item.model_dump(mode="json") for item in request.bookmarks]
    enrollment["revision"] += 1
