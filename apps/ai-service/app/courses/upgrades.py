"""Conservative exact-input equivalence, not an AI judgment about mastery."""

import copy
import hashlib
import json
from uuid import UUID

from app.courses import engine
from app.courses.upgrade_contracts import CourseUpgradePreview, CourseUpgradeResetReason
from app.errors import Conflict, InvalidInput


def _digest(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode("utf-8")).hexdigest()


def _bounded(release):
    if (len(release.lessons) > 200 or len(release.objectives) > 1000 or len(release.exercises) > 5000
            or len(release.evidence) > 2000 or len(release.model_dump_json().encode("utf-8")) > 2_000_000):
        raise InvalidInput("This course exceeds the bounded upgrade protocol; retain the current enrollment")
    identifiers = [release.slug, release.version, *(item.id for item in release.lessons),
                   *(item.id for item in release.objectives)]
    if any(not identifier or len(identifier) > 200 for identifier in identifiers):
        raise InvalidInput("Course identifiers exceed the upgrade protocol bounds")


def _shapes(release):
    objectives = {item.id: item for item in release.objectives}
    exercises = {item.id: item for item in release.exercises}
    evidence = {item.id: item for item in release.evidence}
    sources = {item.id: item for item in release.sources}
    result = {}
    first = {}
    for lesson in release.lessons:
        for identifier in lesson.objective_ids:
            first.setdefault(identifier, lesson.id)
        banks = [exercises[identifier] for identifier in [*lesson.practice_ids, *lesson.checkpoint_ids]]
        refs = {identifier for block in lesson.blocks for identifier in block.evidence_ids}
        refs.update(identifier for exercise in banks for identifier in exercise.evidence_ids)
        # Only referenced evidence participates, not unrelated paragraphs in a
        # shared source container. Full immutable private pins stay exact.
        material = [{"evidence": evidence[identifier].model_dump(mode="json"),
                     "source_id": sources[evidence[identifier].source_id].id,
                     "source_title": sources[evidence[identifier].source_id].title,
                     "reference_urls": sources[evidence[identifier].source_id].reference_urls}
                    for identifier in sorted(refs)]
        result[lesson.id] = _digest({
            "lesson": lesson.model_dump(mode="json"),
            "objectives": [objectives[identifier].model_dump(mode="json") for identifier in lesson.objective_ids],
            "exercises": [item.model_dump(mode="json") for item in banks], "evidence": material,
        })
    return result, first


