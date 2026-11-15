# Deployment, Backup, and Rollback Runbook

## Deployment prerequisites

- Web: deploy `apps/web` with Vercel or an equivalent Next.js host.
- AI service: deploy `apps/ai-service` on a host that supports Python 3.12, HTTP health checks, and the configured memory limit.
- Database: use the existing Neon Postgres database with pgvector enabled.
- Set every required variable from both `.env.example` files in the host secret manager. Do not copy `.env` files into an image or commit them.

## Release procedure

1. Run lint, typecheck, test, build, Python tests, and the Playwright guard suite from the candidate commit.
2. Run the database migration against staging, then verify `/health`, signed-in upload, chapters, chat, review, export, and account deletion.
3. Deploy the AI service first and verify its exact HTTPS origin is included in the web CSP and its CORS allowlist.
4. Deploy the web application, then check `/`, `/sign-in`, and a signed-in account flow.
5. Watch Sentry and the uptime monitor for 30 minutes before expanding beta access.

## Backup and restore

1. Before every migration, create a Neon branch or a logical Postgres backup and record the commit SHA and migration version.
2. Verify the backup contains `users`, documents, study records, and pgvector data by restoring it to a disposable Neon branch.
3. Store backup access only in the provider account; do not download user data to local developer machines.
4. Test restoration at least once before public beta and record the date and result in the release log.

## Rollback

1. Stop traffic to the unhealthy deployment using the host rollback control.
2. Redeploy the last known-good web and AI service image/commit.
3. Do not run a destructive down migration against production. Restore the pre-migration database branch or use a forward repair migration.
4. Recheck `/health`, sign-in, upload, review, and data export; then review Sentry errors and notify beta users through the chosen feedback channel.

## Beta feedback

Choose a feedback destination before inviting users: a monitored email address, GitHub Discussions, or an issue tracker. Publish that destination in the product footer and record a response owner.
