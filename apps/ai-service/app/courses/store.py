"""Owner-scoped courses with immutable releases and resumable server state."""

import copy
import json
import threading
import uuid
from collections import Counter
from datetime import UTC, datetime

from app.courses import engine
from app.courses.catalog import catalog, stable_id
from app.courses.contracts import (
    AssignmentDraftRequest,
    AssignmentDraftResponse,
    CourseChatMessage,
    CourseChatRequest,
    CourseChatResponse,
    CourseRelease,
    LabRunRequest,
    LabRunResponse,
    StudyNotesRequest,
)
from app.courses.labs import run_lab
from app.courses.upgrade_contracts import (
    CourseUpgradeApplyRequest,
    CourseUpgradePreview,
    CourseUpgradePreviewRequest,
    CourseUpgradeReceipt,
    CourseUpgradeResponse,
)
from app.courses.upgrades import prepare_upgrade, verify_acceptance
from app.documents.store import ChapterRecord, ChunkRecord, InMemoryDocumentStore
from app.errors import Conflict, InvalidInput, NotFound

_MISCONCEPTION_ATTEMPT_LIMIT = 500
_TRACK_ATTEMPT_PREVIEW_LIMIT = 500


def _authorized(release: CourseRelease, user_id: str, *, published_only=False):
    if release.visibility == "private" and release.user_id != user_id:
        raise NotFound("course not found")
    if release.visibility == "catalog" and release.status != "published":
        raise NotFound("course not found")
    if published_only and release.status != "published":
        raise InvalidInput("course release is not published")


def _validate_source_pins(release: CourseRelease, source_versions, *, conn=None) -> None:
    """Check each private pin against its exact authorized immutable snapshot."""
    pins = [ref.source_pin for ref in release.evidence if ref.source_pin is not None]
    if not pins:
        return
    if release.visibility != "private" or not release.user_id:
        raise InvalidInput("private source pins cannot enter the catalog before editorial review")
    if source_versions is None:
        raise InvalidInput("source version resolver is required for pinned course evidence")
    for pin in pins:
        if conn is None:
            source_versions.resolve(release.user_id, pin)
        else:
            source_versions.resolve(release.user_id, pin, conn=conn)


def _material(release: CourseRelease, enrollment_id: str, document_id: str, user_id: str):
    chapters, chunks = [], []
    markdown = []
    for index, lesson in enumerate(release.lessons, start=1):
        chapter_id = stable_id(f"{enrollment_id}/chapter/{lesson.id}")
        chapters.append(ChapterRecord(chapter_id, document_id, user_id, lesson.title, index, index, index))
        body = "\n\n".join(block.content for block in lesson.blocks)
        markdown.append(f"## {lesson.title}\n\n{body}")
        chunks.append(
            ChunkRecord(
                stable_id(f"{enrollment_id}/chunk/{lesson.id}"), document_id, user_id, chapter_id, body, index, index
            )
        )
    return "\n\n".join(markdown), chapters, chunks


def _enrollment(identifier, user_id, release_id, document_id, state=None, revision=0, status="active"):
    return {
        "id": str(identifier),
        "user_id": user_id,
        "release_id": str(release_id),
        "document_id": str(document_id),
        "state": state or engine.initial_state(),
        "revision": revision,
        "status": status,
    }


def _upgraded_enrollment(user_id, identifier, document_id, request, preview, state, target):
    receipt = CourseUpgradeReceipt(
        id=request.id,
        from_enrollment_id=preview.from_enrollment_id,
        to_enrollment_id=identifier,
        from_document_id=preview.from_document_id,
        from_revision=preview.from_revision,
        from_release_id=preview.from_release_id,
        from_content_hash=preview.from_content_hash,
        target_release_id=preview.target_release_id,
        target_content_hash=preview.target_content_hash,
        preview_hash=preview.preview_hash,
        retained_lesson_ids=preview.retained_lesson_ids,
        retained_objective_ids=preview.retained_objective_ids,
        created_at=datetime.now(UTC).isoformat(),
    )
    state["upgrade_receipt"] = receipt.model_dump(mode="json")
    row = _enrollment(identifier, user_id, target.id, document_id, state=state)
    engine.update_completion(row, target)
    return row, CourseUpgradeResponse(session=engine.session_view(row, target), receipt=receipt, replayed=False)


def _upgrade_replay(enrollment_id, request, candidate, release):
    receipt = CourseUpgradeReceipt.model_validate(candidate["state"]["upgrade_receipt"])
    if (str(receipt.from_enrollment_id) != str(enrollment_id)
            or receipt.id != request.id or receipt.from_revision != request.expected_revision
            or receipt.target_release_id != request.target_release_id
            or receipt.target_content_hash != request.target_content_hash
            or receipt.preview_hash != request.preview_hash):
        raise Conflict("Upgrade action ID was already used with different input")
    return CourseUpgradeResponse(session=engine.session_view(candidate, release), receipt=receipt, replayed=True)


def _check_upgrade_prerequisites(original, target, completed_slugs):
    # An existing enrollment proves prior admission, including admission by diagnostic.
    if not engine.prerequisite_met(target, completed_slugs | set(original.prerequisites)):
        raise InvalidInput("Complete the newly required courses before upgrading")


