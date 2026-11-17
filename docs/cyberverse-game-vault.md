# CYBERVERSE Game Vault integration

Work is on `feat/game-vault-cyberverse`. No commit, push, production deployment or database migration is performed automatically.

## Existing stack and identity/token paths

This repository is a pnpm 9.7.1 / Turborepo monorepo. `apps/web` is Next.js 16 App Router, React 19, TypeScript and Tailwind 4. Clerk supplies the existing student session through `ClerkProvider`, the session proxy and the server-side `(protected)/layout.tsx` guard. Web API handlers use Clerk `auth()` and map the Clerk subject to the internal UUID via `getUserByClerkId`. No new authentication system is introduced.

`apps/ai-service` is FastAPI/Python with Clerk RS256/JWKS verification (and an existing development-only verifier), PostgreSQL study storage and AI endpoints. The web app uses Drizzle/postgres-js against the existing PostgreSQL schema. Other apps include the Phaser 3/Vite Game Vault, Socket.IO realtime service, code runner and browser extension.

Existing relevant FastAPI endpoints:

- `POST /api/focus-sessions`, `GET /api/focus-sessions/current`
- `POST /api/focus-sessions/{session_id}/complete`: server derives elapsed focus and awards ledger tokens idempotently.
- `GET /api/tokens/balance`: returns `{balance}` from the existing ledger.
- `GET /api/dashboard`: includes `token_balance`.

Existing web endpoint `POST /api/games/rewards` verifies Phaser action replays and appends a daily game reward. It remains unchanged. The existing wallet is `token_ledger`; balance is `SUM(amount)`. No mission-unlock/spending endpoint existed before this integration. The original four games remain available through the Logic Arcade catalog entry.

## New integration

`gameVaultCatalog` in `apps/web/src/lib/game-vault/catalog.ts` defines entries, URLs, controls and mission display data. CYBERVERSE is first. `/games` lists entries; `/games/[gameId]` uses the shared player wrapper. Add another catalog entry to reuse the wrapper; a new game using production mission unlocks also needs authoritative server mission rules. Existing Logic Arcade uses its unchanged server-reward implementation.

The embedded game is same-origin at `/games/cyberverse/index.html`. The wrapper supplies fullscreen, control instructions and a live token/XP/achievement header. The iframe mounts only after initial account context resolves or a bounded backend timeout selects a separate demo state.

New Clerk-authenticated web routes:

| Route | Purpose |
| --- | --- |
| `GET /api/game-vault/context?gameId=cyberverse` | Read existing ledger balance and game-specific persisted progression |
| `POST /api/game-vault/unlock` | `{gameId,missionId,requestId}`; atomically debit the existing ledger and grant one entitlement |
| `POST /api/game-vault/progress` | `{gameId,missionId,requestId,evidence}`; validate Binary answers and award XP/achievement once |

Mutation handlers require the exact request Origin. Client prices, student IDs, XP values and achievement lists do not authorize changes. Server prices are **5, 10, 15, 20, 25 and 30** for the six listed missions. Each unlock locks the user row, checks existing ownership and balance, then writes the entitlement and negative ledger entry in the same transaction. Insufficient funds and invalid inputs produce no debit. Replays are free. Invalid educational answers produce no additional charge and no XP.

The new `game_mission_progress` table stores unlock/completion timestamps, awarded XP and achievements with a unique user/game/mission key. XP never enters the token ledger. Binary City currently validates six answer indices for `binary-v1` and awards 100 XP plus `first_transmission` once; the other five districts remain previews. This is educational answer validation, not a tamper-proof assessment or anti-cheat system.

Apply `packages/db/drizzle/0007_game_vault_missions.sql` through the existing migration tooling **only against an authorized local/staging database** before testing production-backed unlocks. This change does not run it for you. If the database/table is unavailable, the context route returns 503 and the host uses the isolated demo. Never point a local migration command at a production database casually.

## Message contract

Every message is `{channel:'edusphere.game-vault',version:1,gameId:'cyberverse',type,requestId,payload}`. Both sides validate the exact origin and sender window. No wildcard target, API key, Clerk token or password is passed into the game.

