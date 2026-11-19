# EduSphere feature readiness

The deployment repository exposes the existing learning services through a new
workspace. It does not represent completion of every item in the product plan.

| Objective | Available in this release | Remaining work |
| --- | --- | --- |
| Interactive AI tutor | PDF library and upload; chapter navigation; streamed explanations at three depths; cited questions; generated viva questions, hints and feedback; link to all document tools | Saved lesson completion, mastery tracking and an adaptive course progression model |
| Guided courses | Published Python Foundations, PyTorch Fundamentals, SQL Query Foundations and Git Foundations; version-pinned lessons, labs and assignments stored in Neon | Updated Render API deployment and signed-in hosted acceptance; isolated browser and API checks do not prove the hosted image is current |
| Focus engine | Focus timers, completed study time, readiness and progress views | Verify the signed-in flow against the deployed API and database |
| Study tokens | Real ledger balance on the dashboard; existing server-verified focus/game rewards | Token spending, game unlocks and chapter-completion rewards |
| Game Vault | Sorting Race, N-Queens, Towers of Hanoi and Flashcard Tower Defense; mouse/touch and keyboard answers | Multiplayer integration; Tower Defense currently uses a built-in practice deck rather than a user's generated flashcards |
| Academic toolkit | Owned PDF text export; English/Bangla image OCR; editable citation fields; assignment cover maker; whiteboard and complexity viewer | Verify Bangla scanned-PDF extraction on the updated Render image |
| Code execution | Existing battle page and Judge0 adapter remain in the repository | Separate isolated runner deployment and validation; do not enable execution on the web/API hosts |
| Realtime | Existing Socket.io service remains in the repository | Production start/health setup, web client integration, authenticated multiplayer acceptance |
| Mobile launch | Responsive web workspace | Native packaging and Google Play release |

## Deploy this release

### Course/profile 404 recovery (2026-11-19)

The Vercel learning proxy is deployed, but the checked Render service still runs
an older image without `/api/courses` or `/api/learner-profile`. These 404s do
not mean the course catalog is empty. Both services must run the updated release.

Keep the existing Neon Postgres database for course releases, enrollments,
profiles and AI state; keep Upstash for rate limiting. Apply the canonical
`0009_phase8c` and `0010_phase8_ai_durability` migrations before updating the
backend. Startup idempotently installs the four published course releases.

Release preparation on 2026-11-19 applied both migrations to the existing Neon
database and verified their hashes in the migration ledger. Catalog seeding was
run twice and verified exactly four published v2 releases with labs and an
assignment each, without duplicate releases or writes to learner-owned rows.
This database verification does not imply that Render is running the new code.

After pushing the release to `main`, manually deploy that commit on the existing
`studyvault-ai` Render service. Auto-deploy is disabled in `render.yaml`, so a
GitHub/Vercel success alone does not update the API. Verify `/ready` and confirm
the course/profile routes appear in `/openapi.json`, then sign in on the stable
web domain and confirm all four courses and the profile load. Do not create a
new Render database or move course content to Redis to resolve this error.

1. Keep Vercel's root directory at `apps/web`, with workspace source files
   outside the root directory included. Use the dependency-aware build:
   `cd ../.. && pnpm exec turbo run build --filter=@studyvault/web...`.
   It builds the game bundle and prepares pinned same-origin OCR assets.
2. Set server-side `AI_SERVICE_URL` to `https://studyvault-ai-q3rc.onrender.com`.
   Guided courses and learning-profile requests use the authenticated
   same-origin `/api/learning-service` proxy, avoiding browser CORS.
   `NEXT_PUBLIC_AI_SERVICE_URL` is still used by other browser-direct tools.
3. Use `https://edusphere-deploy.vercel.app` for testing. On Render, configure
   that exact origin in `AI_SERVICE_JWT_AUTHORIZED_PARTIES`; add it to
   `AI_SERVICE_CORS_ORIGINS` for browser-direct AI tools. If testing a Vercel
   preview, add that exact preview origin to both allowlists while testing.
   Never use a wildcard.
4. To enable Bangla scanned-PDF OCR, deploy the updated API Docker image and
   set `AI_SERVICE_OCR_LANG=eng+ben`. The Blueprint's automatic deploy trigger
   is off, so use Render's manual deploy for the updated image.
5. Sign in on the stable domain, upload a small PDF, wait for processing,
   open its tutor, ask a cited question, generate practice, export text,
   review generated flashcards and complete a game. This verifies the real
   Clerk/Neon/Render connection; local placeholder credentials cannot do so.

See [the deployment guide](deployment-7.8.md) for required environment variables.
Never put real credentials in this file or Git.
