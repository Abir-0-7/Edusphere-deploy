const learningRoutePatterns: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/api\/courses$/ },
  { method: 'GET', path: /^\/api\/courses\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/diagnostic)?$/ },
  { method: 'POST', path: /^\/api\/courses\/[a-z0-9]+(?:-[a-z0-9]+)*\/enroll$/ },
  { method: 'GET', path: /^\/api\/course-enrollments$/ },
  { method: 'GET', path: /^\/api\/course-enrollments\/[0-9a-f-]{36}(?:\/course)?$/ },
  { method: 'GET', path: /^\/api\/course-enrollments\/[0-9a-f-]{36}\/course$/ },
  { method: 'POST', path: /^\/api\/course-enrollments\/[0-9a-f-]{36}\/(?:upgrade-preview|upgrade)$/ },
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
  { method: 'GET', path: /^\/api\/source-versions(?:\/[0-9a-f-]{36})?$/ },
  { method: 'POST', path: /^\/api\/documents\/[0-9a-f-]{36}\/source-versions$/ },
  { method: 'POST', path: /^\/api\/source-versions\/(?:[0-9a-f-]{36}\/resolve|import-github|import-text)$/ },
  { method: 'GET', path: /^\/api\/course-outlines(?:\/[0-9a-f-]{36}\/approvals|\/[0-9a-f-]{36})?$/ },
  { method: 'POST', path: /^\/api\/course-outlines(?:\/[0-9a-f-]{36}\/approve)?$/ },
  { method: 'PUT', path: /^\/api\/course-outlines\/[0-9a-f-]{36}$/ },
  { method: 'DELETE', path: /^\/api\/course-outlines\/[0-9a-f-]{36}$/ },
  { method: 'GET', path: /^\/api\/course-generations$/ },
  { method: 'GET', path: /^\/api\/course-generations\/[0-9a-f-]{36}(?:\/lesson-edits)?$/ },
  {
    method: 'POST',
    path: /^\/api\/course-generations(?:\/(?:preview|refresh|refresh\/preview|[0-9a-f-]{36}\/(?:cancel|resume)))?$/,
  },
  { method: 'PUT', path: /^\/api\/course-generations\/[0-9a-f-]{36}\/lessons\/[A-Za-z0-9_-]{1,128}$/ },
  { method: 'POST', path: /^\/api\/source-refresh\/impact$/ },
];

const id = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const document = '/api/documents/' + id;
const card = '/api/flashcards/' + id;
const quiz = '/api/flashcard-quizzes/' + id;
const draft = document + '/flashcard-studio/drafts/' + id;
const summary = '/api/chapters/' + id + '/summary';
const studyPaths: Readonly<Record<string, RegExp>> = {
  GET: new RegExp(
    '^(?:' +
      [
        '/api/jobs/' + id,
        document + '/(?:chapters|flashcards|mindmap|concept-graph|flashcard-studio/decks)',
        document + '/flashcard-decks/' + id + '/export[.]csv',
        '/api/flashcards/review-queue',
        card + '/explain',
        draft,
        quiz,
        summary,
      ].join('|') +
      ')$',
  ),
  POST: new RegExp(
    '^(?:' +
      [
        '/api/jobs/' + id + '/cancel',
        document +
          '/(?:chat|flashcards|concept-graph/regenerate|flashcard-studio/drafts|flashcard-quizzes|viva-questions)',
        card + '/(?:review|retire|report)',
        draft + '/merge',
        quiz + '/grade',
        summary,
        '/api/tts/stream',
        '/api/code-review',
        '/api/viva-grade',
      ].join('|') +
      ')$',
  ),
  PUT: new RegExp('^' + document + '/concept-graph$'),
  PATCH: new RegExp('^' + card + '$'),
  DELETE: new RegExp('^' + card + '$'),
};

export function isAllowedStudyRoute(method: string, path: string): boolean {
  return Object.hasOwn(studyPaths, method) && (studyPaths[method]?.test(path) ?? false);
}

export function isAllowedLearningRoute(method: string, path: string): boolean {
  return (
    isAllowedStudyRoute(method, path) ||
    learningRoutePatterns.some((route) => route.method === method && route.path.test(path))
  );
}
