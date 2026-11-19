"""The authorized F05 publication preserves the exact human-reviewed content."""

from pathlib import Path

import pytest

from app.courses.catalog import catalog, python_foundations, pytorch_fundamentals
from app.courses.editorial import FullCourseReview, evaluate_review
from app.courses.full_course_candidate import practical_python_foundations
from app.courses.full_course_release import REVIEWED_DRAFT_SHA256, practical_python_release


def test_recorded_human_receipt_is_complete_and_binds_the_published_candidate():
    path = Path(__file__).resolve().parents[3] / "docs/curricula/practical-python-human-review.json"
    receipt = FullCourseReview.model_validate_json(path.read_text(encoding="utf-8"))
    draft = practical_python_foundations()
    report = evaluate_review(receipt, draft)
    assert receipt.reviewer is not None and receipt.reviewer.name == "Abir"
    assert receipt.reviewer.reviewed_at.date().isoformat() == "2026-11-20"
    assert receipt.reviewer.human_review_confirmed is True
    assert receipt.release_id == draft.id
    assert receipt.content_hash == REVIEWED_DRAFT_SHA256 == draft.content_hash()
    assert report["human_review_requirements_met"] is True and report["issues"] == []
    assert report["human_reviewed_claims"] == report["human_supported_claims"] == report["sample_size"] == 40
    assert report["human_support_rate"] == 1 and report["human_confirmed_locators"] == 17
    assert report["assessment_keys"] == 80
    # Validation only checks the human record; the separately authorized catalog
    # factory performs publication. Evaluating the receipt cannot publish.
    assert report["published"] is False and draft.status == "draft"


def test_catalog_publishes_only_a_status_changed_copy_of_the_reviewed_full_course():
    draft = practical_python_foundations()
    published = practical_python_release()
    assert draft.status == "draft" and published.status == "published"
    assert published.model_dump(mode="json", exclude={"status"}) == draft.model_dump(mode="json", exclude={"status"})
    assert published.content_hash() == "6950baaf82af5901a9905bc6985a453012b2439b0a36b951f9625df09d3f3718"
    assert published.content_hash() != draft.content_hash()
    catalog_copy = next(item for item in catalog() if item.slug == draft.slug)
    assert catalog_copy.model_dump(mode="json") == published.model_dump(mode="json")
    assert catalog_copy is not published and published is not draft
    assert published.size == "full" and published.labs == []
    assert published.required_assignment_ids == ["pp-capstone"]


@pytest.mark.parametrize("mutation", ["title", "teaching", "assessment", "rubric", "evidence"])
def test_unreviewed_content_changes_cannot_reuse_the_publication_approval(monkeypatch, mutation):
    import app.courses.full_course_release as publication

    changed = practical_python_foundations().model_copy(deep=True)
    if mutation == "title":
        changed.title += " changed"
    elif mutation == "teaching":
        changed.lessons[0].blocks[0].content += " An unreviewed claim."
    elif mutation == "assessment":
        changed.exercises[0].explanation += " An unreviewed key explanation."
    elif mutation == "rubric":
        changed.assignments[0].criteria[0].review_guidance += " An unreviewed criterion."
    else:
        changed.evidence[0].locator += "/changed"
    assert changed.content_hash() != REVIEWED_DRAFT_SHA256
    monkeypatch.setattr(publication, "practical_python_foundations", lambda: changed)
    with pytest.raises(ValueError, match="changed after human review"):
        publication.practical_python_release()


def test_publication_does_not_change_either_original_mini_course_hash():
    assert python_foundations().content_hash() == "d6153df079457c4bb6869e64e8fb38d20117ec41ef86d18f72f71baa20e826fe"
    assert pytorch_fundamentals().content_hash() == "9d8a30d699edfaf5442ac73b75266873be9a86f9ee413cc5ed6175c4ff9dc2e2"
