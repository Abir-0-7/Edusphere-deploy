# Course labs and assignments

The published Python Foundations and PyTorch Fundamentals courses use immutable
version 2 releases. Each course provides a Python/JavaScript code editor with
fixed test cases, a simulated Git shell, and an owner-scoped assignment draft.
The code editor reuses the existing Judge0 CE adapter. It only accepts curated
problem IDs and sends network-disabled submissions with CPU, memory, wall-clock,
stack and file-size limits. The app server does not execute learner source.

Code-lab progress is recorded only after all tests pass and the web route signs
a short-lived receipt bound to the enrollment, lab, task, language and source
hash. Set `COURSE_LAB_RECEIPT_SECRET` in the web app and
`AI_SERVICE_COURSE_LAB_RECEIPT_SECRET` in the AI service to the same random value
of at least 32 characters. Set `JUDGE0_BASE_URL` to the HTTPS URL of the
self-hosted isolated Judge0 CE service; `JUDGE0_API_KEY` is optional. The
matching receipt secrets are optional at startup, but code-lab progress remains
unavailable until they and Judge0 are configured. Keep the values in the
deployment secret store and never commit them.

The simulated shell applies an allowlist to a fake Git repository and never
starts an operating-system shell. Lab attempts are stored with the learner's
enrollment but do not count as checkpoint mastery, XP, flashcard creation or
scheduled review. Assignment drafts and submissions are owner-scoped self-review
notes; they are not automatically graded or sent to an instructor.

The additional SQL Query Foundations and Git Foundations curricula remain
draft candidates in [`curricula/sql-git-foundations-candidates.md`](curricula/sql-git-foundations-candidates.md)
until their editorial and guided-course review gates are recorded.
