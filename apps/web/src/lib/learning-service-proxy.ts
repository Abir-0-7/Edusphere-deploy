const learningRoutePatterns: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/api\/courses$/ },
  { method: 'GET', path: /^\/api\/courses\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/diagnostic)?$/ },
  { method: 'POST', path: /^\/api\/courses\/[a-z0-9]+(?:-[a-z0-9]+)*\/enroll$/ },
  { method: 'GET', path: /^\/api\/course-enrollments$/ },
  { method: 'GET', path: /^\/api\/course-enrollments\/[0-9a-f-]{36}$/ },
  {
    method: 'POST',
    path: /^\/api\/course-enrollments\/[0-9a-f-]{36}\/(?:attempts|assistance|advance|labs|tutor|tutor\/stream)$/,
  },
  { method: 'PUT', path: /^\/api\/course-enrollments\/[0-9a-f-]{36}\/(?:study-notes|assignments)$/ },
  { method: 'GET', path: /^\/api\/learner-profile$/ },
  { method: 'PUT', path: /^\/api\/learner-profile$/ },
  { method: 'GET', path: /^\/api\/learner-profile\/diagnostic$/ },
  { method: 'POST', path: /^\/api\/learner-profile\/(?:diagnostic|recommendations)$/ },
  { method: 'GET', path: /^\/api\/learner-profile\/track-plan(?:\/(?:options|history))?$/ },
  { method: 'POST', path: /^\/api\/learner-profile\/track-plan\/(?:preview|apply)$/ },
  { method: 'GET', path: /^\/api\/bibliography(?:\/library-documents|\/[0-9a-f-]{36})?$/ },
  { method: 'POST', path: /^\/api\/bibliography$/ },
  { method: 'PUT', path: /^\/api\/bibliography\/[0-9a-f-]{36}$/ },
  { method: 'DELETE', path: /^\/api\/bibliography\/[0-9a-f-]{36}$/ },
  { method: 'POST', path: /^\/api\/documents\/[0-9a-f-]{36}\/source-versions$/ },
  { method: 'GET', path: /^\/api\/source-versions\/[0-9a-f-]{36}$/ },
  { method: 'POST', path: /^\/api\/source-versions\/[0-9a-f-]{36}\/resolve$/ },
];

export function isAllowedLearningRoute(method: string, path: string): boolean {
  return learningRoutePatterns.some((route) => route.method === method && route.path.test(path));
}
