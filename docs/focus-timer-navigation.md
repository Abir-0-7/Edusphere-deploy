# Persistent focus timer

The active focus countdown now lives in the authenticated workspace layout. It
stays visible while navigating from Focus & progress to Study, documents,
practice, or other protected pages. Study also has compact controls to start or
end a session without leaving the material.

One account-scoped provider owns restoration, ticking, and completion. Both the
page controls and sticky display read that provider. Remaining time comes from
the existing server `expected_end_at`; rewards still come from the existing
completion endpoint. Reload restores the running server session. Save failures
retain the active session and allow retry; restoration failures expose a retry
action instead of allowing a potentially duplicate start. No API contract,
database schema, environment variable, or service was added.

The change is applied in `apps/web` and `_edusphere_deploy_port/apps/web`, whose
EduSphere navigation and `/tutor` Study page match the supplied screenshot.

## Verification

The isolated Chromium fixture renders the production provider and controls with
Clerk and validated HTTP fixtures:

```powershell
pnpm --filter @studyvault/web exec playwright test --config e2e/focus-timer-isolated.config.ts
```

Six passing scenarios exercise navigation, server restoration after reload, shared countdowns,
expiry outside Progress, duplicate completion prevention, failed-save recovery,
restoration failure recovery, and the sticky display at 390px. These are browser
fixture checks; signed-in deployed acceptance has not been run.

Root lint and the focused timer/provider/protected-layout TypeScript check pass;
six focus-client/extension unit tests pass. Playwright's ignored temporary cache
directory is excluded from ESLint. An initial full unit run passed 253 web tests
(five optional skips); a later run encountered an unrelated missing whiteboard
package import during concurrent shared-type work. Full main typecheck/build
encountered unrelated unfinished F06 course-upgrade/source-refresh types; the
latest typecheck reports nullable `outline.approval` in `source-impact-panel.tsx`.
Four existing map/browser
regressions pass, including the document practice handoff; the separate map PDF
export case timed out waiting for a download.

The EduSphere source passes focused ESLint, full web typecheck, production build,
125 web tests (six optional skips), and four OCR asset checks. Its full lint is
blocked by existing generated game-bundle errors under `public/games/assets`.
Desktop and mobile timer captures were visually inspected.

No deployment or commit was made. The existing checkout contains substantial
unrelated staged and unstaged work. Task 8.H09 remains open under the repository's
full-check definition of done until those pre-existing quality gates pass.