def prepare_upgrade(row, original, target):
    """Return a hash-bound preview and fresh state; never mutate either version."""
    for release in (original, target):
        _bounded(release)
    if (original.id == target.id or original.course_id != target.course_id
            or original.visibility != target.visibility or original.user_id != target.user_id):
        raise InvalidInput("Select a different published release of this same owned course")
    if target.status != "published":
        raise InvalidInput("The target course release is not published")
    old_shapes, old_first = _shapes(original)
    new_shapes, new_first = _shapes(target)
    old_objectives = {item.id: item for item in original.objectives}
    target_objectives = {item.id: item for item in target.objectives}
    equivalent = {
        identifier for identifier, objective in target_objectives.items()
        if identifier in old_objectives and objective == old_objectives[identifier]
        and new_first.get(identifier) == old_first.get(identifier)
        and new_shapes.get(new_first.get(identifier)) == old_shapes.get(old_first.get(identifier))
    }
    # A changed prerequisite invalidates dependent carry-over even when their
    # own text stayed the same. The validated release DAG makes this bounded.
    while True:
        reduced = {identifier for identifier in equivalent
                   if set(target_objectives[identifier].prerequisites) <= equivalent}
        if reduced == equivalent:
            break
        equivalent = reduced
    equivalent_lessons = {lesson.id for lesson in target.lessons
                          if new_shapes[lesson.id] == old_shapes.get(lesson.id)
                          and set(lesson.objective_ids) <= equivalent}
    old_state = row["state"]
    old_lessons = {lesson.id: lesson for lesson in original.lessons}
    old_exercises = {exercise.id: exercise for exercise in original.exercises}
    retained, resets, reasons, demonstrated = [], [], [], set()
    for lesson in target.lessons:
        reason = None
        index = old_state.get("checkpoint_indices", {}).get(lesson.id, 0)
        if lesson.id not in old_lessons:
            reason = "new_lesson"
        elif new_shapes[lesson.id] != old_shapes.get(lesson.id):
            reason = "changed_teaching_or_assessment"
        elif lesson.id not in equivalent_lessons:
            reason = "changed_prerequisite"
        elif lesson.id not in old_state["completed_lesson_ids"]:
            reason = "not_completed"
        elif (type(index) is not int or not 0 <= index < len(lesson.checkpoint_ids)
              or lesson.checkpoint_ids[index] in old_state.get("assisted_ids", [])):
            reason = "invalid_prior_checkpoint"
        if reason:
            resets.append(lesson.id)
            reasons.append(CourseUpgradeResetReason(lesson_id=lesson.id, reason=reason))
        else:
            retained.append(lesson.id)
            demonstrated.update(old_exercises[lesson.checkpoint_ids[index]].objective_ids)
    state = engine.initial_state()
    state["completed_lesson_ids"] = retained
    state["checkpoint_indices"] = {
        identifier: index for identifier, index in old_state.get("checkpoint_indices", {}).items()
        if identifier in equivalent_lessons and type(index) is int
        and 0 <= index < len(old_lessons[identifier].checkpoint_ids)
    }
    unchanged_exercises = {identifier for lesson in target.lessons if lesson.id in equivalent_lessons
                           for identifier in [*lesson.practice_ids, *lesson.checkpoint_ids]}
    state["assisted_ids"] = [identifier for identifier in old_state.get("assisted_ids", [])
                              if identifier in unchanged_exercises]
    state["notes"] = [copy.deepcopy(note) for note in old_state.get("notes", [])
                      if note["lesson_id"] in equivalent_lessons]
    state["bookmarks"] = [copy.deepcopy(bookmark) for bookmark in old_state.get("bookmarks", [])
                          if bookmark["lesson_id"] in equivalent_lessons]
    state["assignment_status"] = {assignment.id: "draft" for assignment in target.assignments}
    state["lesson_index"] = next((index for index, lesson in enumerate(target.lessons)
                                  if lesson.id not in retained), len(target.lessons) - 1)
    data = {
        "from_enrollment_id": UUID(row["id"]), "from_revision": row["revision"],
        "from_document_id": UUID(row["document_id"]), "from_release_id": original.id,
        "from_content_hash": original.content_hash(), "target_release_id": target.id,
        "target_content_hash": target.content_hash(), "course_id": target.course_id, "course_slug": target.slug,
        "from_version": original.version, "target_version": target.version,
        "retained_lesson_ids": retained, "reset_lesson_ids": resets, "reset_reasons": reasons,
        "retained_objective_ids": [objective.id for objective in target.objectives if objective.id in demonstrated],
        "retained_note_count": len(state["notes"]), "retained_bookmark_count": len(state["bookmarks"]),
        "warnings": ["The old enrollment, cards, review schedules, maps and projects stay in the original library.",
                     "Only exact unchanged learning inputs carry completion; this is not a new mastery assessment.",
                     "Projects in the new enrollment start as ungraded drafts; original submissions remain unchanged."],
        "preview_hash": "0" * 64,
    }
    provisional = CourseUpgradePreview.model_construct(**data)
    data["preview_hash"] = provisional.fingerprint()
    return CourseUpgradePreview.model_validate(data), state


def verify_acceptance(preview, request):
    if (preview.from_revision != request.expected_revision
            or preview.target_release_id != request.target_release_id
            or preview.target_content_hash != request.target_content_hash
            or preview.preview_hash != request.preview_hash):
        raise Conflict("Upgrade preview changed; refresh and explicitly accept the current mapping")
