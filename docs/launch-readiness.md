# Launch Readiness

Last reviewed: 2026-11-16.

Local code and automated checks are complete for the portions of Phase 7 tasks
7.1, 7.3, and 7.4 implemented here. Tasks 7.2 and 7.5-7.7 retain provider,
visual/accessibility, or production-monitoring acceptance checks. The remaining
checks in this document are deployment or manual staging gates; local tests do
not represent them as passed.

## Coverage and core-flow review

| Flow | Automated coverage | Remaining release check |
|---|---|---|
| Authentication and route guards | FastAPI auth tests; Playwright anonymous guard suite | Sign in with a Clerk testing token in CI |
| Upload and parsing | API tests cover auth, size limit, encrypted PDFs, and upload-to-chapters | Run once against production object/database settings |
| Chat, summaries, flashcards, and reviews | Unit and integration tests cover schemas, grounded responses, SM-2, and offline review idempotency | Full signed-in browser flow needs `CLERK_TESTING_TOKEN` and `e2e/fixtures/lecture.pdf` |
| AI fallback | Unit tests cover 429, 5xx, timeout, retry, circuit, cache; a 25-request burst confirms circuit failover | Run against configured staging providers without paid keys and verify provider billing caps |
| Privacy | Database integration tests cover scoped JSON export, guild ownership/membership, and cascading delete | Confirm Clerk `user.deleted` webhook delivery in staging/production |

## Security controls

- API routes require the FastAPI `current_user_id` dependency; a route inventory test enforces this.
- Browser-to-AI requests are protected by explicit `AI_SERVICE_CORS_ORIGINS`; wildcards fail startup validation.
- Web responses set CSP, no-sniff, referrer, permissions, and frame-ancestor policies.
- Uploads have MIME/magic-byte, size, page-count, encrypted-file, and corrupt-file checks.
- User-owned database queries carry `user_id` scoping; database foreign keys cascade deletion.
- User text and document content are treated as untrusted data in AI prompts.

## OWASP-focused review

- **Access control:** FastAPI route inventory tests require `current_user_id`; database lookups include the authenticated user id. Account deletion requires an authenticated session and matching `Origin`.
- **Cryptography and secrets:** production must disable development JWT mode, use HTTPS, and keep provider/database credentials in host secret stores. Secret rotation and provider account billing caps are deployment tasks.
- **Injection:** SQL values are parameterized; dynamic table/column names in the privacy exporter come only from the static `_OWNED_TABLES` allowlist. Uploaded document text and user code remain untrusted prompt data.
- **Insecure design and abuse:** uploads have bounded reads, MIME/signature, size, page, encrypted, and corrupt-file checks. Per-user quotas and an AI-provider circuit breaker limit repeated calls; run provider load checks only with zero-billing test keys.
- **Security configuration:** explicit CORS origins and response security headers are configured. Clerk strict nonce CSP mode supplies `strict-dynamic`; verify the exact Clerk origin and deployed API origin before release; no wildcard CORS is allowed.
- **Vulnerable components:** CI runs `pnpm audit --prod` and `pip-audit`; findings must be reviewed and resolved before release.
- **Logging and monitoring:** Sentry, structured usage logs, and the repository-managed uptime workflow are documented in `docs/monitoring.md`; alert destinations, log sink, quota-status source, and production URL still need configuration.

This is a code-level review checklist, not a certification. Production configuration and operational checks remain open below.

## Before production

1. Set `AI_SERVICE_JWT_DEV_MODE=false`, `AI_SERVICE_JWT_ISSUER`, and `AI_SERVICE_JWT_AUTHORIZED_PARTIES`.
2. Set `AI_SERVICE_CORS_ORIGINS` to the exact HTTPS web origin and `NEXT_PUBLIC_AI_SERVICE_URL` to the exact HTTPS API origin.
3. Use only free provider keys, set provider account billing limits to zero where available, and verify the configured models are free-tier models.
4. Run `pnpm audit --prod` and `pip-audit` in the deployment environment; resolve or explicitly accept each finding before release.
5. Configure Sentry DSNs, the `STUDYVAULT_HEALTH_URL` repository variable, a log sink, and alerts for error rate, p95 latency, fallback events, and quota exhaustion as described in `docs/monitoring.md`.

## Metrics and alert thresholds

| Signal | Alert threshold | Source |
|---|---:|---|
| API uptime | Any failed `/health` check for 5 minutes | External uptime monitor |
| Error rate | > 2% for 10 minutes | Sentry / application logs |
| AI fallback failure | > 1% over 15 minutes | Router usage logs |
| p95 provider latency | > 20 seconds over 15 minutes | Router usage logs |
| Quota exhaustion | > 5% of active users per day | Web quota logs |

An alert destination and production monitoring account are still required to activate these checks.