def _assignment_action(enrollment, release: CourseRelease, request: AssignmentDraftRequest) -> AssignmentDraftResponse:
    assignment = next((item for item in release.assignments if item.id == request.assignment_id), None)
    if assignment is None:
        raise InvalidInput("assignment is not part of this course release")
    state = enrollment["state"]
    actions = state.get("assignment_actions", {})
    identifier = str(request.id)
    fingerprint = {
        "assignment_id": request.assignment_id,
        "action": request.action,
        "text": request.text,
        "revision": request.revision,
    }
    # Empty new fields preserve pre-F05 action fingerprints and old retries.
    if request.sections:
        fingerprint["sections"] = request.sections
    if request.evidence_ids:
        fingerprint["evidence_ids"] = request.evidence_ids
    prior = actions.get(identifier)
    if prior is not None:
        if prior["fingerprint"] != fingerprint:
            raise InvalidInput("assignment action id was already used with different input")
        return AssignmentDraftResponse.model_validate({**prior["result"], "replayed": True})
    engine.require_revision(enrollment, request.revision)
    sections = {section.id: section for section in assignment.sections}
    if not set(request.sections) <= sections.keys():
        raise InvalidInput("assignment section is not part of this course assignment")
    if not set(request.evidence_ids) <= set(assignment.evidence_ids):
        raise InvalidInput("assignment evidence is not part of this course assignment")
    if any(len(value) > sections[identifier].max_chars for identifier, value in request.sections.items()):
        raise InvalidInput("assignment section exceeds its authored maximum")
    if request.action == "submit":
        if assignment.id in release.required_assignment_ids and not {lesson.id for lesson in release.lessons} <= set(
            state["completed_lesson_ids"]
        ):
            raise InvalidInput("Complete all lesson and module checkpoints before submitting the required project")
        if sections:
            if set(request.sections) != sections.keys() or any(
                not section.min_chars <= len(request.sections[identifier].strip()) <= section.max_chars
                for identifier, section in sections.items()
            ):
                raise InvalidInput("Complete every project section within its authored length bounds before submitting")
        elif len(request.text.strip()) < 80:
            raise InvalidInput("Add a short explanation before submitting this assignment")
        if assignment.require_evidence and not request.evidence_ids:
            raise InvalidInput("Select approved assignment evidence before submitting")
    drafts = state.setdefault("assignment_drafts", {})
    statuses = state.setdefault("assignment_status", {})
    drafts[request.assignment_id] = request.text
    statuses[request.assignment_id] = "submitted" if request.action == "submit" else "draft"
    state.setdefault("assignment_sections", {})[request.assignment_id] = dict(request.sections)
    state.setdefault("assignment_evidence_ids", {})[request.assignment_id] = list(request.evidence_ids)
    engine.update_completion(enrollment, release)
    enrollment["revision"] += 1
    result = AssignmentDraftResponse(
        id=request.id,
        assignment_id=request.assignment_id,
        status=statuses[request.assignment_id],
        revision=enrollment["revision"],
        replayed=False,
        sections=request.sections,
        evidence_ids=request.evidence_ids,
    )
    actions[identifier] = {"fingerprint": fingerprint, "result": result.model_dump(mode="json")}
    state["assignment_actions"] = actions
    for stale_id in list(actions)[:-40]:
        del actions[stale_id]
    return result


def _lab_action(enrollment, release: CourseRelease, request: LabRunRequest, user_id: str) -> LabRunResponse:
    lab = next((item for item in release.labs if item.id == request.lab_id), None)
    if lab is None:
        raise InvalidInput("lab is not part of this course release")
    if lab.kind == "sql_query" and request.task_id is None:
        raise InvalidInput("select one SQL lab task")
    if lab.kind == "git_shell" and request.task_id is not None:
        raise InvalidInput("the simulated shell chooses its next task automatically")
    if lab.kind == "code_editor" and request.task_id is None:
        raise InvalidInput("select one coding task")
    return run_lab(lab, enrollment, request, user_id)


