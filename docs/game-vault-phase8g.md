# Phase 8G implementation and release evidence

Updated 2026-11-19. This records local implementation separately from deployment,
human editorial approval, and disposable PostgreSQL acceptance.

## Delivered local behavior

The protected `/games` player presents Sorting Race, N-Queens, Towers of Hanoi,
Recall Defense, Concept Match, Retrieval Sprint and Code Trace, plus Debugging
Detective, SQL Detective, Graph Path, Proof Builder, Data Detective, Adaptive Quiz
and Exam Escape. The 2026-11-19 user request superseded the earlier implementation
hold for those seven new practice modes; see `game-expansion.md`. Each has an
objective, instructions, difficulty and expected duration. Native buttons cover
pointer, keyboard and touch. Ready/start, pause/resume, abandon, retry, fullscreen,
sound and reduced-motion preferences share one account-bound view.

The `/games` collection now gives each of its fifteen entries a distinct inline SVG
preview. The player uses game-specific boards for sorting, chess placement and
Hanoi, plus separate visual treatments for defense, matching, retrieval and code
tracing. The N-Queens board includes readable coordinates and live placement
progress; saved reduced-motion preferences suppress board movement.

Version 1 persists only server-created configuration and at most 500 ordered
actions. Server replay validates every action, including the history before an
undo. Seeds, rules version, difficulty and objective are pinned by the server.
The client receives a strict public view; it imports only the separate catalog
entry point, never the question-key or grading modules. Old four-game standalone
controls remain a compatibility preview. Their animation ticks are not learning
evidence; the integrated Recall Defense pauses all movement while reading.

Private sessions are scoped to the authenticated internal user ID on every query.
Postgres row locks serialize commands. Session state and the reward ledger commit
in one transaction; a failed ledger/session write rolls back both. Stale revisions
return 409 and the UI reloads committed state. One UTC-day reward per game/account
is shared with the legacy reward endpoint and capped at five tokens. Practice
hints/undo grant no reward; casual Retrieval Sprint never writes SM-2 reviews,
mastery, readiness or XP. Scores indicate game engagement only.

An account has at most 100 saved sessions. On 2026-11-18 the user explicitly chose
learner-controlled deletion of saves while retaining earned ledger entries.
The UI confirms deletion; only a successful owner-scoped DELETE removes the save.
Deletion cannot reset the daily reward cap. No automatic game-save eviction is
selected. Account deletion cascades all game-owned state under existing policy.

## Prepared content and remaining adapter gate

Question fixtures are authored against the linked Python tutorial, with stable
question/objective IDs, exact keys, explanations and source URLs. Code Trace uses
fixed output cases without executing code. The optional objective selector limits
the prepared set to arithmetic, collections, iteration or branching. No LLM runs
in a game loop. Movement rejection never records an incorrect knowledge answer;
reading duration has no effect on correctness or rewards.

A question round requires at least 60% correct, rounded up, and at least one
correct answer. Three incorrect answers end the round early. This rule is shown
before Start and in result explanations. Even a one-question objective answered
incorrectly is a loss with no reward.

This is an authored-content adapter, not the complete 8.G03 deck bridge. Published
deck/version/evidence prerequisites from 8.D01 are not yet available in this
worktree. Arbitrary deck IDs and injected questions/keys are rejected. Private deck
selection and lesson-locator handoff remain gated until those contracts exist.
Source links currently open the official supporting tutorial. Human editorial
review remains a release gate; deterministic tests do not constitute human review.

## Realtime

Production matchmaking, membership, saved private grading state and rate counters
use Postgres. Missing database configuration fails closed; only tests inject
memory repositories. Upstash stores no gameplay data. Expiring matchmaking is
serialized across processes. A duel has two members, server deadlines, bounded
cards/payloads/events/connections/in-flight work, and one daily capped settlement.
Reconnect preserves the original deadline and score; timeout never creates a
knowledge success. Cards and keys are loaded from the owner's database rows and
public socket payloads exclude keys. Deleting a source card purges saved duels.

Socket tests authenticate two loopback clients with injected test verifiers and
reconstruct the server over the same repository. PostgreSQL tests use independent
clients and new repository instances to verify persistence and locking. Production
Clerk verification still needs staging. Multiple realtime nodes need a shared
broadcast adapter before cross-node room delivery can be released.

## Contracts and commands

`packages/types/src/game-api.ts` defines create/config/action/snapshot/public-view/
session/list/command/error-compatible boundaries. HTTP contracts:

