"""Course contracts separate private grading keys from learner payloads."""

import hashlib
import json
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, StrictStr, model_validator

from app.source_versions.contracts import EvidencePin

Answer = StrictStr | StrictInt | StrictFloat | list[StrictStr]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class CourseSource(Contract):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    body: str = Field(min_length=1)
    reference_urls: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_urls(self):
        if any(
            urlsplit(url).scheme not in {"https", "http"} or not urlsplit(url).netloc for url in self.reference_urls
        ):
            raise ValueError("source references must use absolute HTTP(S) URLs")
        return self


class Evidence(Contract):
    id: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    locator: str = Field(min_length=1)
    quote: str = Field(min_length=1)
    source_pin: EvidencePin | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def matching_pin_quote(self):
        if self.source_pin is not None and self.source_pin.quote != self.quote:
            raise ValueError("pinned evidence quote must match the course evidence quote")
        return self


class Objective(Contract):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    prerequisites: list[str] = Field(default_factory=list)


class TeachingBlock(Contract):
    id: str = Field(min_length=1)
    type: Literal["explanation", "example", "code", "recap"]
    content: str = Field(min_length=1)
    language: str | None = None
    evidence_ids: list[str] = Field(min_length=1)


class Choice(Contract):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)


class Exercise(Contract):
    """Public exercise definition: no answer key, grading rule or correct flag."""

    id: str = Field(min_length=1)
    kind: Literal["choice", "number", "ordered", "multiple"]
    mode: Literal["practice", "checkpoint"]
    prompt: str = Field(min_length=1)
    choices: list[Choice] = Field(default_factory=list)
    objective_ids: list[str] = Field(min_length=1)
    evidence_ids: list[str] = Field(min_length=1)


class ExerciseKey(Exercise):
    answer: Answer
    explanation: str = Field(min_length=1)
    hint: str = Field(min_length=1)


class Lesson(Contract):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    objective_ids: list[str] = Field(min_length=1)
    blocks: list[TeachingBlock] = Field(min_length=1)
    practice_ids: list[str] = Field(min_length=1)
    checkpoint_ids: list[str] = Field(min_length=1)


class Module(Contract):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    lesson_ids: list[str] = Field(min_length=1)


class CourseLabTask(Contract):
    id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=2000)
    objective_ids: list[str] = Field(min_length=1)
    evidence_ids: list[str] = Field(min_length=1)
    runner_problem_id: str | None = Field(default=None, min_length=1, max_length=120)
    starter: str | None = Field(default=None, max_length=4000)
    starter_javascript: str | None = Field(default=None, max_length=4000)


class CourseLabTaskKey(CourseLabTask):
    expected_query: str | None = None
    expected_output: str | None = None


class CourseLab(Contract):
    id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=200)
    kind: Literal["sql_query", "git_shell", "code_editor"]
    instructions: str = Field(min_length=1, max_length=2000)
    workspace: str = Field(min_length=1, max_length=4000)
    starter: str = Field(max_length=4000)
    tasks: list[CourseLabTaskKey] = Field(min_length=1, max_length=12)


class CourseLabView(Contract):
    id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=200)
    kind: Literal["sql_query", "git_shell", "code_editor"]
    instructions: str = Field(min_length=1, max_length=2000)
    workspace: str = Field(min_length=1, max_length=4000)
    starter: str = Field(max_length=4000)
    tasks: list[CourseLabTask] = Field(min_length=1, max_length=12)


class CourseAssignment(Contract):
    id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=3000)
    deliverable: str = Field(min_length=1, max_length=2000)
    rubric: list[str] = Field(min_length=1, max_length=12)
    objective_ids: list[str] = Field(min_length=1)
    evidence_ids: list[str] = Field(min_length=1)