class MemoryCourseStore:
    """Explicit dev/test store; no production persistence fallback."""

    def __init__(self, documents: InMemoryDocumentStore, releases=None, *, source_versions=None):
        self.documents = documents
        self.source_versions = source_versions
        self._lock = threading.RLock()
        self._releases = {}
        self._enrollments = {}
        self._actions = {}
        for release in releases if releases is not None else catalog():
            self.save_release(release)

    def save_release(self, release: CourseRelease):
        with self._lock:
            _validate_source_pins(release, self.source_versions)
            identifier = str(release.id)
            old = self._releases.get(identifier)
            if old is not None and (old.course_id, old.user_id, old.version) != (
                release.course_id,
                release.user_id,
                release.version,
            ):
                raise InvalidInput("release identity and ownership cannot change")
            if any(
                item.course_id == release.course_id
                and (item.user_id, item.slug) != (release.user_id, release.slug)
                or item.slug == release.slug
                and item.course_id != release.course_id
                for item in self._releases.values()
            ):
                raise InvalidInput("course identity and ownership cannot change")
            if (
                old is not None
                and old.status in {"published", "retired"}
                and old.content_hash() != release.content_hash()
            ):
                raise InvalidInput("published releases are immutable; create a new release version")
            if any(
                item.course_id == release.course_id and item.version == release.version and item.id != release.id
                for item in self._releases.values()
            ):
                raise InvalidInput("course version already exists")
            self._releases[identifier] = release.model_copy(deep=True)

    def list_courses(self, user_id: str):
        with self._lock:
            latest = {
                item.slug: item
                for item in self._releases.values()
                if item.visibility == "catalog" and item.status == "published"
            }
            return [item.model_copy(deep=True) for item in latest.values()]

    def get_release(self, slug: str, user_id: str):
        with self._lock:
            candidates = [
                item
                for item in self._releases.values()
                if item.slug == slug
                and (item.user_id == user_id or item.visibility == "catalog" and item.status == "published")
            ]
            if not candidates:
                raise NotFound("course not found")
            release = candidates[-1]
            _authorized(release, user_id)
            _validate_source_pins(release, self.source_versions)
            return release.model_copy(deep=True)

    def pinned_course_detail(self, user_id: str, enrollment_id: str):
        """Return the exact release pinned by this enrollment, never latest-by-slug."""
        with self._lock:
            _, release = self._owned(user_id, enrollment_id)
            return release.model_copy(deep=True)

    def _release_by_id(self, user_id: str, release_id: str):
        release = self._releases.get(str(release_id))
        if release is None:
            raise NotFound("course release not found")
        _authorized(release, user_id, published_only=True)
        _validate_source_pins(release, self.source_versions)
        return release

    def preview_upgrade(
        self, user_id: str, enrollment_id: str, request: CourseUpgradePreviewRequest,
    ) -> CourseUpgradePreview:
        with self._lock:
            row, original = self._owned(user_id, enrollment_id)
            target = self._release_by_id(user_id, str(request.target_release_id))
            _check_upgrade_prerequisites(original, target, self.completed_slugs(user_id))
            preview, _ = prepare_upgrade(row, original, target)
            return preview

    def apply_upgrade(self, user_id: str, enrollment_id: str, request: CourseUpgradeApplyRequest):
        with self._lock:
            row, original = self._owned(user_id, enrollment_id)
            # Idempotent replay is found on the new target row. The source row is
            # never modified to record upgrade history.
            for candidate in self._enrollments.values():
                if candidate["user_id"] != user_id:
                    continue
                receipt = candidate["state"].get("upgrade_receipt")
                if receipt and receipt.get("id") == str(request.id):
                    owned, release = self._owned(user_id, candidate["id"])
                    return _upgrade_replay(enrollment_id, request, owned, release)
            target = self._release_by_id(user_id, str(request.target_release_id))
            if row["revision"] != request.expected_revision:
                raise Conflict("Enrollment changed; refresh the upgrade preview")
            _check_upgrade_prerequisites(original, target, self.completed_slugs(user_id))
            preview, state = prepare_upgrade(row, original, target)
            verify_acceptance(preview, request)
            if any(candidate["user_id"] == user_id and candidate["release_id"] == str(target.id)
                   for candidate in self._enrollments.values()):
                raise Conflict("You already have an enrollment for this release; open it from your courses")
            identifier, document_id = str(uuid.uuid4()), str(uuid.uuid4())
            markdown, chapters, chunks = _material(target, identifier, document_id, user_id)
            target_row, result = _upgraded_enrollment(user_id, identifier, document_id, request, preview, state, target)
            self.documents.create_parsed_course_document(
                document_id, user_id=user_id, filename=f"{target.slug}-v{target.version}.md",
                markdown=markdown, chapters=chapters, chunks=chunks,
            )
            self._enrollments[identifier] = target_row
            return result

    def completed_slugs(self, user_id: str):
        with self._lock:
            return {
                self._releases[row["release_id"]].slug
                for row in self._enrollments.values()
                if row["user_id"] == user_id and row["status"] == "completed"
            }

    def track_attempt_counts(self, user_id: str) -> dict[str, int]:
        """Count committed attempts against server-authored objective links."""
        with self._lock:
            counts: dict[str, int] = {}
            included = 0
            for saved in reversed(self._actions.values()):
                if saved["user_id"] != user_id or saved["fingerprint"]["kind"] != "attempt":
                    continue
                enrollment_id = saved["fingerprint"]["enrollment_id"]
                row = self._enrollments.get(enrollment_id)
                if row is None or row["user_id"] != user_id:
                    continue
                if self.documents.get_for_user(row["document_id"], user_id) is None:
                    continue
                release = self._releases.get(row["release_id"])
                request = saved["fingerprint"]["request"]
                if release is None or release.visibility != "catalog":
                    continue
                included += 1
                exercise = next((item for item in release.exercises if item.id == request["exercise_id"]), None)
                if exercise is not None:
                    for objective_id in exercise.objective_ids:
                        counts[objective_id] = counts.get(objective_id, 0) + 1
                if included >= _TRACK_ATTEMPT_PREVIEW_LIMIT:
                    break
            return counts

    def enroll(self, user_id: str, slug: str, diagnostic=None):
        with self._lock:
            release = self.get_release(slug, user_id)
            _authorized(release, user_id, published_only=True)
            for row in self._enrollments.values():
                if row["user_id"] == user_id and row["release_id"] == str(release.id):
                    return engine.session_view(row, release)
            if not engine.prerequisite_met(release, self.completed_slugs(user_id), diagnostic):
                raise InvalidInput("Complete Python Foundations or pass the prerequisite diagnostic first")
            identifier = str(uuid.uuid4())
            doc = self.documents.create(
                user_id=user_id,
                filename=f"{slug}-v{release.version}.md",
                mime_type="text/markdown",
                size_bytes=sum(len(s.body.encode()) for s in release.sources),
            )
            markdown, chapters, chunks = _material(release, identifier, doc.id, user_id)
            self.documents.mark_parsed(doc.id, markdown=markdown, page_count=len(chapters))
            self.documents.replace_structure(doc.id, chapters, chunks)
            row = _enrollment(identifier, user_id, release.id, doc.id)
            self._enrollments[identifier] = row
            return engine.session_view(row, release)

    def _owned(self, user_id, enrollment_id):
        row = self._enrollments.get(str(enrollment_id))
        if row is None or row["user_id"] != user_id:
            raise NotFound("learning session not found")
        if self.documents.get_for_user(row["document_id"], user_id) is None:
            raise NotFound("learning source was removed")
        release = self._releases[row["release_id"]]
        _validate_source_pins(release, self.source_versions)
        return row, release

    def get_session(self, user_id: str, enrollment_id: str):
        with self._lock:
            row, release = self._owned(user_id, enrollment_id)
            return engine.session_view(row, release)

    def list_sessions(self, user_id: str):
        with self._lock:
            return [
                engine.session_view(*self._owned(user_id, row["id"]))
                for row in self._enrollments.values()
                if row["user_id"] == user_id and self.documents.get_for_user(row["document_id"], user_id) is not None
            ]

    def graph_lesson_context(self, user_id: str, document_id: str, chapter_id: str):
        """Resolve a read-only graph handoff against this owner's pinned release."""
        with self._lock:
            for row in self._enrollments.values():
                if row["user_id"] != user_id or row["document_id"] != document_id:
                    continue
                owned, release = self._owned(user_id, row["id"])
                for lesson in release.lessons:
                    if stable_id(f"{owned['id']}/chapter/{lesson.id}") == chapter_id:
                        return {
                            "enrollment_id": owned["id"], "course_slug": release.slug, "lesson_id": lesson.id,
                            "objective_ids": lesson.objective_ids, "title": lesson.title,
                            "content": "\n\n".join(block.content for block in lesson.blocks),
                        }
        return None

    def misconception_counts(self, user_id: str) -> dict[str, int]:
        """Count recent owner-scoped mistakes on unaided checkpoints only."""
        with self._lock:
            counts: Counter[str] = Counter()
            included = 0
            for saved in reversed(self._actions.values()):
                if saved["user_id"] != user_id or saved["fingerprint"]["kind"] != "attempt":
                    continue
                result = saved["result"]
                if result.get("correct") is not False or result.get("independent") is not True:
                    continue
                try:
                    _, release = self._owned(user_id, saved["fingerprint"]["enrollment_id"])
                except NotFound:
                    continue
                exercise = next((item for item in release.exercises if item.id == result["exercise_id"]), None)
                if exercise and exercise.mode == "checkpoint":
                    counts.update(exercise.objective_ids)
                    included += 1
                    if included >= _MISCONCEPTION_ATTEMPT_LIMIT:
                        break
            return dict(counts)

    def action(self, user_id: str, enrollment_id: str, kind: str, request: dict):
        with self._lock:
            row, release = self._owned(user_id, enrollment_id)
            identifier = str(request["id"])
            saved = self._actions.get(identifier)
            fingerprint = {"enrollment_id": str(enrollment_id), "kind": kind, "request": request}
            if saved is not None:
                if saved["user_id"] != user_id or saved["fingerprint"] != fingerprint:
                    raise InvalidInput("action id was already used with different input")
                return {**copy.deepcopy(saved["result"]), "replayed": True}
            updated = copy.deepcopy(row)
            checkpoint_lesson = release.lessons[updated["state"]["lesson_index"]]
            engine.require_revision(updated, request["revision"])
            exercise = engine.current_exercise(release, updated["state"], request["exercise_id"])
            result = (
                engine.attempt(updated, release, request)
                if kind == "attempt"
                else engine.assist(updated, release, request)
            )
            if kind == "attempt" and exercise.mode == "checkpoint" and result["correct"] and result["independent"]:
                evidence_id = exercise.evidence_ids[0]
                evidence = next(item for item in release.evidence if item.id == evidence_id)
                self.documents.add_flashcards(
                    [
                        {
                            "id": stable_id(f"{enrollment_id}/checkpoint-card/{exercise.id}"),
                            "chapter_id": stable_id(f"{enrollment_id}/chapter/{checkpoint_lesson.id}"),
                            "source_chunk_id": stable_id(f"{enrollment_id}/chunk/{checkpoint_lesson.id}"),
                            "front": exercise.prompt,
                            "back": f"{exercise.explanation}\n\nAnswer: {json.dumps(exercise.answer)}",
                            "source_quote": evidence.quote,
                        }
                    ],
                    document_id=updated["document_id"],
                    user_id=user_id,
                    due_date=datetime.now(UTC).date().isoformat(),
                )
            self._enrollments[str(enrollment_id)] = updated
            self._actions[identifier] = {
                "user_id": user_id,
                "fingerprint": copy.deepcopy(fingerprint),
                "result": copy.deepcopy(result),
            }
            return result

    def advance(self, user_id: str, enrollment_id: str, revision: int):
        with self._lock:
            row, release = self._owned(user_id, enrollment_id)
            updated = copy.deepcopy(row)
            engine.advance(updated, release, revision)
            self._enrollments[str(enrollment_id)] = updated
            return engine.session_view(updated, release)

    def update_study_notes(self, user_id: str, enrollment_id: str, request: StudyNotesRequest):
        with self._lock:
            row, release = self._owned(user_id, enrollment_id)
            engine.save_study_notes(row, release, request)
            return engine.session_view(row, release)

    def save_assignment(self, user_id: str, enrollment_id: str, request: AssignmentDraftRequest):
        with self._lock:
            row, release = self._owned(user_id, enrollment_id)
            result = _assignment_action(row, release, request)
            self._enrollments[str(enrollment_id)] = row
            return result

    def run_lab(self, user_id: str, enrollment_id: str, request: LabRunRequest):
        with self._lock:
            row, release = self._owned(user_id, enrollment_id)
            result = _lab_action(row, release, request, user_id)
            self._enrollments[str(enrollment_id)] = row
            return result

    def get_tutor_result(self, user_id: str, enrollment_id: str, request: CourseChatRequest):
        with self._lock:
            row, _ = self._owned(user_id, enrollment_id)
            fingerprint = {
                "enrollment_id": str(enrollment_id),
                "question": request.question,
                "revision": request.revision,
            }
            prior = row["state"].get("chat_actions", {}).get(str(request.id))
            if prior is None:
                engine.require_tutor_available(row, request.revision)
                return None
            if prior["fingerprint"] != fingerprint:
                raise InvalidInput("tutor request id was already used with different input")
            return CourseChatResponse.model_validate({**prior["result"], "replayed": True})

    def ask_tutor(self, user_id: str, enrollment_id: str, request: CourseChatRequest, tutor=None):
        """Answer from the pinned release and persist a bounded, replay-safe transcript."""
        from app.courses.tutor import answer_course_question

        with self._lock:
            row, release = self._owned(user_id, enrollment_id)
            state = row["state"]
            actions = state.setdefault("chat_actions", {})
            fingerprint = {
                "enrollment_id": str(enrollment_id),
                "question": request.question,
                "revision": request.revision,
            }
            prior = actions.get(str(request.id))
            if prior is not None:
                if prior["fingerprint"] != fingerprint:
                    raise InvalidInput("tutor request id was already used with different input")
                return CourseChatResponse.model_validate({**prior["result"], "replayed": True})
            engine.require_tutor_available(row, request.revision)
            session = engine.session_view(row, release)
            answer, evidence_ids = (
                tutor(session, request.question, user_id)
                if tutor is not None
                else answer_course_question(session, request.question)
            )
            allowed = {item.id for item in session.evidence}
            if not isinstance(answer, str) or not answer.strip() or len(answer) > 4000:
                raise InvalidInput("tutor answer was empty or exceeded the response limit", status_code=502)
            if not set(evidence_ids) <= allowed:
                raise InvalidInput("tutor returned evidence outside the active lesson", status_code=502)
            response = CourseChatResponse(
                id=request.id,
                question=request.question,
                answer=answer.strip(),
                evidence_ids=evidence_ids,
                revision=row["revision"] + 1,
                replayed=False,
            )
            conversation = list(state.get("conversation", []))
            conversation.extend(
                [
                    CourseChatMessage(
                        id=request.id,
                        role="user",
                        content=request.question,
                    ).model_dump(mode="json"),
                    CourseChatMessage(
                        id=uuid.uuid4(),
                        role="assistant",
                        content=response.answer,
                        evidence_ids=evidence_ids,
                    ).model_dump(mode="json"),
                ]
            )
            state["conversation"] = conversation[-40:]
            row["revision"] += 1
            actions[str(request.id)] = {"fingerprint": fingerprint, "result": response.model_dump(mode="json")}
            for stale_id in list(actions)[:-50]:
                del actions[stale_id]
            return response


