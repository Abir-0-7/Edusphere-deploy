"""F05 never substitutes automated/model approval for a real human receipt."""

import json
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.courses.catalog import catalog
from app.courses.editorial import FullCourseReview, HumanReviewer, build_review_packet, evaluate_review
from app.courses.full_course_candidate import practical_python_foundations


def fixture_completed_review(packet):
    """Synthetic judgments test the validator only; never written as a receipt."""
    data = packet.model_dump(mode="json")
    data["reviewer"] = {"name": "fixture-only synthetic reviewer", "reviewed_at": "2026-11-19T00:00:00Z",
                        "human_review_confirmed": True}
    for key in ("rights_review_approved", "duration_scope_approved", "execution_disabled_confirmed",
                "capstone_cases_checked"):
        data[key] = True
    for claim in data["claims"]:
        claim["human_support"] = "supported"
        claim["human_reference"] = "Fixture judgment for validator testing only, not real curriculum approval."
    for assessment in data["assessments"]:
        assessment.update(human_correct=True, severe_issue=False)
    for lesson in data["lessons"]:
        lesson["human_sufficient"] = True
    for criterion in data["rubric"]:
        criterion["human_approved"] = True
    for evidence in data["evidence"]:
        evidence["human_locator_checked"] = True
    return FullCourseReview.model_validate(data)


def test_pending_packet_covers_every_block_key_lesson_and_criterion_without_human_claims():
    release = practical_python_foundations()
    catalog_before = [(item.id, item.content_hash()) for item in catalog()]
    packet = build_review_packet(release)
    report = evaluate_review(packet, release)
    assert packet.content_hash == release.content_hash() and packet.release_id == release.id
    assert len(packet.claims) == sum(len(lesson.blocks) for lesson in release.lessons)
    assert {row.exercise_id for row in packet.assessments} == {exercise.id for exercise in release.exercises}
    assert len(packet.lessons) == len(release.lessons) == 16
    assert packet.rubric and len(packet.rubric) == sum(len(assignment.criteria) for assignment in release.assignments)
    assert report["matching_claim_excerpts"] == report["sample_size"] > 0
    assert report["evidence_items"] == len(release.evidence) == report["matching_evidence_excerpts"]
    assert report["human_confirmed_locators"] == 0
    assert report["human_reviewed_claims"] == 0 and report["human_support_rate"] is None
    assert report["human_review_requirements_met"] is False and report["published"] is False
    assert packet.reviewer is None and release.status == "draft"
    assert [(item.id, item.content_hash()) for item in catalog()] == catalog_before


def test_validator_can_check_a_synthetic_receipt_but_never_publishes():
    release = practical_python_foundations()
    catalog_before = [(item.id, item.content_hash()) for item in catalog()]
    packet = fixture_completed_review(build_review_packet(release))
    report = evaluate_review(packet, release)
    assert report["human_review_requirements_met"] and report["human_support_rate"] == 1
    assert report["published"] is False and release.status == "draft"
    assert [(item.id, item.content_hash()) for item in catalog()] == catalog_before


@pytest.mark.parametrize("change", ["hash", "drop_claim", "drop_key", "drop_lesson", "drop_rubric", "text", "answer"])
def test_review_cannot_be_reused_for_modified_scope_or_reduced_sample(change):
    release = practical_python_foundations()
    packet = fixture_completed_review(build_review_packet(release))
    data = packet.model_dump(mode="json")
    if change == "hash":
        data["content_hash"] = "0" * 64
    elif change == "drop_claim":
        data["claims"].pop()
    elif change == "drop_key":
        data["assessments"].pop()
    elif change == "drop_lesson":
        data["lessons"].pop()
    elif change == "drop_rubric":
        data["rubric"].pop()
    elif change == "text":
        data["claims"][0]["claim_text"] += " An unreviewed edit."
    else:
        data["assessments"][0]["expected_answer"] = "forged-review-key"
    changed = FullCourseReview.model_validate(data)
    with pytest.raises(ValueError, match="scope differs"):
        evaluate_review(changed, release)