- Game → host: `EDUSPHERE_GAME_READY`.
- Host → game: `EDUSPHERE_INIT_CONTEXT` with `{mode,student:{id,displayName},tokens,xp,unlocked,completed,achievements}`.
- Game → host: `EDUSPHERE_UNLOCK_MISSION_REQUEST` with `{missionId}`.
- Host → game: `EDUSPHERE_UNLOCK_MISSION_RESPONSE` with `{missionId,ok,state}` or `{missionId,ok:false,error}`.
- Game → host: `EDUSPHERE_MISSION_PROGRESS` with `{missionId,completed:true,evidence:{challengeVersion:'binary-v1',answers:[...]},xpEarned,achievements}`. Claimed rewards are ignored by the backend.
- Host → game: `EDUSPHERE_MISSION_PROGRESS_RESPONSE` in the same success/error format.

The Godot adapter waits for responses; it never locally debits production tokens. Unknown/unmatched responses cannot grant access. Host operations are serialized and request IDs are deduplicated; durable idempotency is the unique entitlement/completion key. A network timeout after a transaction may have committed is ambiguous: the request is not replayed into demo state. Reconnect reconciles the real server state and owned missions remain free.

## Automatic demo fallback

Network errors, backend 5xx responses or context timeouts select a separate per-student `localStorage` demo with 100 synthetic tokens. Production balances/unlocks are never imported into that state, and demo rewards are never uploaded as production entitlement. 401/403 authentication errors do not bypass Clerk or cause production spending. With normal configuration, protected routes still require sign-in when the database is offline. The explicit localhost-only development mode below is a separate exception for Game Vault pages; it does not create an authenticated student.

Desktop/unframed Godot automatically uses its local mock adapter. A same-origin iframe uses the host adapter; a missing host handshake falls back after three seconds. Standalone demo saves are separate from the old submission save. P and Escape both pause; M and P release pointer capture. Existing movement controls are preserved.

## Local launch

From PowerShell:

```powershell
cd C:\Users\Sakib\Desktop\SaGame\edusphere
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @studyvault/game-engine build
corepack pnpm --filter @studyvault/web dev
```

Open `http://localhost:3000/games/cyberverse` and sign in using the existing EduSphere Clerk account. The repository's existing `apps/web/.env.example` documents the required environment variables; configure legitimate local/staging values in an ignored `.env.local`. No secret values are supplied by this integration. Existing startup validation requires Clerk, database, AI-service and Redis variables even if the Game Vault later falls back from a database outage. Do not weaken that validation or fabricate credentials to bypass authentication.

For production-backed local unlocks, first apply the migration using `corepack pnpm --filter @studyvault/db db:migrate` **with a verified local/staging `DATABASE_URL`**. A fresh real account has only its existing earned ledger tokens; no free production balance is minted. Do not run this migration against production without owner review.

## Web asset lifecycle

The checked-in CYBERVERSE export lives under `apps/web/public/games/cyberverse/`. It is included intentionally; the existing Vite build now preserves that directory. Other original generated Phaser files remain ignored. `build-manifest.json` records file lengths and SHA-256 hashes. A normal EduSphere build does not require the sibling Godot source.

After exporting the game from Godot, copy its external bridge beside the export and run the opt-in synchronization:

```powershell
Copy-Item C:\Users\Sakib\Desktop\SaGame\cyberverse\web\edusphere_bridge.js C:\Users\Sakib\Desktop\SaGame\cyberverse\build\web\edusphere_bridge.js
cd C:\Users\Sakib\Desktop\SaGame\edusphere
node apps/web/scripts/sync-cyberverse.mjs
```

The static game path has its own CSP for Godot inline bootstrap/WebAssembly and same-origin embedding; the rest of EduSphere keeps its strict Clerk CSP. The JavaScript bridge uses an external script and no `eval`. The session proxy excludes only that public game asset path so `.wasm` and `.pck` requests are not intercepted. API routes remain authenticated.

## Validation commands