class CourseRelease(Contract):
    """Private seed/draft contract. Published content is immutable by hash."""

    id: UUID
    course_id: UUID
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    version: str = Field(min_length=1)
    size: Literal["mini", "full"]
    origin: Literal["prebuilt", "generated", "hybrid"]
    visibility: Literal["catalog", "private"]
    status: Literal["draft", "validated", "reviewed", "published", "retired"]
    user_id: str | None = None
    estimated_minutes: int = Field(ge=1, le=100000)
    prerequisites: list[str] = Field(default_factory=list)
    sources: list[CourseSource] = Field(min_length=1)
    evidence: list[Evidence] = Field(min_length=1)
    objectives: list[Objective] = Field(min_length=1)
    modules: list[Module] = Field(min_length=1)
    lessons: list[Lesson] = Field(min_length=1)
    exercises: list[ExerciseKey] = Field(min_length=1)
    labs: list[CourseLab] = Field(default_factory=list, max_length=12)
    assignments: list[CourseAssignment] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def validate_links(self):
        if self.visibility == "private" and not self.user_id:
            raise ValueError("private course release requires an owner")
        if self.visibility == "catalog" and self.user_id is not None:
            raise ValueError("private ownership cannot be published through catalog visibility")
        if self.visibility == "catalog" and any(ref.source_pin is not None for ref in self.evidence):
            raise ValueError("private source pins cannot enter the catalog before editorial review")
        sources = {source.id: source for source in self.sources}
        evidence = {ref.id: ref for ref in self.evidence}
        objectives = {objective.id: objective for objective in self.objectives}
        exercises = {exercise.id: exercise for exercise in self.exercises}
        for values, identifiers in (
            (self.sources, sources),
            (self.evidence, evidence),
            (self.objectives, objectives),
            (self.exercises, exercises),
            (self.lessons, {lesson.id for lesson in self.lessons}),
            (self.labs, {lab.id for lab in self.labs}),
            (self.assignments, {assignment.id for assignment in self.assignments}),
        ):
            if len(values) != len(identifiers):
                raise ValueError("course identifiers must be unique within their kind")
        for ref in self.evidence:
            source = sources.get(ref.source_id)
            if source is None or " ".join(ref.quote.split()) not in " ".join(source.body.split()):
                raise ValueError("evidence quote must exist in its source version")
        for lab in self.labs:
            if len({task.id for task in lab.tasks}) != len(lab.tasks):
                raise ValueError("lab task identifiers must be unique")
            for task in lab.tasks:
                if not set(task.objective_ids) <= objectives.keys() or not set(task.evidence_ids) <= evidence.keys():
                    raise ValueError("lab task references unknown objective or evidence")
                if lab.kind == "sql_query" and (not task.expected_query or not task.expected_output):
                    raise ValueError("SQL lab tasks require an authored target and fixed output")
                if lab.kind == "code_editor" and not task.runner_problem_id:
                    raise ValueError("code labs require an allowlisted sandbox problem")
        for assignment in self.assignments:
            if (
                not set(assignment.objective_ids) <= objectives.keys()
                or not set(assignment.evidence_ids) <= evidence.keys()
            ):
                raise ValueError("assignment references unknown objective or evidence")
        visiting, visited = set(), set()

        def visit(identifier):
            if identifier in visiting:
                raise ValueError("objective prerequisites contain a cycle")
            if identifier not in objectives:
                raise ValueError("unknown objective prerequisite")
            if identifier in visited:
                return
            visiting.add(identifier)
            for prerequisite in objectives[identifier].prerequisites:
                visit(prerequisite)
            visiting.remove(identifier)
            visited.add(identifier)

        for objective in self.objectives:
            visit(objective.id)
        for exercise in self.exercises:
            if (
                not set(exercise.objective_ids) <= objectives.keys()
                or not set(exercise.evidence_ids) <= evidence.keys()
            ):
                raise ValueError("exercise references unknown objective or evidence")
            ids = {choice.id for choice in exercise.choices}
            if len(ids) != len(exercise.choices):
                raise ValueError("choice identifiers must be unique")
            if exercise.kind == "choice" and (not isinstance(exercise.answer, str) or exercise.answer not in ids):
                raise ValueError("choice answer must identify a choice")
            if exercise.kind in {"ordered", "multiple"} and (
                not isinstance(exercise.answer, list)
                or not exercise.answer
                or len(exercise.answer) != len(set(exercise.answer))
                or not set(exercise.answer) <= ids
            ):
                raise ValueError("list answer must identify choices")
            if exercise.kind == "ordered" and set(exercise.answer) != ids:
                raise ValueError("ordered key must include every choice once")
            if exercise.kind == "number" and type(exercise.answer) not in {int, float}:
                raise ValueError("number exercise requires numeric key")
        seen_blocks = set()
        lesson_ids = [lesson.id for lesson in self.lessons]
        module_lessons = [identifier for module in self.modules for identifier in module.lesson_ids]
        if len({module.id for module in self.modules}) != len(self.modules) or module_lessons != lesson_ids:
            raise ValueError("modules must contain each lesson once in teaching order")
        taught = set()
        for lesson in self.lessons:
            if not set(lesson.objective_ids) <= objectives.keys():
                raise ValueError("lesson references unknown objective")
            if any(not set(objectives[identifier].prerequisites) <= taught for identifier in lesson.objective_ids):
                raise ValueError("objective prerequisite must be taught in an earlier lesson")
            taught.update(lesson.objective_ids)
            material = " ".join(" ".join(block.content for block in lesson.blocks).split())
            refs = {identifier for block in lesson.blocks for identifier in block.evidence_ids}
            if any(
                identifier not in evidence or " ".join(evidence[identifier].quote.split()) not in material
                for identifier in refs
            ):
                raise ValueError("lesson evidence must be included in its materialized teaching content")
            for block in lesson.blocks:
                if block.id in seen_blocks or not set(block.evidence_ids) <= evidence.keys():
                    raise ValueError("teaching block identifier or evidence is invalid")
                seen_blocks.add(block.id)
            for mode, ids in (("practice", lesson.practice_ids), ("checkpoint", lesson.checkpoint_ids)):
                if len(ids) != len(set(ids)) or any(
                    identifier not in exercises or exercises[identifier].mode != mode for identifier in ids
                ):
                    raise ValueError("lesson references invalid exercise")
                if any(not set(exercises[identifier].objective_ids) <= set(lesson.objective_ids) for identifier in ids):
                    raise ValueError("exercise objectives do not belong to its lesson")
        return self

    def content_hash(self) -> str:
        content = self.model_dump(mode="json")
        # Preserve hashes of releases authored before optional versioned pins.
        for ref in content["evidence"]:
            if ref.get("source_pin") is None:
                ref.pop("source_pin", None)
        # Keep hashes of releases authored before labs/assignments were added stable.
        if not self.labs:
            content.pop("labs", None)
        if not self.assignments:
            content.pop("assignments", None)
        return hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()


