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
});
