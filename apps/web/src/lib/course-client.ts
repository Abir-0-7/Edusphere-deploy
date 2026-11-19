'use client';

import type {
  AdvanceRequest,
  AssignmentDraftRequest,
  AssignmentDraftResponse,
  AttemptRequest,
  AttemptResponse,
  AssistanceRequest,
  AssistanceResponse,
  CatalogResponse,
  CourseChatRequest,
  CourseChatResponse,
  CourseDetail,
  CodeChallengeGrade,
  CodeChallengeRequest,
  DiagnosticResponse,
  EnrollmentRequest,
  LabRunRequest,
  LabRunResponse,
  SessionListResponse,
  SessionResponse,
  StudyNotesRequest,
} from '@studyvault/types';
import {
  AdvanceRequestSchema,
  AssignmentDraftRequestSchema,
  AssignmentDraftResponseSchema,
  AttemptRequestSchema,
  AttemptResponseSchema,
  AssistanceRequestSchema,
  AssistanceResponseSchema,
  CatalogResponseSchema,
  CourseChatRequestSchema,
  CourseChatResponseSchema,
  CourseChatTokenSchema,
  ErrorEnvelopeSchema,
  CourseDetailSchema,
  CodeChallengeGradeSchema,
  CodeChallengeRequestSchema,
  DiagnosticResponseSchema,
  EnrollmentRequestSchema,
  LabRunRequestSchema,
  LabRunResponseSchema,
  SessionListResponseSchema,
  SessionResponseSchema,
  StudyNotesRequestSchema,
} from '@studyvault/types';
import { learningFetch, readResponse, type GetToken } from './ai-client';
import { readEventStream } from './event-stream';

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

