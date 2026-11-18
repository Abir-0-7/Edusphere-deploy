# Existing game repairs — Phase 8.A12–A13

Historical compatibility note (2026-11-18): the standalone four-game view below
remains a preview. Phase 8G replaced the protected `/games` mount with a seven-game,
server-session player; see `game-vault-phase8g.md` for its current contracts,
untimed question behavior and verification evidence.

The four existing games share deterministic rules, a `GameSession` action log and
one accessible view used by the standalone engine preview. Native HTML controls replace the former Phaser canvas hit
boxes, keeping every square and menu accessible by pointer, touch and keyboard.
This retains the existing games and dependency set; it adds no paid service.
The installed Phaser 3.90.0 input/scale APIs were reviewed before choosing the
native control layer ([Phaser 3.90 scale docs](https://docs.phaser.io/api-documentation/3.90.0/namespace/scale)).

- Sorting accepts finite negative and duplicate values, preserves item IDs and
  rejects invalid/self/post-completion swaps. The reward puzzle remains the
  existing `[4, 1, 3, 2]` challenge.
- Queens exposes all sixteen cells, shows attacks, supports removing/replacing
  queens and wins only with four mutually non-attacking queens.
- Hanoi rejects self/invalid/large-on-small moves, conserves disks and verifies
  all four disks in order on tower three.
- Tower Defense evaluates the submitted True/False against the shared card deck.
  Fixed 60 Hz ticks drive deterministic spawns, enemy approach, escape removal
  and three lives. Wrong answers move the enemy closer. Five correct kills while
  alive win; one kill is insufficient. Escapes remove each enemy once and zero
  lives freezes the loss state.

The shared Zod request contract accepts bounded puzzle actions or tower
`tick`/`answer` actions. Client-created spawns/HP, scores and token amounts do not
control server results. Server replay derives the final score and completion;
`/api/games/rewards` derives owner/day and token amount, using the existing
`token_ledger(reason, ref_id)` unique constraint plus `ON CONFLICT DO NOTHING`.
Repeated/concurrent submissions create one daily reward per user/game and return
zero newly awarded tokens on a conflict. This is bounded practice reward
verification, not proof of elapsed real time or a competitive anti-cheat system.

Pause blocks game actions and ticks. Reset clears transcript/selection/result;
changing games and leaving the page invalidate stale reward callbacks. A hidden
tab pauses automatically. Fixed-loop backlog is bounded. Native controls keep
focus while state changes, wrap at narrow widths and expose status and labels.
No account data is retained in the game view.

Validation includes deterministic rules/replay tests; API duplicate/concurrent
award tests with a simulated unique ledger; and Chromium pointer, keyboard and
touch completions for all four games. Browser tests also exercise pause/reset
and 390/768/1440 px widths. Their reward interceptor replays each actual browser
transcript with the server validator. Authenticated Clerk/real Postgres reward
integration remains a staging check; the browser harness does not bypass auth.

Run the browser harness with the standalone preview on port 5182 and:

```powershell
pnpm --filter @studyvault/game-engine dev --host 127.0.0.1 --port 5182
# In another terminal:
$env:E2E_GAMES_URL='http://127.0.0.1:5182'
$env:E2E_BASE_URL='http://127.0.0.1:5182'
pnpm --filter @studyvault/web exec playwright test e2e/games-controls.spec.ts
```
