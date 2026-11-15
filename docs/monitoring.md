# Monitoring and Alerts

This project has a repository-managed uptime check and application telemetry. The
check becomes active after its GitHub repository variable is configured. The
configuration below uses GitHub Actions, Sentry, and the host's existing JSON
stdout logs. It does not add a paid monitoring service or commit any credentials.

## Uptime check

The [`uptime.yml`](../.github/workflows/uptime.yml) workflow runs every five
minutes and can also be started with **Run workflow**. It checks the deployed AI
service's HTTPS `/health` endpoint with a 20-second timeout, two retries, and a
JSON assertion that `status` is `ok`.

Before enabling it, create the repository variable
`STUDYVAULT_HEALTH_URL` with a value such as
`https://api.example.com/health`:

1. Open **Repository settings > Secrets and variables > Actions > Variables**.
2. Add `STUDYVAULT_HEALTH_URL` with the public HTTPS URL.
3. Run the workflow manually once and confirm the check passes.
4. Configure GitHub Actions failure notifications for the repository owners. A
   failed scheduled run is the alert; the workflow intentionally has no webhook
   or paid notification dependency.

GitHub may delay scheduled workflows during runner load and disables schedules
for repositories with prolonged inactivity. Treat this as a five-minute
best-effort check and keep the host's own health-check/restart settings enabled.

## Sentry dashboard and alerts

Set `AI_SERVICE_SENTRY_DSN` on the FastAPI host and `SENTRY_DSN` plus
`NEXT_PUBLIC_SENTRY_DSN` on the web host. The FastAPI service initializes Sentry
with 20% tracing and the web service initializes server tracing at 20% and client
tracing at 10%. Keep `AI_SERVICE_JWT_DEV_MODE=false` in production while doing
this setup.

Set the Sentry environment to `production` on both hosts, then create a Sentry
dashboard with these widgets:

| Widget | Signal |
| --- | --- |
| Web and API errors | Error events grouped by environment and route |
| Request latency | Transaction p95 by service and route, where sampled transactions are available |
| Provider latency | p95 `latency_ms` from the structured usage log dashboard below |
| Fallback activity | `fallback=true` events from the structured usage log dashboard below |

Create Sentry issue alerts for new production errors and regressions, and send
them to the team's monitored email or approved incident channel. Keep the
production environment filter enabled. The SDK samples transactions at 20% for
the API and 20% server-side / 10% client-side for web, so use request logs for
the defined error-rate and latency thresholds instead of treating sampled Sentry
transactions as a complete request count. Sentry does not currently receive the
router's `fallback` field directly.

## Structured usage log dashboard

The AI service writes one-line JSON records to stdout. Records from the LLM
router have `msg="llm_usage"` and these fields:

`provider`, `model`, `prompt_tokens`, `completion_tokens`, `latency_ms`,
`cache_hit`, and `fallback`.

Configure the deployment host's existing log viewer or JSON-compatible log sink
to parse those fields, then create these saved queries/widgets:

- `msg = "llm_usage"`: request count and p95 of `latency_ms` by provider.
- `msg = "llm_usage" AND fallback = true`: fallback volume and percentage by
  15-minute window.
- `msg = "llm_usage" AND provider = "cache"`: cache-hit rate and quota-saving
  trend.

Alert when the fallback query exceeds 1% of AI requests for 15 minutes or when
p95 `latency_ms` exceeds 20,000 ms for 15 minutes. These are host-log alerts; the
log query syntax and alert UI depend on the already-selected application host.
Keep provider names and model names in the dashboard so an outage can be tied to
one configured slot without exposing API keys.

For API error rate, use the host's request/access logs grouped by service, route,
status, and 10-minute window; alert above 2% 5xx responses for 10 minutes. If the
host does not provide request logs or alerting, this threshold needs a log sink
or monitor selected during production setup.

## Quota exhaustion signal

The web AI route returns HTTP 429 with `Retry-After` for both the per-minute
limit and the daily quota. The current route does not emit a dedicated JSON log
event for those responses. Until access logs are confirmed to include HTTP status
and route, do not claim that a quota-exhaustion alert is active. Once the host
exports web access logs, add a counter for `POST /api/ai` with status `429` and
alert when more than 5% of active users receive a quota/rate-limit response in a
day. If the host does not export access logs, add a structured quota event to the
route before enabling this alert.

## Release verification

Record the date, commit, dashboard URL, alert recipients, and results of these
checks in the release log:

1. Run the uptime workflow manually and verify `/health` returns HTTP 200 with
   `{"status":"ok"}`.
2. Trigger a controlled Sentry test event in the production project and confirm
   the error widget and notification.
3. Make one AI request with a zero-billing test provider configuration and
   confirm that an `llm_usage` record appears with provider, latency, and token
   fields.
4. Confirm the host log viewer can count HTTP 429 responses before activating the
   quota alert.