| Route                             | Input                                                         | Result                                              |
| --------------------------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| GET `/api/games/sessions`         | authenticated account                                         | up to 100 owned saves and server-derived win counts |
| POST `/api/games/sessions`        | game_id, difficulty, practice, optional objective_id          | 201 ready session with server seed                  |
| GET `/api/games/sessions/{id}`    | owned UUID                                                    | committed session/public view                       |
| POST `/api/games/sessions/{id}`   | revision + start/pause/resume/abandon or act + ordered action | committed session; stale revision 409               |
| DELETE `/api/games/sessions/{id}` | owned UUID                                                    | 204; reward ledger preserved                        |

Malformed IDs/actions, unknown fields and wrong-state commands return shared-shape
400 errors; missing auth 401, foreign IDs 404, save capacity 429, failed command
commit 503. Create/command bodies are bounded to 4096 UTF-8 bytes even when chunked.

Run:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @studyvault/game-engine build
pnpm --filter @studyvault/web test:e2e:games
pnpm --filter @studyvault/realtime test
```

The isolated browser harness renders the actual React component, intercepts only
its HTTP transport and uses the real reducer on the test-server side. It adds no
production authentication bypass. It covers all fourteen completions with mouse at
1440px, keyboard at 768px and touch at 390px; win/loss/retry/source feedback,
pause/refresh recovery, preferences, hard 8x8 queens, hints/undo and save deletion.
The signed-in `game-vault.spec.ts` remains separate and requires Clerk test secrets.
Optional Postgres tests use only `STUDYVAULT_TEST_DATABASE_URL`; never point them
at a live user database.

CI supplies an ephemeral Postgres 16 service for isolated-schema integration
tests and always runs the credential-free browser fixture suite. Local verification
does not assert that the updated CI workflow has run remotely.

CYBERVERSE is imported from `Abir-0-7/Edusphere-deploy` at upstream commit
`5ea1ba9498431c4cfa256a98fcbd9fb33c2d6def`. All 10 existing export files were checked
against the repository's SHA-256/byte-size manifest. The separate `/games/cyberverse`
protected page loads the same-origin WebAssembly/PCK export only after its
authenticated account context loads; no local demo coin/session is offered when
the service is unavailable. It shows the canonical StudyVault token ledger,
allows Binary City one-time unlock for five tokens, and permits free replay.
The server locks the owner's account and writes the entitlement plus debit in
one transaction, verifies the fixed six-answer `binary-v1` result, and gives 100
game XP once (separate from mastery/readiness). Other five missions remain previews.
Cross-origin and non-frame messages are ignored. Direct navigation to the export returns to the protected game page.

The app registers separate direct routes and menu items for all fourteen
StudyVault games plus CYBERVERSE. Saved sessions remain scoped to each game.
The existing migration `0007_game_vault_missions.sql` preserves Cyberverse entitlements. The additive
`0008_game_vault_sessions.sql` migration adds saved games and realtime persistence. Privacy export covers Cyberverse
progress; token balance continues to use the existing StudyVault balance API.

## Local verification

- All fourteen StudyVault games were completed in Chromium using mouse, keyboard
  and touch. The 17-case suite also checked game-specific menu art, board
  progress, the new activities, save recovery, navigation, Binary
  City unlock and replay, unauthorized frame messages, and the original Godot
  export boot. Next's production security headers were checked separately.
- The original integration previously passed eight real PostgreSQL tests in disposable schemas. They covered
  session locking, reward retention, entitlement/debit rollback, replay, account
  cascades and realtime recovery. The expanded PostgreSQL session suite now has
  three tests; those were skipped locally because `STUDYVAULT_TEST_DATABASE_URL`
  was not configured. No production database was used for these checks.
- Expansion checks passed: 127 engine tests, six shared-contract tests, 146 web
  tests (seven optional integration cases skipped), scoped lint/typecheck and the
  web production build. The targeted backend/client subset passed 91 tests.
  No Python service code was changed for this expansion.

## Release checks still open

- Full application migration and backup/restore rehearsal on the production stack.
- Full private versioned-deck/objective evidence bridge (8.G03).
- Human review of question content and screen-reader/contrast audit.
- Signed-in staging parity, actual Clerk reconnect and measured free-host capacity.
- Demand/capacity evaluation and adaptive calibration remain open for the new
  authored practice slices; the 2026-11-19 implementation request is recorded in
  `game-expansion.md` and is not evidence of learner demand or content approval.

See `game-candidate-evaluation.md` for the design review and authorization history.
