"""Typed routes installed by main with its authenticated-user dependency and store."""

import json
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.courses import engine
from app.courses.catalog import DIAGNOSTIC
from app.courses.contracts import (
    AdvanceRequest,
    AssistanceRequest,
    AssistanceResponse,
    AttemptRequest,
    AttemptResponse,
    CatalogResponse,
    CourseChatRequest,
    CourseChatResponse,
    CourseDetail,
    DiagnosticResponse,
    EnrollmentRequest,
    SessionListResponse,
    SessionResponse,
    StudyNotesRequest,
)
from app.errors import ApiError, InvalidInput, error_body
from app.llm.router import AllProvidersFailed


def create_course_router(get_user_id, store, course_tutor=None, course_tutor_streamer=None) -> APIRouter:
    router = APIRouter(tags=["courses"])
    user_dependency = Depends(get_user_id)

    def tutor_callback():
        if course_tutor is None:
            return None

        def answer(session, question, owner):
            return course_tutor(owner, session, question)

        return answer

    @router.get("/api/courses", response_model=CatalogResponse)
    def list_courses(user_id: str = user_dependency):
        return CatalogResponse(courses=[engine.summary(release) for release in store.list_courses(user_id)])

    @router.get("/api/courses/{slug}", response_model=CourseDetail)
    def get_course(slug: str, user_id: str = user_dependency):
        release = store.get_release(slug, user_id)
        return CourseDetail(
            **engine.summary(release).model_dump(),
            objectives=release.objectives,
            lesson_titles=[lesson.title for lesson in release.lessons],
            modules=release.modules,
            evidence=release.evidence,
            reference_urls=sorted({url for source in release.sources for url in source.reference_urls}),
            prerequisite_met=engine.prerequisite_met(release, store.completed_slugs(user_id)),
        )

    @router.get("/api/courses/{slug}/diagnostic", response_model=DiagnosticResponse)
    def diagnostic(slug: str, user_id: str = user_dependency):
        release = store.get_release(slug, user_id)
        questions = (
            []
            if not release.prerequisites
            else [
                {"id": key, "prompt": prompt, "kind": "text" if isinstance(answer, str) else "number"}
                for key, (prompt, answer) in DIAGNOSTIC.items()
            ]
        )
        return DiagnosticResponse(questions=questions)

    @router.post("/api/courses/{slug}/enroll", response_model=SessionResponse)
    def enroll(slug: str, request: EnrollmentRequest, user_id: str = user_dependency):
        return store.enroll(user_id, slug, request.diagnostic_answers)

    @router.get("/api/course-enrollments", response_model=SessionListResponse)
    def list_sessions(user_id: str = user_dependency):
        return SessionListResponse(sessions=store.list_sessions(user_id))

    @router.get("/api/course-enrollments/{enrollment_id}", response_model=SessionResponse)
    def get_session(enrollment_id: UUID, user_id: str = user_dependency):
        return store.get_session(user_id, str(enrollment_id))

    @router.post("/api/course-enrollments/{enrollment_id}/attempts", response_model=AttemptResponse)
    def attempt(enrollment_id: UUID, request: AttemptRequest, user_id: str = user_dependency):
        return store.action(user_id, str(enrollment_id), "attempt", request.model_dump(mode="json"))

    @router.post("/api/course-enrollments/{enrollment_id}/assistance", response_model=AssistanceResponse)
    def assistance(enrollment_id: UUID, request: AssistanceRequest, user_id: str = user_dependency):
        return store.action(user_id, str(enrollment_id), "assistance", request.model_dump(mode="json"))

    @router.post("/api/course-enrollments/{enrollment_id}/advance", response_model=SessionResponse)
    def advance(enrollment_id: UUID, request: AdvanceRequest, user_id: str = user_dependency):
        return store.advance(user_id, str(enrollment_id), request.revision)

    @router.put("/api/course-enrollments/{enrollment_id}/study-notes", response_model=SessionResponse)
    def study_notes(enrollment_id: UUID, request: StudyNotesRequest, user_id: str = user_dependency):
        return store.update_study_notes(user_id, str(enrollment_id), request)

    @router.post("/api/course-enrollments/{enrollment_id}/tutor", response_model=CourseChatResponse)
    def tutor_endpoint(enrollment_id: UUID, request: CourseChatRequest, user_id: str = user_dependency):
        return store.ask_tutor(user_id, str(enrollment_id), request, tutor_callback())

    @router.post(
        "/api/course-enrollments/{enrollment_id}/tutor/stream",
        response_class=StreamingResponse,
        responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
    )
    async def tutor_stream(
        enrollment_id: UUID,
        request: CourseChatRequest,
        http_request: Request,
        user_id: str = user_dependency,
    ) -> StreamingResponse:
        """Provider token SSE. Only a fully completed turn is committed."""

        existing = store.get_tutor_result(user_id, str(enrollment_id), request)
        if existing is not None:

            async def replay() -> AsyncIterator[str]:
                for start in range(0, len(existing.answer), 48):
                    if await http_request.is_disconnected():
                        return
                    yield f"event: token\ndata: {json.dumps({'text': existing.answer[start : start + 48]})}\n\n"
                yield f"event: done\ndata: {json.dumps(existing.model_dump(mode='json'))}\n\n"

            return StreamingResponse(replay(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

        if course_tutor_streamer is None:
            result = store.ask_tutor(user_id, str(enrollment_id), request, tutor_callback())
            answer_text = result.answer

            async def fallback() -> AsyncIterator[str]:
                for start in range(0, len(answer_text), 48):
                    if await http_request.is_disconnected():
                        return
                    yield f"event: token\ndata: {json.dumps({'text': answer_text[start : start + 48]})}\n\n"
                yield f"event: done\ndata: {json.dumps(result.model_dump(mode='json'))}\n\n"

            return StreamingResponse(fallback(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

        session = store.get_session(user_id, str(enrollment_id))
        if session.revision != request.revision:
            raise InvalidInput("Learning session changed; reload it before submitting", status_code=409)
        _, token_ids, token_stream = course_tutor_streamer(user_id, session, request.question)

        async def events() -> AsyncIterator[str]:
            answer_parts: list[str] = []
            try:
                async for chunk in token_stream:
                    if await http_request.is_disconnected():
                        return
                    answer_parts.append(chunk)
                    yield f"event: token\ndata: {json.dumps({'text': chunk})}\n\n"
                answer_text = "".join(answer_parts).strip()
                if not answer_text or len(answer_text) > 4000:
                    raise ApiError("Course tutor returned an empty or oversized answer", status_code=502)

                def commit_answer(_session, _question, _owner):
                    return answer_text, token_ids

                result = store.ask_tutor(user_id, str(enrollment_id), request, commit_answer)
                if not await http_request.is_disconnected():
                    yield f"event: done\ndata: {json.dumps(result.model_dump(mode='json'))}\n\n"
            except ApiError as exc:
                if not await http_request.is_disconnected():
                    yield f"event: error\ndata: {json.dumps(error_body(exc.message, exc.code, exc.details))}\n\n"
            except AllProvidersFailed:
                if not await http_request.is_disconnected():
                    body = error_body("Course tutor is temporarily unavailable", "provider_unavailable")
                    yield f"event: error\ndata: {json.dumps(body)}\n\n"
            finally:
                close = getattr(token_stream, "aclose", None)
                if close is not None:
                    await close()

        return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    return router