class CourseSummary(Contract):
    id: UUID
    release_id: UUID
    slug: str
    title: str
    description: str
    version: str
    size: Literal["mini", "full"]
    origin: Literal["prebuilt", "generated", "hybrid"]
    estimated_minutes: int
    lesson_count: int
    prerequisites: list[str]


class CatalogResponse(Contract):
    courses: list[CourseSummary]


class CourseDetail(CourseSummary):
    objectives: list[Objective]
    lesson_titles: list[str]
    evidence: list[Evidence]
    reference_urls: list[str]
    prerequisite_met: bool
    modules: list[Module]
    labs: list[CourseLabView] = Field(default_factory=list)
    assignments: list[CourseAssignment] = Field(default_factory=list)


class MaterialEvidence(Evidence):
    document_id: UUID
    chapter_id: UUID
    chunk_id: UUID


class LessonView(Contract):
    id: str
    title: str
    objective_ids: list[str]
    blocks: list[TeachingBlock]
    practice: list[Exercise]
    checkpoint: Exercise | None


class LessonSummary(Contract):
    id: str
    title: str
    completed: bool
    objective_ids: list[str] = Field(default_factory=list)
    demonstrated_objective_ids: list[str] = Field(default_factory=list)


class ObjectiveAdaptation(Contract):
    objective_id: str
    role: Literal["analyst", "developer"]
    example_title: str
    example: str
    explanation_depth: Literal["guided", "standard", "concise"]
    depth_note: str
    pace: Literal["short_sessions", "standard"]
    pace_note: str
    evidence_ids: list[str] = Field(min_length=1)


class LearningAdaptation(Contract):
    role: Literal["analyst", "developer"]
    explanation_depth: Literal["guided", "standard", "concise"]
    pace: Literal["short_sessions", "standard"]
    variants: list[ObjectiveAdaptation]


class RemediationView(Contract):
    objective_id: str
    step: Literal["bridge", "checkpoint"]
    title: str
    explanation: str
    worked_example: str
    evidence_ids: list[str] = Field(min_length=1)
    exercise: Exercise


class LastAction(Contract):
    id: UUID
    exercise_id: str
    kind: Literal["attempt", "hint", "reveal"]
    answer: Answer | None
    correct: bool | None
    message: str
    revision: int


class LabTranscriptEntry(Contract):
    text: str = Field(max_length=4000)
    output: str = Field(max_length=2000)
    accepted: bool
    progress: int = Field(ge=0)


