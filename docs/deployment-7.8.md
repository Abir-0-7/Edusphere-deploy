# Phase 7.8 Deployment Instructions

This is the operator checklist for the first staging deployment. It does not
authorize a production deploy. Keep Phase 7.8 open until staging is verified and
the owner explicitly approves production traffic.

## 1. Resolve deployment blockers

- Runtime dependencies are pinned in `apps/ai-service/requirements.txt`, and
  CI installs the separate `requirements-dev.txt`. Validate both in a clean
  Python 3.12 environment before merging future dependency changes.
- Decide whether the optional realtime server and Judge0 runner will be exposed
  during this deployment. Leave both off unless their environment, origin,
  resource limits, and operational checks are configured. Do not expose Judge0
  until Phase 5.7's fork-bomb, infinite-loop, and network-call probes have been
  contained on the actual VPS.
- Confirm the Neon database, Clerk instance, Upstash Redis, free-tier model
  provider configuration, Sentry project, and domain are ready for staging.
  Preserve the existing Neon database and pgvector; do not substitute Render's
  temporary free database for user data. Check host usage and billing limits
  before enabling provider keys.
- Produce a staging release from a clean commit. Run the repository CI
  commands, including `pnpm audit --prod`, `pip-audit`, Python tests, and the
  Playwright guard tests. Run the signed-in flow with a Clerk test token and a
  small PDF fixture before considering production.

## 2. Deploy the FastAPI service

Apply the root `render.yaml` Blueprint. It creates a free-plan Docker web
service rooted at `apps/ai-service`, builds the checked-in Dockerfile, and
checks `/health`. The image installs Tesseract so scanned-PDF OCR works; the
service `.dockerignore` keeps local secrets, virtualenvs, tests, and caches out
of the build context. For
manual setup, select Docker, use `apps/ai-service` as the root, `.` as the
build context, and `Dockerfile` as the Dockerfile path (both relative to that root). Confirm the service returns
`{"status":"ok"}` over HTTPS.

The Blueprint requests the required secret values during its initial setup.
Supply them from the staging environment, then add provider values from
`apps/ai-service/.env.example` only after the provider's free-tier status and
account billing cap have been checked. Required values include:

- `AI_SERVICE_DATABASE_URL`: Neon connection string, using the pooled URL where
  appropriate and a dedicated migration connection for migrations.
- `AI_SERVICE_JWT_JWKS_URL`, `AI_SERVICE_JWT_ISSUER`, and
  `AI_SERVICE_JWT_AUTHORIZED_PARTIES`: exact Clerk issuer/JWKS and allowed web
  origins; verify claims using a real staging session token.
- `AI_SERVICE_JWT_DEV_MODE=false`.
- `AI_SERVICE_CORS_ORIGINS`: the exact HTTPS web origin(s), with no wildcard.
- `AI_SERVICE_LLM_PROVIDER_ORDER` and provider base URL/model/key variables:
  only models verified as free for the account, with provider-side spending
  disabled or hard-capped before a key is added.
- `AI_SERVICE_SENTRY_DSN` if staging telemetry is configured.

Set the remaining upload, worker, OCR, embedding, and timeout values from the
example file deliberately. Do not copy the local `.env` file. Run the database
migrations from a trusted operator machine against staging before sending user
traffic; do not run `drizzle-kit migrate` as an unreviewed service startup step.

