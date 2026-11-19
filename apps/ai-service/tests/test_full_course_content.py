"""Independent authored-case checks, not a replacement for human curriculum review."""

import ast
import copy
from pathlib import Path

import pytest

from app.courses.catalog import catalog
from app.courses.full_course_candidate import CAPSTONE_CASES, FIXED_RECORDS, practical_python_foundations


def _trusted_reference(records):
    """A test-only checker for the fixed authored dictionaries, never learner input.

    Deliberately uses separate normalization and counting steps to compare the
    hand-authored review vectors with an independent representation of the rules.
    """
    accepted, seen = [], set()
    for record in records:
        if set(record) != {"id", "topic", "minutes", "completed"}:
            return {"error": "invalid_fields"}
        if not isinstance(record["id"], str) or not record["id"].strip():
            return {"error": "invalid_id"}
        if not isinstance(record["topic"], str) or not record["topic"].strip():
            return {"error": "invalid_topic"}
        identifier, topic = record["id"].strip(), record["topic"].strip()
        if type(record["minutes"]) is not int or not 1 <= record["minutes"] <= 180:
            return {"error": "invalid_minutes"}
        if type(record["completed"]) is not bool:
            return {"error": "invalid_completed"}
        if identifier in seen:
            return {"error": "duplicate_id"}
        seen.add(identifier)
        accepted.append((topic, record["minutes"], record["completed"]))
    selected = [(topic, minutes) for topic, minutes, completed in accepted if completed]
    grouped = {topic: sum(minutes for name, minutes in selected if name == topic) for topic, _ in selected}
    return {
        "completed_count": len(selected),
        "total_minutes": sum(minutes for _, minutes in selected),
        "topics": [[topic, grouped[topic]] for topic in sorted(grouped, key=lambda name: (-grouped[name], name))],
    }


def _checkpoint_keys(course, lesson_id):
    by_id = {exercise.id: exercise for exercise in course.exercises}
    lesson = next(lesson for lesson in course.lessons if lesson.id == lesson_id)
    return [by_id[identifier] for identifier in lesson.checkpoint_ids]


def test_full_candidate_is_substantive_and_its_authoring_factory_remains_a_draft():
    course = practical_python_foundations()
    assert (course.size, course.origin, course.visibility, course.status) == ("full", "prebuilt", "catalog", "draft")
    published = next(item for item in catalog() if item.slug == course.slug)
    assert published.status == "published" and published.id == course.id
    assert published is not course
    assert course.prerequisites == ["python-foundations"] and course.estimated_minutes == 840
    assert (len(course.modules), len(course.lessons), len(course.objectives), len(course.exercises)) == (4, 16, 12, 80)
    assert all(len(module.lesson_ids) == 4 for module in course.modules)
    teaching = [lesson for lesson in course.lessons if not lesson.id.endswith("-checkpoint")]
    assert len(teaching) == 12
    for lesson in teaching:
        assert {block.type for block in lesson.blocks} == {"explanation", "code", "recap"}
        assert len(next(block.content for block in lesson.blocks if block.type == "explanation").split()) >= 220
    assert sum(len(block.content.split()) for lesson in course.lessons for block in lesson.blocks) >= 4800


def test_all_sources_and_claim_locators_resolve_to_original_authored_material():
    course = practical_python_foundations()
    sources = {source.id: source for source in course.sources}
    evidence = {item.id: item for item in course.evidence}
    assert len(sources) == len(evidence) == 17
    for item in evidence.values():
        assert item.locator.startswith("authored/") and item.source_pin is None
        assert item.quote in sources[item.source_id].body
    for lesson in course.lessons:
        material = " ".join(" ".join(block.content for block in lesson.blocks).split())
        for block in lesson.blocks:
            assert all(" ".join(evidence[identifier].quote.split()) in material for identifier in block.evidence_ids)
    assert all(
        url.startswith("https://docs.python.org/3.12/") for source in course.sources for url in source.reference_urls
    )


def test_module_checks_are_composite_alternatives_and_final_check_is_cumulative():
    course = practical_python_foundations()
    objective_ids = {objective.id for objective in course.objectives}
    exercises = {exercise.id: exercise for exercise in course.exercises}
    for module_index, module in enumerate(course.modules):
        checkpoint = next(lesson for lesson in course.lessons if lesson.id == module.lesson_ids[-1])
        earlier = {
            identifier
            for lesson in course.lessons
            if lesson.id in module.lesson_ids[:-1]
            for identifier in lesson.objective_ids
        }
        assert set(checkpoint.objective_ids) == (objective_ids if module_index == 3 else earlier)
        alternatives = [exercises[identifier] for identifier in checkpoint.checkpoint_ids]
        assert len(alternatives) == 4
        assert all(
            exercise.kind == "multiple" and set(exercise.objective_ids) == set(checkpoint.objective_ids)
            for exercise in alternatives
        )
        assert all(len(exercise.answer) >= 3 for exercise in alternatives)
        assert len({exercise.prompt for exercise in alternatives}) == 4
        assert exercises[checkpoint.practice_ids[0]].prompt not in {exercise.prompt for exercise in alternatives}


