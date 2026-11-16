# EduSphere feature readiness

The deployment repository exposes the existing learning services through a new
workspace. It does not represent completion of every item in the product plan.

| Objective | Available in this release | Remaining work |
| --- | --- | --- |
| Interactive AI tutor | PDF library and upload; chapter navigation; streamed explanations at three depths; cited questions; generated viva questions, hints and feedback; link to all document tools | Saved lesson completion, mastery tracking and an adaptive course progression model |
| Focus engine | Focus timers, completed study time, readiness and progress views | Verify the signed-in flow against the deployed API and database |
| Study tokens | Real ledger balance on the dashboard; existing server-verified focus/game rewards | Token spending, game unlocks and chapter-completion rewards |
| Game Vault | Sorting Race, N-Queens, Towers of Hanoi and Flashcard Tower Defense; mouse/touch and keyboard answers | Multiplayer integration; Tower Defense currently uses a built-in practice deck rather than a user's generated flashcards |
| Academic toolkit | Owned PDF text export; English/Bangla image OCR; editable citation fields; assignment cover maker; whiteboard and complexity viewer | Verify Bangla scanned-PDF extraction on the updated Render image |
| Code execution | Existing battle page and Judge0 adapter remain in the repository | Separate isolated runner deployment and validation; do not enable execution on the web/API hosts |
| Realtime | Existing Socket.io service remains in the repository | Production start/health setup, web client integration, authenticated multiplayer acceptance |
| Mobile launch | Responsive web workspace | Native packaging and Google Play release |

## Deploy this release

1. Keep Vercel's root directory at `apps/web`, with workspace source files
   outside the root directory included. Use the dependency-aware build:
   `cd ../.. && pnpm exec turbo run build --filter=@studyvault/web...`.
   It builds the game bundle and prepares pinned same-origin OCR assets.
2. Keep both web service URL variables pointed at
   `https://studyvault-ai-q3rc.onrender.com`. These identify the existing service;
   the product shown in the app is EduSphere.
3. Use `https://edusphere-deploy.vercel.app` for testing. On Render, configure
   that exact origin in both `AI_SERVICE_CORS_ORIGINS` and
   `AI_SERVICE_JWT_AUTHORIZED_PARTIES`. If testing from a preview domain, add
   that exact additional origin explicitly using the configuration's comma
   separated format. Do not use a wildcard.
4. To enable Bangla scanned-PDF OCR, deploy the updated API Docker image and
   set `AI_SERVICE_OCR_LANG=eng+ben`. The Blueprint's automatic deploy trigger
   is off, so use Render's manual deploy for the updated image.
5. Sign in on the stable domain, upload a small PDF, wait for processing,
   open its tutor, ask a cited question, generate practice, export text,
   review generated flashcards and complete a game. This verifies the real
   Clerk/Neon/Render connection; local placeholder credentials cannot do so.

See [the deployment guide](deployment-7.8.md) for required environment variables.
Never put real credentials in this file or Git.