async function request<T>(
  getToken: GetToken,
  path: string,
  schema: Schema<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await learningFetch(getToken, path, init);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Course service returned an invalid response.');
  }
  if (!response.ok) {
    const parsedError = ErrorEnvelopeSchema.safeParse(payload);
    throw new Error(
      parsedError.success ? parsedError.data.error.message : `Course request failed (${response.status}).`,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error('Course service returned an invalid response.');
  return parsed.data;
}

const json = (method: 'POST' | 'PUT', body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export function listCourses(getToken: GetToken): Promise<CatalogResponse> {
  return request(getToken, '/api/courses', CatalogResponseSchema);
}

export function getCourse(getToken: GetToken, slug: string): Promise<CourseDetail> {
  return request(getToken, `/api/courses/${encodeURIComponent(slug)}`, CourseDetailSchema);
}

export function getCourseDiagnostic(getToken: GetToken, slug: string): Promise<DiagnosticResponse> {
  return request(getToken, `/api/courses/${encodeURIComponent(slug)}/diagnostic`, DiagnosticResponseSchema);
}

export function getCourseSessions(getToken: GetToken): Promise<SessionListResponse> {
  return request(getToken, '/api/course-enrollments', SessionListResponseSchema);
}

export function getCourseSession(getToken: GetToken, enrollmentId: string): Promise<SessionResponse> {
  return request(
    getToken,
    `/api/course-enrollments/${encodeURIComponent(enrollmentId)}`,
    SessionResponseSchema,
  );
}

export function enrollCourse(
  getToken: GetToken,
  slug: string,
  body: EnrollmentRequest = EnrollmentRequestSchema.parse({}),
): Promise<SessionResponse> {
  return request(
    getToken,
    `/api/courses/${encodeURIComponent(slug)}/enroll`,
    SessionResponseSchema,
    json('POST', EnrollmentRequestSchema.parse(body)),
  );
}

export function submitCourseAttempt(
  getToken: GetToken,
  enrollmentId: string,
  body: AttemptRequest,
): Promise<AttemptResponse> {
  return request(
    getToken,
    `/api/course-enrollments/${encodeURIComponent(enrollmentId)}/attempts`,
    AttemptResponseSchema,
    json('POST', AttemptRequestSchema.parse(body)),
  );
}

export function requestCourseAssistance(
  getToken: GetToken,
  enrollmentId: string,
  body: AssistanceRequest,
): Promise<AssistanceResponse> {
  return request(
    getToken,
    `/api/course-enrollments/${encodeURIComponent(enrollmentId)}/assistance`,
    AssistanceResponseSchema,
    json('POST', AssistanceRequestSchema.parse(body)),
  );
}

export function advanceCourse(
  getToken: GetToken,
  enrollmentId: string,
  body: AdvanceRequest,
): Promise<SessionResponse> {
  return request(
    getToken,
    `/api/course-enrollments/${encodeURIComponent(enrollmentId)}/advance`,
    SessionResponseSchema,
    json('POST', AdvanceRequestSchema.parse(body)),
  );
}

export function saveCourseStudyNotes(
  getToken: GetToken,
  enrollmentId: string,
  body: StudyNotesRequest,
): Promise<SessionResponse> {
  return request(
    getToken,
    `/api/course-enrollments/${encodeURIComponent(enrollmentId)}/study-notes`,
    SessionResponseSchema,
    json('PUT', StudyNotesRequestSchema.parse(body)),
  );
}

export function saveCourseAssignment(
  getToken: GetToken,
  enrollmentId: string,
  body: AssignmentDraftRequest,
): Promise<AssignmentDraftResponse> {
  return request(
    getToken,
    `/api/course-enrollments/${encodeURIComponent(enrollmentId)}/assignments`,
    AssignmentDraftResponseSchema,
    json('PUT', AssignmentDraftRequestSchema.parse(body)),
  );
}

export function runCourseLab(
  getToken: GetToken,
  enrollmentId: string,
  body: LabRunRequest,
): Promise<LabRunResponse> {
  return request(
    getToken,
    `/api/course-enrollments/${encodeURIComponent(enrollmentId)}/labs`,
    LabRunResponseSchema,
    json('POST', LabRunRequestSchema.parse(body)),
  );
}

export async function runCourseCodeChallenge(body: CodeChallengeRequest): Promise<CodeChallengeGrade> {
  const response = await fetch('/api/battles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(CodeChallengeRequestSchema.parse(body)),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = ErrorEnvelopeSchema.safeParse(payload);
    throw new Error(
      parsedError.success ? parsedError.data.error.message : `Code runner failed (${response.status}).`,
    );
  }
  const parsed = CodeChallengeGradeSchema.safeParse(payload);
  if (!parsed.success) throw new Error('Code runner returned an invalid response.');
  return parsed.data;
}

export function askCourseTutor(
  getToken: GetToken,
  enrollmentId: string,
  body: CourseChatRequest,
): Promise<CourseChatResponse> {
  return request(
    getToken,
    `/api/course-enrollments/${encodeURIComponent(enrollmentId)}/tutor`,
    CourseChatResponseSchema,
    {
      ...json('POST', CourseChatRequestSchema.parse(body)),
      headers: { 'content-type': 'application/json', 'Idempotency-Key': body.id },
    },
  );
}

export async function streamCourseTutor(
  getToken: GetToken,
  enrollmentId: string,
  body: CourseChatRequest,
  signal: AbortSignal,
  onToken: (text: string) => void,
): Promise<CourseChatResponse> {
  const requestBody = CourseChatRequestSchema.parse(body);
  const response = await learningFetch(
    getToken,
    `/api/course-enrollments/${encodeURIComponent(enrollmentId)}/tutor/stream`,
    {
      ...json('POST', requestBody),
      headers: { 'content-type': 'application/json', 'Idempotency-Key': requestBody.id },
      signal,
    },
  );
  if (!response.ok) {
    if (response.status === 404) {
      await response.body?.cancel();
      const fallback = await askCourseTutor(getToken, enrollmentId, requestBody);
      if (signal.aborted) throw new DOMException('Tutor stream cancelled.', 'AbortError');
      onToken(fallback.answer);
      return fallback;
    }
    await readResponse(response, CourseChatResponseSchema, 'course tutor stream');
    throw new Error('Course tutor stream failed.');
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('Course tutor returned an invalid stream.');
  }

  let completed: CourseChatResponse | null = null;
  let streamedText = '';
  for await (const frame of readEventStream(response)) {
    if (signal.aborted) throw new DOMException('Tutor stream cancelled.', 'AbortError');
    if (completed) throw new Error('Tutor stream continued after its completion event.');
    if (frame.event === 'token') {
      let payload: unknown;
      try {
        payload = JSON.parse(frame.data);
      } catch {
        throw new Error('Tutor stream returned an invalid token event.');
      }
      const parsed = CourseChatTokenSchema.safeParse(payload);
      if (!parsed.success || streamedText.length + parsed.data.text.length > 4000) {
        throw new Error('Tutor stream returned an invalid token event.');
      }
      streamedText += parsed.data.text;
      onToken(parsed.data.text);
      continue;
    }
    if (frame.event === 'error') {
      let payload: unknown;
      try {
        payload = JSON.parse(frame.data);
      } catch {
        throw new Error('Tutor stream failed.');
      }
      const parsed = ErrorEnvelopeSchema.safeParse(payload);
      throw new Error(parsed.success ? parsed.data.error.message : 'Tutor stream failed.');
    }
    if (frame.event === 'done') {
      let payload: unknown;
      try {
        payload = JSON.parse(frame.data);
      } catch {
        throw new Error('Tutor stream returned an invalid completion event.');
      }
      const parsed = CourseChatResponseSchema.safeParse(payload);
      if (
        !parsed.success ||
        parsed.data.id !== requestBody.id ||
        parsed.data.question !== requestBody.question ||
        streamedText.trim() !== parsed.data.answer.trim()
      ) {
        throw new Error('Tutor stream returned an invalid completion event.');
      }
      completed = parsed.data;
      continue;
    }
    throw new Error('Tutor stream returned an unexpected event.');
  }
  if (!completed) throw new Error('Tutor stream ended before the answer was saved.');
  return completed;
}
