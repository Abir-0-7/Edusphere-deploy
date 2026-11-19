import { afterEach, describe, expect, it, vi } from 'vitest';
import { learningFetch } from '../src/lib/ai-client';
import { isAllowedLearningRoute } from '../src/lib/learning-service-proxy';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('same-origin learning service proxy routes', () => {
  it('allows the course and learner-profile routes used by the web clients', () => {
    expect(isAllowedLearningRoute('GET', '/api/courses')).toBe(true);
    expect(isAllowedLearningRoute('POST', '/api/courses/python-foundations/enroll')).toBe(true);
    expect(
      isAllowedLearningRoute(
        'POST',
        '/api/course-enrollments/01234567-89ab-cdef-0123-456789abcdef/tutor/stream',
      ),
    ).toBe(true);
    expect(
      isAllowedLearningRoute(
        'PUT',
        '/api/course-enrollments/01234567-89ab-cdef-0123-456789abcdef/assignments',
      ),
    ).toBe(true);
    expect(isAllowedLearningRoute('GET', '/api/learner-profile/track-plan')).toBe(true);
    expect(isAllowedLearningRoute('GET', '/api/learner-profile/track-plan/history')).toBe(true);
  });

  it('rejects arbitrary upstream paths, unsupported methods, and encoded traversal', () => {
    expect(isAllowedLearningRoute('GET', '/api/privacy/export')).toBe(false);
    expect(
      isAllowedLearningRoute('DELETE', '/api/course-enrollments/01234567-89ab-cdef-0123-456789abcdef'),
    ).toBe(false);
    expect(isAllowedLearningRoute('POST', '/api/courses/python-foundations/%2e%2e')).toBe(false);
    expect(isAllowedLearningRoute('GET', '/api/learner-profile/track-plan/apply')).toBe(false);
    expect(isAllowedLearningRoute('POST', '/api/source-versions/github/delete')).toBe(false);
    expect(
      isAllowedLearningRoute('DELETE', '/api/source-versions/01234567-89ab-cdef-0123-456789abcdef'),
    ).toBe(false);
    expect(isAllowedLearningRoute('GET', '/api/bibliography/%2e%2e')).toBe(false);
  });

  it('allows only the completed bibliography and pinned-source endpoints', () => {
    const id = '01234567-89ab-cdef-0123-456789abcdef';
    expect(isAllowedLearningRoute('GET', '/api/bibliography')).toBe(true);
    expect(isAllowedLearningRoute('GET', '/api/bibliography/library-documents')).toBe(true);
    expect(isAllowedLearningRoute('POST', '/api/bibliography')).toBe(true);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      expect(isAllowedLearningRoute(method, `/api/bibliography/${id}`)).toBe(true);
    }
    expect(isAllowedLearningRoute('POST', `/api/documents/${id}/source-versions`)).toBe(true);
    expect(isAllowedLearningRoute('GET', `/api/source-versions/${id}`)).toBe(true);
    expect(isAllowedLearningRoute('POST', `/api/source-versions/${id}/resolve`)).toBe(true);
  });

  it('sends course calls to the same-origin proxy with the caller session token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const token = vi.fn(async () => 'clerk-session-token');

    await learningFetch(token, '/api/courses', { cache: 'no-store' });

    expect(token).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/learning-service/api/courses');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer clerk-session-token');
    expect(init?.cache).toBe('no-store');
  });

  it('allows bounded source authoring and explicit course upgrades through the deployment proxy', () => {
    const id = '01234567-89ab-cdef-0123-456789abcdef';
    const allowed = [
      ['GET', '/api/source-versions'],
      ['POST', '/api/source-versions/github/import'],
      ['POST', '/api/source-versions/import-text'],
      ['GET', '/api/course-outlines'],
      ['POST', '/api/course-outlines'],
      ['PUT', `/api/course-outlines/${id}`],
      ['DELETE', `/api/course-outlines/${id}`],
      ['POST', `/api/course-outlines/${id}/approve`],
      ['GET', `/api/course-outlines/${id}/approvals`],
      ['GET', '/api/course-generations'],
      ['POST', '/api/course-generations/preview'],
      ['POST', '/api/course-generations'],
      ['GET', `/api/course-generations/${id}`],
      ['POST', `/api/course-generations/${id}/cancel`],
      ['POST', `/api/course-generations/${id}/resume`],
      ['POST', '/api/course-generations/refresh/preview'],
      ['POST', '/api/course-generations/refresh'],
      ['GET', `/api/course-generations/${id}/lesson-edits`],
      ['PUT', `/api/course-generations/${id}/lessons/objective-1`],
      ['POST', '/api/source-refresh/impact'],
      ['GET', `/api/course-enrollments/${id}/course`],
      ['POST', `/api/course-enrollments/${id}/upgrade-preview`],
      ['POST', `/api/course-enrollments/${id}/upgrade`],
    ];
    for (const [method, path] of allowed) {
      expect(isAllowedLearningRoute(method ?? '', path ?? ''), `${method} ${path}`).toBe(true);
    }
    expect(isAllowedLearningRoute('GET', '/api/course-generations/refresh')).toBe(false);
    expect(isAllowedLearningRoute('DELETE', `/api/course-generations/${id}`)).toBe(false);
    expect(isAllowedLearningRoute('PUT', `/api/course-generations/${id}/lessons/%2e%2e`)).toBe(false);
    expect(isAllowedLearningRoute('POST', `/api/course-outlines/${id}/publish`)).toBe(false);
  });
});
