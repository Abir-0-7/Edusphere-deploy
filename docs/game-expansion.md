# Game Vault expansion - 2026-11-19

The user explicitly requested Debugging Detective, SQL Detective, Graph Path,
Proof Builder, Data Detective, Adaptive Quiz and Exam Escape, and asked that
Concept Match and Code Trace remain included. This supersedes the earlier
demand-based implementation hold. It does not claim demand evidence, human
content approval, psychometric calibration or production staging acceptance.

The collection contains fourteen StudyVault games plus the existing Cyberverse
entry. Every StudyVault game has its own direct route, menu card, scoped saves,
difficulty, instructions, pause/resume, retry and authoritative token settlement.
Concept Match and Code Trace retain their original authored content and saves.
Cyberverse keeps its separate one-time five-token Binary City entitlement.

## Initial playable slices

| Game | Interaction and deterministic grading |
| --- | --- |
| Debugging Detective | Select a faulty Python line and a repair against a stated regression case. Both must match the private key. No program is executed. |
| SQL Detective | Read a real DOM table and a fixed PostgreSQL query, then choose its result. Queries are never executed against an account. |
| Graph Path | Build a path on an undirected, unweighted graph. Any valid shortest route is accepted, including tied routes; disconnected goals accept an explicit no-path answer. SVG is accompanied by labeled node buttons and a complete text edge list. |
| Proof Builder | Arrange all steps after the facts they depend on. The server checks dependencies, accepting interchangeable independent assumptions. Add, move-up, move-down and reset controls require no drag gesture. |
| Data Detective | Read a small table with explicit units and choose an evidence-supported claim or calculation. Feedback distinguishes association from causation. |
| Adaptive Quiz | A fixed, server-selected question bank adjusts practice difficulty according to the previous answer. The UI explains the current selection. This is provisional practice, not calibrated mastery measurement, and writes no scheduling or mastery evidence. |
| Exam Escape | An untimed sequence of room locks. Correct answers advance; an incorrect answer keeps the current lock; three mistakes end the attempt. Every room must be unlocked to escape. |

New multiple-choice choices, repair positions and proof presentation order use
seeded shuffling. Old game question selection and replay are preserved. New games
use bounded original authored fixtures with official supporting sources. Human
editorial approval remains open, including for Concept Match and Code Trace.

## Persistence and limits

The existing private session API stores configuration plus ordered bounded
actions and rebuilds all outcomes on the server. New debug/path/order actions
are validated for exact fields and game context; no client result or grading
key is accepted. Public question payloads whitelist display metadata and exclude
answer keys and proof dependency rubrics. All new practice is free to enter.

The existing account ownership, 100-save limit, manual deletion, practice reward
exclusion, daily per-game token cap, transaction and stale-revision controls
apply to the expanded collection. Deleting a save retains earned ledger entries.
The legacy four-game reward endpoint is unchanged. No database migration is
required: the existing session and ledger game identifiers are text columns.

## Validation and release boundaries

Engine and API acceptance checks cover the new actions, ordering, deterministic
restore, completion/loss, graph ties/disconnected cases, proof equivalent orders,
adaptive selection, room progression, session ownership and idempotent rewards.
The browser suite covers real React controls with fixture HTTP transport, across
mouse, keyboard and touch. This does not bypass or test production Clerk guards.

Verified locally: 127 engine tests, six shared-contract tests, 146 web tests,
17 Chromium scenarios, lint, typecheck and the web production build. The browser
scenarios complete all fourteen games at 1440px, 768px and 390px, and include
loss/retry/source/pause/restore and practice without rewards. Captured game views
were visually reviewed. Seven optional web integration tests were skipped,
including the three PostgreSQL session tests because no disposable test database
URL was configured; signed-in Clerk staging was not run.

Signed-in staging, human content review, screen-reader audit, free-host capacity
measurements, production migration/backup rehearsal and the private 8.D01 deck
bridge remain open. Realtime cross-node delivery is separate from these private
single-player modes. Demand and calibration should still guide further content
expansion rather than being inferred from this implementation request.