@pytest.mark.parametrize("case", CAPSTONE_CASES, ids=lambda case: case["id"])
def test_authored_capstone_review_vectors_against_independent_trusted_checker(case):
    records = copy.deepcopy(case["records"])
    before = copy.deepcopy(records)
    expected = {"error": case["error"]} if "error" in case else case["expected"]
    assert _trusted_reference(records) == expected
    assert records == before


def test_fixed_report_and_changed_report_have_hand_checked_totals_and_order():
    assert _trusted_reference(FIXED_RECORDS) == {
        "completed_count": 4,
        "total_minutes": 110,
        "topics": [["Python", 60], ["SQL", 30], ["Math", 20]],
    }
    for extra, total, math in ((5, 155, 25), (10, 160, 30), (15, 165, 35), (20, 170, 40)):
        records = copy.deepcopy(FIXED_RECORDS)
        records[1]["completed"] = True
        records.append({"id": "new", "topic": "Math", "minutes": extra, "completed": True})
        assert _trusted_reference(records) == {
            "completed_count": 6,
            "total_minutes": total,
            "topics": [["SQL", 70], ["Python", 60], ["Math", math]],
        }
        assert _trusted_reference(list(reversed(records))) == _trusted_reference(records)


@pytest.mark.parametrize(
    "lesson_id,expected",
    [
        ("pp-contract", ["accept", "accept", "reject", "reject"]),
        ("pp-records", [15, 20, 30, 40]),
        ("pp-validation", ["valid", "invalid", "invalid", "invalid"]),
        ("pp-filter", [30, 40, 10, 105]),
        ("pp-group", [25, 2, 100, 80]),
        (
            "pp-order",
            [
                ["python", "sql", "math"],
                ["math", "sql", "python"],
                ["python", "math", "sql"],
                ["sql", "math", "python"],
            ],
        ),
        ("pp-functions", [10, 20, 50, 180]),
        ("pp-pipeline", ["summarize", "validated", "filter-first", ["normalizer", "ordering", "composition"]]),
        ("pp-tests", ["empty", "bool", "duplicate", "invalid"]),
        ("pp-errors", ["error", "reject", "policy", "either"]),
        ("pp-integration", [155, 160, 165, 175]),
        ("pp-evidence", ["artifact", "spec", "activity", "support"]),
    ],
)
def test_authored_checkpoint_answers_match_independently_recorded_vectors(lesson_id, expected):
    assert [exercise.answer for exercise in _checkpoint_keys(practical_python_foundations(), lesson_id)] == expected


def test_cumulative_checkpoint_choices_match_separately_checked_capstone_cases():
    checks = _checkpoint_keys(practical_python_foundations(), "pp-module-4-checkpoint")
    correct = {"total", "groups", "order", "invalid", "repeat", "test", "evidence", "status"}
    for exercise, total, math in zip(checks, (155, 160, 165, 170), (25, 30, 35, 40), strict=True):
        assert set(exercise.answer) == correct
        choices = {choice.id: choice.label for choice in exercise.choices}
        assert str(total) in choices["total"]
        assert f"Math{math}" in choices["groups"] and f"Math{math}" in choices["order"]
        assert "fixed" in exercise.prompt.lower() and "Python25" in exercise.prompt


def test_capstone_is_self_contained_structured_and_evidence_linked_without_execution_claim():
    course = practical_python_foundations()
    project = course.assignments[0]
    assert course.required_assignment_ids == [project.id] == ["pp-capstone"]
    assert project.require_evidence is True and len(project.sections) == len(project.criteria) == 4
    assert {section.id for section in project.sections} == {"algorithm", "trace", "test-plan", "limitations"}
    assert "Fixed input for your manual trace" in project.prompt and '"s-5"' in project.prompt
    assert "No submitted code runs in StudyVault" in project.prompt
    assert "six of your own" in project.prompt and "review cases before" not in project.prompt
    assert set(project.objective_ids) == {objective.id for objective in course.objectives}
    assert {identifier for criterion in project.criteria for identifier in criterion.objective_ids} == set(
        project.objective_ids
    )
    assert all(criterion.review_guidance for criterion in project.criteria)
    assert not course.labs


def test_candidate_does_not_install_a_runtime_or_execute_any_teaching_text():
    source = Path(__file__).parents[1] / "app/courses/full_course_candidate.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    calls = {node.func.id for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}
    assert not calls & {"eval", "exec", "compile", "__import__", "open"}