```powershell
corepack pnpm --filter @studyvault/web typecheck
corepack pnpm --filter @studyvault/web test
corepack pnpm --filter @studyvault/web lint
corepack pnpm exec turbo run build --filter=@studyvault/web...
node --experimental-strip-types apps/web/scripts/check-game-vault.mjs
```

The web `typecheck` script first builds its existing workspace dependencies in topological order using `corepack pnpm --filter "@studyvault/web^..." --recursive run build`, then runs TypeScript. This emits the `dist` entry points/declarations required by `@studyvault/code-runner` and `@studyvault/game-engine`. It excludes the web app itself, so a typecheck does not require a Next production build or its runtime credentials. Corepack keeps nested commands on the repository-pinned pnpm version; the quoted caret selector works in Windows package scripts. The existing game engine is reused.

The final command is a dependency-free contract smoke test for Node 24. It does not replace TypeScript, Vitest, a Next build, an authorized database integration test or an actual browser check. No Edge automation or native screenshot audit is required for this milestone.

Current verification while implementing: Godot foundation 53/53, transport 34/34, mission/navigation 158/158, prototype 41/41 and host-UI integration 9/9. The dependency-free catalog/demo/security contract test passes. TypeScript, Vitest, ESLint and Next build were attempted but the sandbox cannot read pnpm-linked dependency files; automatic approval review repeatedly timed out. Do not interpret those blocked checks as passes. A real Clerk/PostgreSQL integration and manual browser test are still required before production deployment. The migration has not been applied.

## Follow-up typecheck fix

Fixed payload narrowing by binding the validated payload and mission ID to local constants before the array callback. `corepack pnpm --filter @studyvault/web typecheck` now builds all four existing workspace dependencies and passes (exit 0). Focused Game Vault Vitest checks pass: 3 files, 30 tests. Your successful full Godot Web export was synchronized and the Web ZIP refreshed; all ten hosted files match the manifest and export.

Follow-up web lint also passes (exit 0) after explicit Node URL imports in the two helper scripts. Full Next production build and live database/browser testing remain separate checks.

## Local offline startup (no live service credentials)

The ignored `apps/web/.env.local` now supplies valid-format local placeholders and `EDUSPHERE_LOCAL_DEMO=true`. Next loads this file automatically. The typed environment schema still validates every required variable; production configuration is not silently defaulted.

Run `corepack pnpm --filter @studyvault/web dev` from the repository root, then open **http://localhost:3000/games** or **http://localhost:3000/games/cyberverse**. The development server was started successfully and both pages returned HTTP 200 with the local offline banner. The game HTML returned HTTP 200. No real Clerk, Postgres, Redis or AI service is required for this demo.

Local demo is accepted only with `NODE_ENV=development`, the explicit flag, and a loopback URL/Host. Only `/games` pages and `/api/game-vault/` are allowed through the development proxy; other app pages return an offline notice. The root/protected layouts render a dedicated demo shell without ClerkProvider or Clerk hooks. The shared Vault player receives a synthetic local explorer and handles the existing postMessage protocol using isolated browser localStorage. One-time mission unlocks, free replay, XP and achievements use demo tokens only. Existing live auth and ledger code is untouched when the flag is off.

The context API returns `503 local_demo_mode` before Clerk/database calls, and unlock/progress APIs return `403 local_demo_client_only`; the demo host handles transactions in its local store, never through the production wallet. No local demo session is treated as a signed-in student. Production startup rejects an enabled demo flag; set it false and configure real credentials before building/deploying.

Verified Git state: `git check-ignore -v apps/web/.env.local` matches `.gitignore`, `git status --short --ignored -- apps/web/.env.local` prints `!!`, and `git ls-files apps/web/.env.local` is empty. The local file contains placeholders only and is not added or committed. Do not force-add ignored environment files.

Validation: local environment/host/proxy guards plus Game Vault client/server tests pass (52 tests across six files). HTTP checks confirm local pages render, mutations cannot touch live state, unrelated routes are blocked, and a nonlocal Host receives 403. Browser UI automation was not run.