class SessionResponse(Contract):
    id: UUID
    release_id: UUID
    document_id: UUID
    course_slug: str
    course_title: str
    revision: int
    status: Literal["active", "completed"]
    completed_lesson_ids: list[str]
    lessons: list[LessonSummary]
    lesson: LessonView
    evidence: list[MaterialEvidence]
    last_action: LastAction | None
    notes: list["LessonNote"] = Field(default_factory=list)
    bookmarks: list["LessonBookmark"] = Field(default_factory=list)
    conversation: list["CourseChatMessage"] = Field(default_factory=list, max_length=40)
    adaptation: LearningAdaptation | None = None
    remediation: RemediationView | None = None
    assignment_drafts: dict[str, str] = Field(default_factory=dict, max_length=8)
    assignment_status: dict[str, Literal["draft", "submitted"]] = Field(default_factory=dict, max_length=8)
    lab_progress: dict[str, int] = Field(default_factory=dict, max_length=12)
    lab_transcripts: dict[str, list[LabTranscriptEntry]] = Field(default_factory=dict, max_length=12)


class SessionListResponse(Contract):
    sessions: list[SessionResponse]


class DiagnosticQuestion(Contract):
    id: str
    prompt: str
    kind: Literal["number", "text"]


class DiagnosticResponse(Contract):
    questions: list[DiagnosticQuestion]


class EnrollmentRequest(Contract):
    diagnostic_answers: dict[str, Answer] | None = None


class AttemptRequest(Contract):
    id: UUID
    revision: StrictInt = Field(ge=0)
    exercise_id: str = Field(min_length=1, max_length=200)
    answer: Answer


class AssistanceRequest(Contract):
    id: UUID
    revision: StrictInt = Field(ge=0)
    exercise_id: str = Field(min_length=1, max_length=200)
    kind: Literal["hint", "reveal"]


class AdvanceRequest(Contract):
    revision: StrictInt = Field(ge=0)


class LessonNote(Contract):
    id: UUID
    lesson_id: str = Field(min_length=1, max_length=200)
    text: str = Field(max_length=5000)


class LessonBookmark(Contract):
    lesson_id: str = Field(min_length=1, max_length=200)
    evidence_id: str = Field(min_length=1, max_length=200)


class StudyNotesRequest(Contract):
    revision: StrictInt = Field(ge=0)
    notes: list[LessonNote] = Field(max_length=100)
    bookmarks: list[LessonBookmark] = Field(max_length=100)


class StudyNotesResponse(Contract):
    id: UUID
    revision: int
    notes: list[LessonNote]
    bookmarks: list[LessonBookmark]


class AssignmentDraftRequest(Contract):
    id: UUID
    revision: StrictInt = Field(ge=0)
    assignment_id: str = Field(min_length=1, max_length=120)
    action: Literal["save", "submit"]
    text: StrictStr = Field(max_length=5000)


class AssignmentDraftResponse(Contract):
    id: UUID
    assignment_id: str
    status: Literal["draft", "submitted"]
    revision: int
    replayed: bool


class LabRunRequest(Contract):
    id: UUID
    revision: StrictInt = Field(ge=0)
    lab_id: str = Field(min_length=1, max_length=120)
    task_id: str | None = Field(default=None, max_length=120)
    text: StrictStr = Field(max_length=20000)
    runner_receipt: str | None = Field(default=None, max_length=256)
    runner_problem_id: str | None = Field(default=None, max_length=120)
    runner_language: Literal["python", "javascript"] | None = None


class LabRunResponse(Contract):
    id: UUID
    lab_id: str
    output: str = Field(max_length=2000)
    accepted: bool
    progress: int = Field(ge=0)
    complete: bool
    revision: int
    replayed: bool


class CourseChatMessage(Contract):
    id: UUID
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)
    evidence_ids: list[str] = Field(default_factory=list, max_length=20)


class CourseChatRequest(Contract):
    id: UUID
    revision: StrictInt = Field(ge=0)
    question: str = Field(min_length=1, max_length=2000)


class CourseChatResponse(Contract):
    id: UUID
    question: str
    answer: str
    evidence_ids: list[str] = Field(max_length=20)
    revision: int
    replayed: bool


class AttemptResponse(Contract):
    id: UUID
    exercise_id: str
    correct: bool
    independent: bool
    lesson_complete: bool
    course_complete: bool
    feedback: str
    revision: int
    replayed: bool


class AssistanceResponse(Contract):
    id: UUID
    exercise_id: str
    kind: Literal["hint", "reveal"]
    message: str
    revision: int
    replayed: bool