class PgCourseStore:
    """Migrations own schema; each mutating operation uses an independent transaction."""

    def __init__(self, database_url: str, *, max_documents_per_user: int = 100, source_versions=None):
        if max_documents_per_user < 1:
            raise ValueError("max_documents_per_user must be positive")
        self.database_url = database_url
        self.max_documents_per_user = max_documents_per_user
        self.source_versions = source_versions

    def _connect(self):
        import psycopg

        return psycopg.connect(self.database_url, autocommit=True, connect_timeout=5)

    def ensure_catalog(self):
        for release in catalog():
            self.save_release(release)

    def save_release(self, release: CourseRelease):
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            if release.user_id:
                cur.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (release.user_id,))
                if cur.fetchone() is None:
                    raise NotFound("course owner not found")
            _validate_source_pins(release, self.source_versions, conn=conn)
            cur.execute(
                "INSERT INTO courses (id,slug,user_id,title) VALUES (%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
                (str(release.course_id), release.slug, release.user_id, release.title),
            )
            cur.execute("SELECT user_id,slug FROM courses WHERE id=%s FOR UPDATE", (str(release.course_id),))
            row = cur.fetchone()
            if row is None or (str(row[0]) if row[0] else None) != release.user_id or row[1] != release.slug:
                raise InvalidInput("course owner does not match its release")
            cur.execute(
                "SELECT content_hash,status,course_id,user_id,version FROM course_releases WHERE id=%s FOR UPDATE",
                (str(release.id),),
            )
            row = cur.fetchone()
            if row is not None:
                if (str(row[2]), str(row[3]) if row[3] else None, row[4]) != (
                    str(release.course_id),
                    release.user_id,
                    release.version,
                ):
                    raise InvalidInput("release identity and ownership cannot change")
                if row[0] == release.content_hash():
                    return
                if row[1] in {"published", "retired"}:
                    raise InvalidInput("published releases are immutable; create a new release version")
                cur.execute(
                    "UPDATE course_releases SET content=%s::jsonb,content_hash=%s,status=%s,visibility=%s,"
                    "updated_at=now() WHERE id=%s AND user_id IS NOT DISTINCT FROM %s",
                    (
                        release.model_dump_json(),
                        release.content_hash(),
                        release.status,
                        release.visibility,
                        str(release.id),
                        release.user_id,
                    ),
                )
            else:
                cur.execute(
                    "INSERT INTO course_releases (id,course_id,user_id,version,status,visibility,content,content_hash)"
                    " VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s)",
                    (
                        str(release.id),
                        str(release.course_id),
                        release.user_id,
                        release.version,
                        release.status,
                        release.visibility,
                        release.model_dump_json(),
                        release.content_hash(),
                    ),
                )

    def list_courses(self, user_id: str):
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT r.content FROM course_releases r JOIN courses c ON c.id=r.course_id"
                " WHERE r.visibility='catalog' AND r.status='published' AND r.user_id IS NULL AND c.user_id IS NULL"
                " ORDER BY c.slug,r.created_at"
            )
            latest = {
                release.slug: release for row in cur.fetchall() if (release := CourseRelease.model_validate(row[0]))
            }
            return list(latest.values())

    def get_release(self, slug: str, user_id: str):
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT r.content FROM course_releases r JOIN courses c ON c.id=r.course_id WHERE c.slug=%s"
                " AND ((r.user_id=%s AND c.user_id=%s) OR (r.visibility='catalog' AND r.status='published'"
                " AND r.user_id IS NULL AND c.user_id IS NULL)) ORDER BY r.created_at DESC LIMIT 1",
                (slug, user_id, user_id),
            )
            row = cur.fetchone()
        if row is None:
            raise NotFound("course not found")
        release = CourseRelease.model_validate(row[0])
        _authorized(release, user_id)
        _validate_source_pins(release, self.source_versions)
        return release

    def completed_slugs(self, user_id: str):
        with self._connect() as conn, conn.cursor() as cur:
            return self._completed_slugs(cur, user_id)

    @staticmethod
    def _completed_slugs(cur, user_id):
        cur.execute(
            "SELECT c.slug FROM course_enrollments e JOIN course_releases r ON r.id=e.release_id"
            " JOIN courses c ON c.id=r.course_id WHERE e.user_id=%s AND e.status='completed'",
            (user_id,),
        )
        return {row[0] for row in cur.fetchall()}

    def _release_by_id(self, cur, user_id, release_id, *, conn=None):
        cur.execute(
            "SELECT r.content FROM course_releases r JOIN courses c ON c.id=r.course_id"
            " WHERE r.id=%s AND ((r.user_id=%s AND c.user_id=%s) OR (r.visibility='catalog'"
            " AND r.status='published' AND r.user_id IS NULL AND c.user_id IS NULL))"
            + (" FOR SHARE OF r" if conn is not None else ""),
            (str(release_id), user_id, user_id),
        )
        result = cur.fetchone()
        if result is None:
            raise NotFound("course release not found")
        release = CourseRelease.model_validate(result[0])
        _authorized(release, user_id, published_only=True)
        _validate_source_pins(release, self.source_versions, conn=conn)
        return release

    def pinned_course_detail(self, user_id: str, enrollment_id: str) -> CourseRelease:
        with self._connect() as conn, conn.cursor() as cur:
            _, release = self._owned(cur, user_id, enrollment_id)
            return release

    def preview_upgrade(
        self, user_id: str, enrollment_id: str, request: CourseUpgradePreviewRequest,
    ) -> CourseUpgradePreview:
        with self._connect() as conn, conn.cursor() as cur:
            row, original = self._owned(cur, user_id, enrollment_id)
            target = self._release_by_id(cur, user_id, request.target_release_id)
            _check_upgrade_prerequisites(original, target, self._completed_slugs(cur, user_id))
            preview, _ = prepare_upgrade(row, original, target)
            return preview

    def apply_upgrade(
        self, user_id: str, enrollment_id: str, request: CourseUpgradeApplyRequest,
    ) -> CourseUpgradeResponse:
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            # Enrollment and upgrade share this lock to serialize account quotas,
            # target uniqueness and duplicate accept requests.
            cur.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (user_id,))
            if cur.fetchone() is None:
                raise NotFound("course learner not found")
            row, original = self._owned(cur, user_id, enrollment_id, lock=True, conn=conn)
            cur.execute(
                "SELECT id FROM course_enrollments WHERE user_id=%s AND state->'upgrade_receipt'->>'id'=%s",
                (user_id, str(request.id)),
            )
            existing = cur.fetchone()
            if existing is not None:
                owned, release = self._owned(cur, user_id, existing[0], conn=conn)
                return _upgrade_replay(enrollment_id, request, owned, release)
            if row["revision"] != request.expected_revision:
                raise Conflict("Enrollment changed; refresh the upgrade preview")
            target = self._release_by_id(cur, user_id, request.target_release_id, conn=conn)
            _check_upgrade_prerequisites(original, target, self._completed_slugs(cur, user_id))
            preview, state = prepare_upgrade(row, original, target)
            verify_acceptance(preview, request)
            if self._existing_enrollment(cur, user_id, target.id) is not None:
                raise Conflict("You already have an enrollment for this release; open it from your courses")
            identifier, document_id = str(uuid.uuid4()), str(uuid.uuid4())
            target_row, result = _upgraded_enrollment(user_id, identifier, document_id, request, preview, state, target)
            self._write_new_enrollment(cur, user_id, target, target_row)
            return result

    @staticmethod
    def _existing_enrollment(cur, user_id, release_id):
        cur.execute(
            "SELECT id,document_id,state,revision,status FROM course_enrollments"
            " WHERE user_id=%s AND release_id=%s",
            (user_id, str(release_id)),
        )
        return cur.fetchone()

    def enroll(self, user_id: str, slug: str, diagnostic=None):
        release = self.get_release(slug, user_id)
        _authorized(release, user_id, published_only=True)
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (user_id,))
            if cur.fetchone() is None:
                raise NotFound("course learner not found")
            _validate_source_pins(release, self.source_versions, conn=conn)
            existing = self._existing_enrollment(cur, user_id, release.id)
            if existing:
                return engine.session_view(_enrollment(existing[0], user_id, release.id, *existing[1:]), release)
            if not engine.prerequisite_met(release, self._completed_slugs(cur, user_id), diagnostic):
                raise InvalidInput("Complete Python Foundations or pass the prerequisite diagnostic first")
            identifier, document_id = str(uuid.uuid4()), str(uuid.uuid4())
            enrollment = _enrollment(identifier, user_id, release.id, document_id)
            self._write_new_enrollment(cur, user_id, release, enrollment)
            return engine.session_view(enrollment, release)

    def _write_new_enrollment(self, cur, user_id, release, enrollment):
        cur.execute("SELECT count(*) FROM documents WHERE user_id=%s", (user_id,))
        if int(cur.fetchone()[0]) >= self.max_documents_per_user:
            raise InvalidInput("document limit reached for this account")
        identifier, document_id = enrollment["id"], enrollment["document_id"]
        markdown, chapters, chunks = _material(release, identifier, document_id, user_id)
        cur.execute(
            "INSERT INTO documents (id,user_id,filename,mime_type,size_bytes,page_count,status,markdown)"
            " VALUES (%s,%s,%s,'text/markdown',%s,%s,'parsed',%s)",
            (document_id, user_id, f"{release.slug}-v{release.version}.md",
             len(markdown.encode()), len(chapters), markdown),
        )
        for chapter in chapters:
            cur.execute(
                "INSERT INTO chapters (id,document_id,user_id,title,ordinal,start_page,end_page)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (
                    chapter.id,
                    document_id,
                    user_id,
                    chapter.title,
                    chapter.ordinal,
                    chapter.start_page,
                    chapter.end_page,
                ),
            )
        for chunk in chunks:
            cur.execute(
                "INSERT INTO chunks (id,document_id,user_id,chapter_id,content,page,ordinal)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (chunk.id, document_id, user_id, chunk.chapter_id, chunk.content, chunk.page, chunk.ordinal),
            )
        cur.execute(
            "INSERT INTO course_enrollments (id,user_id,release_id,document_id,state,revision,status)"
            " VALUES (%s,%s,%s,%s,%s::jsonb,%s,%s)",
            (identifier, user_id, str(release.id), document_id, json.dumps(enrollment["state"]),
             enrollment["revision"], enrollment["status"]),
        )

    def _owned(self, cur, user_id, enrollment_id, *, lock=False, conn=None):
        cur.execute(
            "SELECT e.id,e.document_id,e.state,e.revision,e.status,r.content FROM course_enrollments e"
            " JOIN course_releases r ON r.id=e.release_id"
            " JOIN courses c ON c.id=r.course_id"
            " JOIN documents d ON d.id=e.document_id AND d.user_id=e.user_id"
            " WHERE e.id=%s AND e.user_id=%s AND ((r.user_id IS NULL AND c.user_id IS NULL"
            " AND r.visibility='catalog') OR (r.user_id=e.user_id AND c.user_id=e.user_id))"
            + (" FOR UPDATE OF e" if lock else ""),
            (str(enrollment_id), user_id),
        )
        row = cur.fetchone()
        if row is None:
            raise NotFound("learning session not found")
        release = CourseRelease.model_validate(row[5])
        _validate_source_pins(release, self.source_versions, conn=conn)
        return _enrollment(row[0], user_id, release.id, row[1], row[2], row[3], row[4]), release

    def get_session(self, user_id: str, enrollment_id: str):
        with self._connect() as conn, conn.cursor() as cur:
            row, release = self._owned(cur, user_id, enrollment_id)
            return engine.session_view(row, release)

    def list_sessions(self, user_id: str):
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT e.id FROM course_enrollments e JOIN documents d ON d.id=e.document_id"
                " AND d.user_id=e.user_id WHERE e.user_id=%s ORDER BY e.updated_at DESC",
                (user_id,),
            )
            identifiers = [row[0] for row in cur.fetchall()]
            return [engine.session_view(*self._owned(cur, user_id, identifier)) for identifier in identifiers]

    def graph_lesson_context(self, user_id: str, document_id: str, chapter_id: str):
        """Resolve a read-only graph handoff without changing the active lesson or enrollment."""
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM course_enrollments WHERE user_id=%s AND document_id=%s",
                (user_id, document_id),
            )
            identifiers = [row[0] for row in cur.fetchall()]
            for identifier in identifiers:
                owned, release = self._owned(cur, user_id, identifier)
                for lesson in release.lessons:
                    if stable_id(f"{owned['id']}/chapter/{lesson.id}") == chapter_id:
                        return {
                            "enrollment_id": owned["id"], "course_slug": release.slug, "lesson_id": lesson.id,
                            "objective_ids": lesson.objective_ids, "title": lesson.title,
                            "content": "\n\n".join(block.content for block in lesson.blocks),
                        }
        return None

    def misconception_counts(self, user_id: str) -> dict[str, int]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                WITH recent AS (
                    SELECT a.exercise_id, e.release_id
                    FROM course_attempts a
                    JOIN course_enrollments e ON e.id=a.enrollment_id AND e.user_id=a.user_id
                    JOIN documents d ON d.id=e.document_id AND d.user_id=e.user_id
                    JOIN course_releases r ON r.id=e.release_id
                    JOIN courses c ON c.id=r.course_id
                    WHERE a.user_id=%s AND a.kind='attempt'
                      AND a.result @> '{"correct":false,"independent":true}'::jsonb
                      AND ((r.user_id IS NULL AND c.user_id IS NULL AND r.visibility='catalog')
                          OR (r.user_id=e.user_id AND c.user_id=e.user_id))
                    ORDER BY a.created_at DESC, a.id DESC
                    LIMIT %s
                )
                SELECT objective.id, count(*) FROM recent
                JOIN course_releases r ON r.id=recent.release_id
                CROSS JOIN LATERAL jsonb_array_elements(r.content->'exercises') AS exercise(item)
                CROSS JOIN LATERAL jsonb_array_elements_text(exercise.item->'objective_ids') AS objective(id)
                WHERE exercise.item->>'id'=recent.exercise_id AND exercise.item->>'mode'='checkpoint'
                GROUP BY objective.id
                """,
                (user_id, _MISCONCEPTION_ATTEMPT_LIMIT),
            )
            return dict(cur.fetchall())

    def track_attempt_counts(self, user_id: str) -> dict[str, int]:
        """Count owner-scoped course attempts using objective links in pinned releases."""
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                WITH recent AS (
                    SELECT a.exercise_id, e.release_id
                    FROM course_attempts a
                    JOIN course_enrollments e ON e.id=a.enrollment_id AND e.user_id=a.user_id
                    JOIN documents d ON d.id=e.document_id AND d.user_id=e.user_id
                    JOIN course_releases r ON r.id=e.release_id
                    JOIN courses c ON c.id=r.course_id
                    WHERE a.user_id=%s AND a.kind='attempt'
                      AND r.user_id IS NULL AND c.user_id IS NULL AND r.visibility='catalog'
                    ORDER BY a.created_at DESC, a.id DESC
                    LIMIT %s
                )
                SELECT objective.id, count(*) FROM recent
                JOIN course_releases r ON r.id=recent.release_id
                CROSS JOIN LATERAL jsonb_array_elements(r.content->'exercises') AS exercise(item)
                CROSS JOIN LATERAL jsonb_array_elements_text(exercise.item->'objective_ids') AS objective(id)
                WHERE exercise.item->>'id'=recent.exercise_id
                GROUP BY objective.id
                """,
                (user_id, _TRACK_ATTEMPT_PREVIEW_LIMIT),
            )
            return dict(cur.fetchall())

    @staticmethod
    def _write_session(cur, user_id, enrollment):
        cur.execute(
            "UPDATE course_enrollments SET state=%s::jsonb,revision=%s,status=%s,updated_at=now()"
            " WHERE id=%s AND user_id=%s",
            (json.dumps(enrollment["state"]), enrollment["revision"], enrollment["status"], enrollment["id"], user_id),
        )

    def action(self, user_id: str, enrollment_id: str, kind: str, request: dict):
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (user_id,))
            if cur.fetchone() is None:
                raise NotFound("learner not found")
            row, release = self._owned(cur, user_id, enrollment_id, lock=True, conn=conn)
            cur.execute(
                "SELECT enrollment_id,kind,request,result FROM course_attempts WHERE id=%s AND user_id=%s",
                (request["id"], user_id),
            )
            saved = cur.fetchone()
            if saved is not None:
                if str(saved[0]) != str(enrollment_id) or saved[1] != kind or saved[2] != request:
                    raise InvalidInput("action id was already used with different input")
                return {**saved[3], "replayed": True}
            engine.require_revision(row, request["revision"])
            exercise = engine.current_exercise(release, row["state"], request["exercise_id"])
            result = (
                engine.attempt(row, release, request) if kind == "attempt" else engine.assist(row, release, request)
            )
            lesson = release.lessons[row["state"]["lesson_index"]]
            if kind == "attempt" and exercise.mode == "checkpoint" and result["correct"] and result["independent"]:
                cur.execute(
                    "INSERT INTO flashcards (id,document_id,chapter_id,source_chunk_id,user_id,front,back,due_date) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
                    (
                        stable_id(f"{enrollment_id}/checkpoint-card/{exercise.id}"),
                        row["document_id"],
                        stable_id(f"{enrollment_id}/chapter/{lesson.id}"),
                        stable_id(f"{enrollment_id}/chunk/{lesson.id}"),
                        user_id,
                        exercise.prompt,
                        f"{exercise.explanation}\n\nAnswer: {json.dumps(exercise.answer)}",
                        datetime.now(UTC).date().isoformat(),
                    ),
                )
            cur.execute(
                "INSERT INTO course_attempts (id,user_id,enrollment_id,exercise_id,kind,request,result)"
                " VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id",
                (
                    request["id"],
                    user_id,
                    str(enrollment_id),
                    request["exercise_id"],
                    kind,
                    json.dumps(request),
                    json.dumps(result),
                ),
            )
            if cur.fetchone() is None:
                raise InvalidInput("action id is already in use")
            self._write_session(cur, user_id, row)
            return result

    def advance(self, user_id: str, enrollment_id: str, revision: int):
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            row, release = self._owned(cur, user_id, enrollment_id, lock=True, conn=conn)
            engine.advance(row, release, revision)
            self._write_session(cur, user_id, row)
            return engine.session_view(row, release)

    def update_study_notes(self, user_id: str, enrollment_id: str, request: StudyNotesRequest):
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            row, release = self._owned(cur, user_id, enrollment_id, lock=True, conn=conn)
            engine.save_study_notes(row, release, request)
            self._write_session(cur, user_id, row)
            return engine.session_view(row, release)

    def save_assignment(self, user_id: str, enrollment_id: str, request: AssignmentDraftRequest):
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            row, release = self._owned(cur, user_id, enrollment_id, lock=True, conn=conn)
            result = _assignment_action(row, release, request)
            self._write_session(cur, user_id, row)
            return result

    def run_lab(self, user_id: str, enrollment_id: str, request: LabRunRequest):
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            row, release = self._owned(cur, user_id, enrollment_id, lock=True, conn=conn)
            result = _lab_action(row, release, request, user_id)
            self._write_session(cur, user_id, row)
            return result

    def get_tutor_result(self, user_id: str, enrollment_id: str, request: CourseChatRequest):
        with self._connect() as conn, conn.cursor() as cur:
            row, _ = self._owned(cur, user_id, enrollment_id)
            fingerprint = {
                "enrollment_id": str(enrollment_id),
                "question": request.question,
                "revision": request.revision,
            }
            prior = row["state"].get("chat_actions", {}).get(str(request.id))
            if prior is None:
                engine.require_tutor_available(row, request.revision)
                return None
            if prior["fingerprint"] != fingerprint:
                raise InvalidInput("tutor request id was already used with different input")
            return CourseChatResponse.model_validate({**prior["result"], "replayed": True})

    def ask_tutor(self, user_id: str, enrollment_id: str, request: CourseChatRequest, tutor=None):
        """Serialize tutor turns with learning writes and persist replay data in state JSONB."""
        from app.courses.tutor import answer_course_question

        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            row, release = self._owned(cur, user_id, enrollment_id, lock=True, conn=conn)
            state = row["state"]
            actions = state.setdefault("chat_actions", {})
            fingerprint = {
                "enrollment_id": str(enrollment_id),
                "question": request.question,
                "revision": request.revision,
            }
            prior = actions.get(str(request.id))
            if prior is not None:
                if prior["fingerprint"] != fingerprint:
                    raise InvalidInput("tutor request id was already used with different input")
                return CourseChatResponse.model_validate({**prior["result"], "replayed": True})
            engine.require_tutor_available(row, request.revision)
            session = engine.session_view(row, release)
            answer, evidence_ids = (
                tutor(session, request.question, user_id)
                if tutor is not None
                else answer_course_question(session, request.question)
            )
            allowed = {item.id for item in session.evidence}
            if not isinstance(answer, str) or not answer.strip() or len(answer) > 4000:
                raise InvalidInput("tutor answer was empty or exceeded the response limit", status_code=502)
            if not set(evidence_ids) <= allowed:
                raise InvalidInput("tutor returned evidence outside the active lesson", status_code=502)
            response = CourseChatResponse(
                id=request.id,
                question=request.question,
                answer=answer.strip(),
                evidence_ids=evidence_ids,
                revision=row["revision"] + 1,
                replayed=False,
            )
            conversation = list(state.get("conversation", []))
            conversation.extend(
                [
                    CourseChatMessage(
                        id=request.id,
                        role="user",
                        content=request.question,
                    ).model_dump(mode="json"),
                    CourseChatMessage(
                        id=uuid.uuid4(),
                        role="assistant",
                        content=response.answer,
                        evidence_ids=evidence_ids,
                    ).model_dump(mode="json"),
                ]
            )
            state["conversation"] = conversation[-40:]
            row["revision"] += 1
            actions[str(request.id)] = {"fingerprint": fingerprint, "result": response.model_dump(mode="json")}
            for stale_id in list(actions)[:-50]:
                del actions[stale_id]
            self._write_session(cur, user_id, row)
            return response