Render's free web instances spin down after 15 idle minutes and may take about a
minute to wake. Treat that as a staging/demo constraint, explain the first
request's loading delay in the UI, and do not represent a sleeping free instance
as production-grade availability. Review current [Render free instance
limits](https://render.com/docs/free) before selecting a plan.

## 3. Deploy the Next.js web app

Create a Vercel project from the repository with **Root Directory**
`apps/web`. Enable access to workspace source files outside that directory so
the build can resolve `packages/db`, `packages/types`, and the root pnpm
workspace. Use the detected pnpm install setting and verify a preview
deployment before promoting it.

Keep the dependency-aware Turbo build enabled so the shared game engine is built
before Next.js packages the web app. From the web root, an explicit build command is
`cd ../.. && pnpm exec turbo run build --filter=@studyvault/web...`.
The Cyberverse Godot export is checked in; no Godot build is required.

For scanned Bangla PDFs, set `AI_SERVICE_OCR_LANG=eng+ben` on Render. The
Docker image includes both language packs. Deploy the updated image after
changing the OCR configuration.

Test browser requests from the stable web origin configured in
`AI_SERVICE_CORS_ORIGINS` and `AI_SERVICE_JWT_AUTHORIZED_PARTIES`. Vercel's
deployment-specific preview origins are different hosts; each needs its own
explicit allowlist entry if it will be used for authenticated API testing.

Configure Vercel environment variables separately for **Preview** and
**Production**; a variable change applies only to new deployments. Use a
separate staging database and Clerk test instance for Preview. Set at least:

- `DATABASE_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SIGNING_SECRET`
- `AI_SERVICE_URL` to the FastAPI HTTPS origin and
  `NEXT_PUBLIC_AI_SERVICE_URL` to the browser-accessible HTTPS origin
- `AI_SERVICE_INTERNAL_TOKEN`
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- `AI_DAILY_LIMIT` and `AI_RATE_LIMIT_PER_MIN` to the approved quotas
- `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` when Sentry is configured

Guided-course and learning-profile requests go through the authenticated
same-origin `/api/learning-service` route and use server-only `AI_SERVICE_URL`.
The AI service must still allow the exact Clerk authorized party for each web
origin that issues session tokens, including preview origins used for testing.
Other browser features that call the AI service directly also need
`NEXT_PUBLIC_AI_SERVICE_URL`, CSP `connect-src` coverage, and their deployed
origin in the AI service's exact CORS allowlist.

Set `NEXT_PUBLIC_AI_SERVICE_URL` before building because it determines the AI
origin allowed by the nonce-based Content Security Policy. Verify the emitted
CSP includes the deployed AI origin and the configured Clerk production
domain. Clerk's SDK currently includes an `'unsafe-inline'` compatibility
source; its strict mode also uses a fresh nonce and `strict-dynamic`, which
modern CSP-capable browsers use to authorize framework scripts. The root
`ClerkProvider` renders dynamically for nonce support, so page HTML is rendered
per request rather than served from a static build cache.

After deploying the web app, configure the Clerk webhook to the deployed
`/api/webhooks/clerk` URL and subscribe to the user create, update, and delete
events used by the handler. Verify a signed event and a deletion in staging;
the deletion test must confirm cascading removal of the linked app data.

## 4. Optional realtime and code execution services

If realtime multiplayer is enabled, run `@studyvault/realtime` as a persistent
Node service with a public WebSocket-capable HTTPS origin. Build from the
workspace root after `pnpm install --frozen-lockfile`, then run
`pnpm --filter @studyvault/realtime build` and start with
`pnpm --filter @studyvault/realtime dev` only if the deployment host's start
command is configured for the compiled production entry point. Before
exposure, provide `DATABASE_URL`, `REALTIME_JWT_DEV_MODE=false`,
`REALTIME_JWT_JWKS_URL`, `REALTIME_JWT_ISSUER`,
`REALTIME_JWT_AUTHORIZED_PARTIES`, exact `REALTIME_ALLOWED_ORIGIN`, and Upstash
credentials. Confirm reconnect, membership authorization, and database scoping
against staging. Add a production start script and health endpoint before
selecting this service for deployment.

The code runner is an adapter that calls a separate Judge0 CE host. Keep Judge0
on the selected, hardened VPS; require HTTPS and configure `JUDGE0_BASE_URL` and
`JUDGE0_API_KEY` as server-only Vercel variables. Verify firewall isolation,
network denial, CPU/memory/wall-clock/process/file limits, queue bounds, and
the Phase 5.7 adversarial probes before enabling the submission route. Do not
deploy a public runner based only on the payload settings sent by the adapter.

## 5. Verify staging before production

Run these checks against deployed staging origins and record the commit SHA,
URLs, database migration version, operator, and result in the release log:

1. Check the web home page, sign-in, and protected-route redirect.
2. Sign in with the Clerk test account; upload a small text PDF; poll the job;
   open chapters; ask a cited chat question; create and review flashcards.
3. Confirm unauthenticated API requests return 401, cross-origin requests are
   rejected, and a user cannot read another user's document or job.
4. Export the signed-in test user's data, delete that test account, and confirm
   the Clerk webhook removed the app data.
5. Inspect response headers for CSP, HSTS at the edge, referrer policy, frame
   protection, and `nosniff`. Verify production Clerk and AI origins work.
6. Confirm the Sentry test event, structured AI usage log fields, GitHub uptime
   workflow, and alert delivery to an owned monitored destination.
7. Verify provider load only with zero-billing or hard-capped staging
   credentials. Confirm account billing controls directly with the provider.
8. Exercise the backup and restore runbook in `docs/operations.md` on a
   disposable database branch. Verify a rollback of the web/API release and
   the forward-fix strategy for migrations.

Proceed to production only after all checks pass, alerts have a monitored
recipient, restore has succeeded, and the owner approves the production
deployment. Promote the verified preview/release, watch error rate, p95
latency, provider fallback and quota exhaustion for at least 30 minutes, and
roll back promptly if health or core study flows regress. Do not claim a public
beta until the feedback destination is selected and published.

## Current platform documentation

- [Vercel monorepos](https://vercel.com/docs/monorepos)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Render FastAPI deployment](https://render.com/docs/deploy-fastapi)
- [Render monorepo support](https://render.com/docs/monorepo-support)
- [Render health checks](https://render.com/docs/health-checks)