def test_human_support_score_is_observed_only_after_complete_review_and_must_meet_target():
    release = practical_python_foundations()
    packet = fixture_completed_review(build_review_packet(release))
    data = packet.model_dump(mode="json")
    for claim in data["claims"][:max(1, len(data["claims"]) // 5)]:
        claim["human_support"] = "unsupported"
    report = evaluate_review(FullCourseReview.model_validate(data), release)
    assert 0 < report["human_support_rate"] < 0.95 and report["human_review_requirements_met"] is False
    assert any("95%" in issue for issue in report["issues"])
    data["claims"][0]["human_support"] = "pending"
    assert evaluate_review(FullCourseReview.model_validate(data), release)["human_support_rate"] is None


@pytest.mark.parametrize("failure", ["key", "severe", "rubric", "lesson", "rights", "scope", "execution", "cases",
                                     "reference"])
def test_correct_shape_and_passing_support_score_cannot_bypass_other_human_gates(failure):
    release = practical_python_foundations()
    data = fixture_completed_review(build_review_packet(release)).model_dump(mode="json")
    if failure == "key":
        data["assessments"][0]["human_correct"] = False
    elif failure == "severe":
        data["assessments"][0]["severe_issue"] = True
    elif failure == "rubric":
        data["rubric"][0]["human_approved"] = None
    elif failure == "lesson":
        data["lessons"][0]["human_sufficient"] = None
    elif failure == "reference":
        data["claims"][0]["human_reference"] = "   "
    else:
        fields = {"rights": "rights_review_approved", "scope": "duration_scope_approved",
                  "execution": "execution_disabled_confirmed", "cases": "capstone_cases_checked"}
        data[fields[failure]] = False
    report = evaluate_review(FullCourseReview.model_validate(data), release)
    assert report["human_support_rate"] == 1 and report["human_review_requirements_met"] is False


def test_review_identity_and_approval_booleans_are_strict_and_timezone_aware():
    with pytest.raises(ValidationError):
        HumanReviewer(name=" ", reviewed_at=datetime.now(UTC), human_review_confirmed=True)
    with pytest.raises(ValidationError):
        HumanReviewer(name="fixture", reviewed_at="2026-11-19T00:00:00", human_review_confirmed=True)
    with pytest.raises(ValidationError):
        HumanReviewer(name="fixture", reviewed_at=datetime.now(UTC), human_review_confirmed=False)
    data = build_review_packet(practical_python_foundations()).model_dump(mode="json")
    data["rights_review_approved"] = "true"
    with pytest.raises(ValidationError):
        FullCourseReview.model_validate(data)


def test_exporter_leaves_human_fields_pending_and_preserves_existing_review_data(tmp_path, monkeypatch, capsys):
    from scripts.export_full_course_review import main

    path = tmp_path / "review.json"
    monkeypatch.setattr("sys.argv", ["export_full_course_review", "--output", str(path)])
    assert main() == 0
    report = json.loads(capsys.readouterr().out)
    assert report["human_review_requirements_met"] is False
    packet = FullCourseReview.model_validate_json(path.read_text(encoding="utf-8"))
    assert packet.reviewer is None
    packet.claims[0].human_notes = "A human's unfinished review notes must survive regeneration."
    path.write_text(packet.model_dump_json(), encoding="utf-8")
    before = path.read_bytes()
    with pytest.raises(SystemExit):
        main()
    assert path.read_bytes() == before
    monkeypatch.setattr("sys.argv", ["export_full_course_review", "--check-review", str(path)])
    assert main() == 1
    report = json.loads(capsys.readouterr().out)
    assert report["published"] is False and report["human_reviewed_claims"] == 0


def test_review_packet_refuses_published_versions_and_executable_labs():
    release = practical_python_foundations()
    with pytest.raises(ValueError, match="unpublished"):
        build_review_packet(release.model_copy(update={"status": "published"}))
    from app.courses.catalog_candidates import sql_query_foundations

    with pytest.raises(ValueError, match="execution"):
        build_review_packet(release.model_copy(update={"labs": sql_query_foundations().labs}))


def test_quote_matching_never_claims_to_resolve_an_opaque_or_forged_locator():
    release = practical_python_foundations()
    data = release.model_dump(mode="json")
    data["evidence"][0]["locator"] = "authored/nonexistent/missing"
    from app.courses.contracts import CourseRelease

    forged = CourseRelease.model_validate(data)
    packet = build_review_packet(forged)
    assert packet.evidence[0].excerpt_matches_source is True
    assert packet.evidence[0].human_locator_checked is None
    report = evaluate_review(packet, forged)
    assert report["human_confirmed_locators"] == 0 and report["human_review_requirements_met"] is False


def test_every_assessment_including_orphan_keys_must_enter_review_scope():
    release = practical_python_foundations()
    data = release.model_dump(mode="json")
    data["exercises"].append({**data["exercises"][0], "id": "unreferenced-key"})
    from app.courses.contracts import CourseRelease

    with pytest.raises(ValueError, match="referenced exactly once"):
        build_review_packet(CourseRelease.model_validate(data))


def test_rubric_only_capstone_evidence_cannot_escape_human_locator_review():
    release = practical_python_foundations()
    packet = fixture_completed_review(build_review_packet(release))
    capstone = next(item for item in packet.evidence if "capstone" in item.evidence_id)
    capstone.human_locator_checked = None
    assert evaluate_review(packet, release)["human_review_requirements_met"] is False
