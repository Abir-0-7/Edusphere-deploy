"""Offline human-review packets. Validation never publishes or supplies judgments."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, StrictBool, model_validator

from app.courses.contracts import Answer, Contract, CourseRelease


class HumanReviewer(Contract):
    name: str = Field(min_length=1, max_length=200)
    reviewed_at: datetime
    human_review_confirmed: StrictBool

    @model_validator(mode="after")
    def real_review(self):
        if not self.name.strip() or not self.human_review_confirmed:
            raise ValueError("A named human must explicitly confirm performing the review")
        if self.reviewed_at.tzinfo is None or self.reviewed_at.utcoffset() is None:
            raise ValueError("Human review time must include its timezone")
        return self


class ClaimCheck(Contract):
    id: str
    lesson_id: str
    module_id: str
    block_id: str
    claim_text: str
    evidence_ids: list[str]
    source_locators: list[str]
    reference_urls: list[str]
    excerpt_matches_source: StrictBool
    human_support: Literal["pending", "supported", "unsupported"] = "pending"
    human_reference: str | None = Field(default=None, max_length=2000)
    human_notes: str = Field(default="", max_length=4000)


class AssessmentCheck(Contract):
    exercise_id: str
    lesson_id: str
    module_id: str
    mode: Literal["practice", "checkpoint"]
    kind: Literal["choice", "number", "ordered", "multiple"]
    prompt: str
    choices: list[dict[str, str]]
    expected_answer: Answer
    explanation: str
    evidence_ids: list[str]
    human_correct: StrictBool | None = None
    severe_issue: StrictBool | None = None
    human_notes: str = Field(default="", max_length=4000)


class LessonCheck(Contract):
    lesson_id: str
    title: str
    module_id: str
    objective_ids: list[str]
    human_sufficient: StrictBool | None = None
    human_notes: str = Field(default="", max_length=4000)


class RubricCheck(Contract):
    assignment_id: str
    criterion_id: str
    description: str
    objective_ids: list[str]
    evidence_ids: list[str]
    review_guidance: str
    human_approved: StrictBool | None = None
    human_notes: str = Field(default="", max_length=4000)


class EvidenceCheck(Contract):
    evidence_id: str
    source_id: str
    locator: str
    quote: str
    reference_urls: list[str]
    excerpt_matches_source: StrictBool
    human_locator_checked: StrictBool | None = None
    human_notes: str = Field(default="", max_length=4000)


class FullCourseReview(Contract):
    schema_version: Literal["1"] = "1"
    release_id: UUID
    content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    title: str
    estimated_minutes: int
    reviewer: HumanReviewer | None = None
    rights_review_approved: StrictBool | None = None
    duration_scope_approved: StrictBool | None = None
    execution_disabled_confirmed: StrictBool | None = None
    capstone_cases_checked: StrictBool | None = None
    claims: list[ClaimCheck]
    assessments: list[AssessmentCheck]
    lessons: list[LessonCheck]
    rubric: list[RubricCheck]
    evidence: list[EvidenceCheck]
    review_notes: str = Field(default="", max_length=10000)


def build_review_packet(release: CourseRelease) -> FullCourseReview:
    """Materialize exact review scope, with all human decisions deliberately unset."""
    if release.size != "full" or release.visibility != "catalog" or release.status != "draft":
        raise ValueError("F05 review packets require an unpublished full-course catalog draft")
    if release.labs or any(ref.source_pin is not None for ref in release.evidence):
        raise ValueError("F05 cannot enable execution or republish private source pins")
    sources = {source.id: source for source in release.sources}
    evidence = {ref.id: ref for ref in release.evidence}
    exercises = {exercise.id: exercise for exercise in release.exercises}
    referenced = [identifier for lesson in release.lessons for identifier in
                  [*lesson.practice_ids, *lesson.checkpoint_ids]]
    if len(referenced) != len(set(referenced)) or set(referenced) != exercises.keys():
        raise ValueError("Every assessment must be referenced exactly once in the human review scope")
    modules = {lesson_id: module.id for module in release.modules for lesson_id in module.lesson_ids}
    claims, assessments, lessons, rubric = [], [], [], []
    for lesson in release.lessons:
        lessons.append(LessonCheck(lesson_id=lesson.id, title=lesson.title, module_id=modules[lesson.id],
                                   objective_ids=lesson.objective_ids))
        for block in lesson.blocks:
            refs = [evidence[identifier] for identifier in block.evidence_ids]
            resolves = all(" ".join(ref.quote.split()) in " ".join(sources[ref.source_id].body.split())
                           for ref in refs)
            # Every instructional block is in the sample, including examples.
            # Exact excerpt resolution is mechanical; semantic support is human.
            claims.append(ClaimCheck(
                id=f"claim-{block.id}", lesson_id=lesson.id, module_id=modules[lesson.id], block_id=block.id,
                claim_text=block.content, evidence_ids=block.evidence_ids,
                source_locators=[f"{ref.source_id}#{ref.locator}" for ref in refs],
                reference_urls=sorted({url for ref in refs for url in sources[ref.source_id].reference_urls}),
                excerpt_matches_source=bool(refs) and resolves,
            ))
        for identifier in [*lesson.practice_ids, *lesson.checkpoint_ids]:
            exercise = exercises[identifier]
            assessments.append(AssessmentCheck(
                exercise_id=exercise.id, lesson_id=lesson.id, module_id=modules[lesson.id], mode=exercise.mode,
                kind=exercise.kind, prompt=exercise.prompt,
                choices=[choice.model_dump() for choice in exercise.choices], expected_answer=exercise.answer,
                explanation=exercise.explanation, evidence_ids=exercise.evidence_ids,
            ))
    for assignment in release.assignments:
        for criterion in getattr(assignment, "criteria", []):
            rubric.append(RubricCheck(assignment_id=assignment.id, criterion_id=criterion.id,
                                     description=criterion.description, objective_ids=criterion.objective_ids,
                                     evidence_ids=criterion.evidence_ids, review_guidance=criterion.review_guidance))
    return FullCourseReview(release_id=release.id, content_hash=release.content_hash(), title=release.title,
                            estimated_minutes=release.estimated_minutes, claims=claims, assessments=assessments,
                            lessons=lessons, rubric=rubric, evidence=[EvidenceCheck(
                                evidence_id=ref.id, source_id=ref.source_id, locator=ref.locator, quote=ref.quote,
                                reference_urls=sources[ref.source_id].reference_urls,
                                excerpt_matches_source=" ".join(ref.quote.split()) in " ".join(
                                    sources[ref.source_id].body.split()),
                            ) for ref in release.evidence])


def _without_judgments(packet):
    data = packet.model_dump(mode="json")
    for name in ("reviewer", "rights_review_approved", "duration_scope_approved", "execution_disabled_confirmed",
                 "capstone_cases_checked", "review_notes"):
        data.pop(name)
    for claim in data["claims"]:
        for name in ("human_support", "human_reference", "human_notes"):
            claim.pop(name)
    for assessment in data["assessments"]:
        for name in ("human_correct", "severe_issue", "human_notes"):
            assessment.pop(name)
    for group, field in (("lessons", "human_sufficient"), ("rubric", "human_approved")):
        for item in data[group]:
            item.pop(field)
            item.pop("human_notes")
    for item in data["evidence"]:
        item.pop("human_locator_checked")
        item.pop("human_notes")
    return data


def evaluate_review(packet: FullCourseReview, release: CourseRelease) -> dict:
    """Report a human gate honestly. No status transition or catalog write occurs."""
    expected = build_review_packet(release)
    if _without_judgments(packet) != _without_judgments(expected):
        raise ValueError("Review scope differs from this exact release; regenerate and review the changed version")
    issues = []
    if packet.reviewer is None:
        issues.append("A named human reviewer and timezone-aware review date are required")
    for name in ("rights_review_approved", "duration_scope_approved", "execution_disabled_confirmed",
                 "capstone_cases_checked"):
        if getattr(packet, name) is not True:
            issues.append(f"Human confirmation missing: {name}")
    reviewed = sum(claim.human_support != "pending" for claim in packet.claims)
    supported = sum(claim.human_support == "supported" for claim in packet.claims)
    support_rate = supported / len(packet.claims) if reviewed == len(packet.claims) and packet.claims else None
    if not packet.claims or reviewed != len(packet.claims):
        issues.append("Every sampled instructional block needs a human support judgment")
    if support_rate is not None and support_rate < 0.95:
        issues.append("Observed human claim support is below the 95% target")
    if any(claim.human_support == "supported" and not (claim.human_reference or "").strip()
           for claim in packet.claims):
        issues.append("Supported claims need a human-supplied supporting reference or rationale")
    if (not packet.evidence or any(not item.excerpt_matches_source or item.human_locator_checked is not True
                                   for item in packet.evidence)):
        issues.append("Every evidence excerpt must match its source and its locator needs human confirmation")
    if not packet.assessments or any(item.human_correct is not True or item.severe_issue is not False
                                     for item in packet.assessments):
        issues.append("Every assessment key requires human verification with no unresolved key errors")
    if not packet.lessons or any(item.human_sufficient is not True for item in packet.lessons):
        issues.append("Every lesson needs human curriculum-sufficiency review")
    if not packet.rubric or any(item.human_approved is not True for item in packet.rubric):
        issues.append("Every capstone criterion needs human rubric/evidence review")
    return {
        "human_review_requirements_met": not issues,
        "published": False,
        "release_id": str(release.id), "content_hash": release.content_hash(),
        "sample_size": len(packet.claims), "human_reviewed_claims": reviewed,
        "human_supported_claims": supported, "human_support_rate": support_rate,
        "matching_claim_excerpts": sum(item.excerpt_matches_source for item in packet.claims),
        "evidence_items": len(packet.evidence),
        "matching_evidence_excerpts": sum(item.excerpt_matches_source for item in packet.evidence),
        "human_confirmed_locators": sum(item.human_locator_checked is True for item in packet.evidence),
        "assessment_keys": len(packet.assessments), "issues": issues,
    }
