'use client';

import type {
  AdvanceRequest,
  AttemptRequest,
  AttemptResponse,
  AssistanceRequest,
  AssistanceResponse,
  CatalogResponse,
  CourseChatRequest,
  CourseChatResponse,
  CourseDetail,
  DiagnosticResponse,
  EnrollmentRequest,
  SessionListResponse,
  SessionResponse,
  StudyNotesRequest,
} from '@studyvault/types';
import {
  AdvanceRequestSchema,
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
  DiagnosticResponseSchema,
  EnrollmentRequestSchema,
  SessionListResponseSchema,
  SessionResponseSchema,
  StudyNotesRequestSchema,
} from '@studyvault/types';
import type { GetToken } from './ai-client';
import { readEventStream } from './event-stream';

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

async function request<T>(
  getToken: GetToken,
  path: string,
  schema: Schema<T>,
  init?: RequestInit,
): Promise<T> {
  const token = await getToken();
  const base = process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token ?? ''}` },
    });
  } catch {
    throw new Error('Cannot reach the course service. Check its URL and CORS settings.');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Course request failed: ${response.ok ? 'invalid response' : response.status}`);
  }
  if (!response.ok) {
    const failure = ErrorEnvelopeSchema.safeParse(payload);
    throw new Error(
      failure.success ? failure.data.error.message : `Course request failed: ${response.status}`,
    );
  }
  const result = schema.safeParse(payload);
  if (!result.success) throw new Error('Course request failed: invalid service response');
  return result.data;
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
  const token = await getToken();
  const base = process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';
  let response: Response;
  try {
    response = await fetch(
      `${base}/api/course-enrollments/${encodeURIComponent(enrollmentId)}/tutor/stream`,
      {
        ...json('POST', requestBody),
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': requestBody.id,
          authorization: `Bearer ${token ?? ''}`,
        },
        signal,
      },
    );
  } catch {
    throw new Error('Cannot reach the course service. Check its URL and CORS settings.');
  }
  if (!response.ok) {
    if (response.status === 404) {
      await response.body?.cancel();
      const fallback = await askCourseTutor(getToken, enrollmentId, requestBody);
      if (signal.aborted) throw new DOMException('Tutor stream cancelled.', 'AbortError');
      onToken(fallback.answer);
      return fallback;
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Course tutor stream failed: ${response.status}`);
    }
    const failure = ErrorEnvelopeSchema.safeParse(payload);
    throw new Error(
      failure.success ? failure.data.error.message : `Course tutor stream failed: ${response.status}`,
    );
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
