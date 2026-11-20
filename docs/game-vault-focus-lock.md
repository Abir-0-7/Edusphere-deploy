# Game Vault focus lock and generated asset lint

The shared account-scoped focus provider now wraps workspace navigation as well
as the authenticated pages. While focus is active, the sidebar/mobile Game vault
entry, dashboard shortcut and Games menu are disabled. The shared `/games`
layout withholds the catalog, puzzle player and Cyberverse iframe, including on
direct links and reloads. Successful completion or early end restores access.

Focus restoration must succeed before gameplay mounts. Failed saves retain the
session and lock until retry succeeds, including after the countdown reaches
zero. Same-origin tabs notify each other to recheck canonical server state;
messages contain no session details. Deferred updates are preserved while writes
are pending, and older restore responses cannot resurrect a completed session.

Puzzle creation, commands, legacy rewards, Cyberverse unlocks and progress writes
also reject an authenticated owner's running focus session with HTTP 409 using
the existing shared error shape. Blocked requests preserve game saves, balances
and rewards. No schema migration, paid service or environment setting is added.

ESLint previously traversed the gitignored minified Phaser/Vite game export in
`apps/web/public/games/assets`, producing thousands of generated-code errors.
The shared global ignore list now excludes that specific output directory, just
as it already excludes `dist`, `.next`, OCR output and upstream Cyberverse. The
authored engine source and web application remain linted with unchanged rules.
The generated bundle is not edited. A standalone game preview rebuild and
ESLint's ignored-path/config inspection verify the boundary.

## Verification

This change is integrated onto current main in an isolated checkout to preserve
unrelated staged and unstaged feature work. The following checks pass:

- Uncached lint across all seven packages, full typecheck, full unit suite and
  production build using documented CI placeholder configuration.
- 316 web unit tests and four OCR asset preparation tests; nine optional database
  cases skip in the ordinary unit command and are exercised separately below.
- 26 Game Vault Chromium scenarios, including all fourteen games with pointer,
  keyboard and touch, nine focus-lock/race cases, direct links and Cyberverse,
  and disabled Game vault link semantics. All six existing focus timer scenarios
  also pass.
- 114 focused API/client tests and nine real PostgreSQL cases against a fresh
  disposable local database; the test server is stopped afterward.
- ESLint config inspection verifies generated assets are ignored and authored
  engine/web/server sources still receive the existing lint rules. The game
  preview rebuild succeeds without modifying its existing minified export.

The browser tests use production components with authenticated HTTP fixtures.
Hosted acceptance and deployment remain separate from a Git push.
