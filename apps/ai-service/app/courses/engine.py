"""Pure deterministic progression; learner payloads never carry server keys."""

import json
from typing import Any

from app.courses.adaptation import (
    REMEDIATION_ERROR_LIMIT,
    bridge_exercise,
    remediation_view,
    supports_bridge,
)
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
        "checkpoint_errors": {},
        "remediation": None,
        "notes": [],
        "bookmarks": [],
        "conversation": [],
        "chat_actions": {},
        "assignment_drafts": {},
        "assignment_status": {},
        "lab_progress": {},
        "lab_transcripts": {},
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
    index = state["checkpoint_indices"].get(lesson.id, 0)
    exercises = {exercise.id: exercise for exercise in release.exercises}
    checkpoint = None if lesson.id in completed else exercises[lesson.checkpoint_ids[index]]
    practice = [public_exercise(exercises[identifier]) for identifier in lesson.practice_ids]
    remediation = None
    if checkpoint is not None and (active := state.get("remediation")):
        step = active["step"]
        exercise = bridge_exercise(active["objective_id"], checkpoint.evidence_ids) if step == "bridge" else checkpoint
        remediation = remediation_view(active["objective_id"], step, public_exercise(exercise))
        practice = []
        if step == "bridge":
            checkpoint = None
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
                "practice": practice,
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
            "remediation": remediation,
            "assignment_drafts": state.get("assignment_drafts", {}),
            "assignment_status": state.get("assignment_status", {}),
            "lab_progress": {
                identifier: item.get("progress", 0) for identifier, item in state.get("labs", {}).items()
            },
            "lab_transcripts": {
                identifier: item.get("transcript", []) for identifier, item in state.get("labs", {}).items()
            },
        }
    )


def require_revision(enrollment: dict, revision: int) -> None:
    if enrollment["revision"] != revision:
        raise InvalidInput("Learning session changed; reload it before submitting", status_code=409)


def require_tutor_available(enrollment: dict, revision: int) -> None:
    require_revision(enrollment, revision)
    remediation = enrollment["state"].get("remediation")
    if remediation and remediation["step"] == "checkpoint":
        raise InvalidInput("Finish the fresh checkpoint without tutor assistance")


def current_exercise(release: CourseRelease, state: dict, exercise_id: str) -> ExerciseKey:
    lesson = release.lessons[state["lesson_index"]]
    if lesson.id in state["completed_lesson_ids"]:
        raise InvalidInput("This lesson is complete; continue to the next lesson")
    checkpoint_id = lesson.checkpoint_ids[state["checkpoint_indices"].get(lesson.id, 0)]
    if active := state.get("remediation"):
        if active["step"] == "bridge":
            checkpoint = next(exercise for exercise in release.exercises if exercise.id == checkpoint_id)
            exercise = bridge_exercise(active["objective_id"], checkpoint.evidence_ids)
            if exercise_id != exercise.id:
                raise InvalidInput("Complete the remediation check before retrying the independent checkpoint")
            return exercise
        allowed = {checkpoint_id}
    else:
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
    active = state.get("remediation")
    checkpoint_index = state["checkpoint_indices"].get(lesson.id, 0)
    feedback = exercise.explanation if correct else "That answer is incorrect. Review the lesson and try again."
    if active and active["step"] == "bridge":
        if correct:
            state["checkpoint_indices"][lesson.id] = checkpoint_index + 1
            active["step"] = "checkpoint"
        else:
            feedback = "Review the worked example and try the bridge check again."
    if correct and independent:
        state["completed_lesson_ids"].append(lesson.id)
        state.pop("remediation", None)
    if independent and not correct:
        error_counts = state.setdefault("checkpoint_errors", {})
        key = exercise.id
        errors = error_counts.get(key, 0) + 1
        error_counts[key] = errors
        objective_id = exercise.objective_ids[0]
        if (
            errors == REMEDIATION_ERROR_LIMIT
            and supports_bridge(str(release.id), objective_id)
            and checkpoint_index + 1 < len(lesson.checkpoint_ids)
        ):
            state["remediation"] = {
                "objective_id": objective_id,
                "step": "bridge",
            }
            feedback = "Pause for a worked example and a bridge check before trying a fresh checkpoint."
    complete = len(state["completed_lesson_ids"]) == len(release.lessons)
    enrollment["status"] = "completed" if complete else "active"
    enrollment["revision"] += 1
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
        "message": result["feedback"],
        "revision": enrollment["revision"],
    }
    return result


def assist(enrollment: dict, release: CourseRelease, request: dict) -> dict:
    require_revision(enrollment, request["revision"])
    state = enrollment["state"]
    exercise = current_exercise(release, state, request["exercise_id"])
    if state.get("remediation"):
        raise InvalidInput("Use the worked example and try the remediation check without answer assistance")
    lesson = release.lessons[state["lesson_index"]]
    if exercise.mode == "checkpoint":
        index = state["checkpoint_indices"].get(lesson.id, 0)
        if index + 1 >= len(lesson.checkpoint_ids):
            raise InvalidInput("This is the final independent checkpoint. Review the lesson before attempting it.")
        state["checkpoint_indices"][lesson.id] = index + 1
    if exercise.id not in state["assisted_ids"]:
        state["assisted_ids"].append(exercise.id)
    enrollment["revision"] += 1
    message = (
        exercise.hint
        if request["kind"] == "hint"
        else (exercise.explanation + " Answer: " + json.dumps(exercise.answer))
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
