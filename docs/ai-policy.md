# StudyVault AI admission policy

Implementation status: 2026-11-18, Phase 8 tasks 8.A01-A04.
Metadata-only operations, provider attempts, token reservations and generation
leases persist in owner-scoped Postgres tables and are included in account export.

## Authoritative admission

Every production text-generation call passes through the FastAPI fallback router.
The verified request dependency binds the internal authenticated owner; background
jobs bind the trusted queued owner. Request bodies cannot select the charged user.
Missing ownership fails closed before cache access or a provider request.

Immediately before the first eligible provider attempt, the router checks the
per-user minute window and atomically debits the existing Postgres users counter.
The web compatibility proxy does not increment/reset that counter. Direct API and
proxied calls therefore share the same allowance.

| Config | Default | Meaning |
|---|---|---|
| `AI_DAILY_LIMIT` | 30 | Logical text-generation calls per user per UTC day, across features and jobs |
| `AI_RATE_LIMIT_PER_MIN` | 30 | Logical call admission attempts per user in a fixed UTC-minute window |
| `AI_SERVICE_LLM_MAX_PROVIDER_ATTEMPTS` | 6 | Total HTTP provider attempts in one logical call, across retries and fallbacks |
| `AI_SERVICE_LLM_MAX_OUTPUT_TOKENS` | 4096 | Output-token limit sent with every provider request |
| `AI_SERVICE_LLM_MAX_INPUT_CHARS` | 64000 | Combined message-content character ceiling, checked before debit |
| `AI_SERVICE_LLM_CACHE_TTL_SECONDS` | 86400 | Private cache lifetime (maximum seven days) |
| `AI_SERVICE_LLM_CACHE_MAX_CONTENT_CHARS` | 32000 | Maximum generated response size stored |
| `AI_SERVICE_LLM_CACHE_MAX_ENTRIES_PER_USER` | 100 | Maximum private cache rows per owner |

These are configurable application limits, not claims about provider free quotas.
Tune them against measured demand and account-specific free capacity before rollout.
They replace the old, unenforced per-feature daily table in this document.

The Postgres conditional UPDATE both checks the cap and increments under the row
lock. A request from the previous UTC day cannot roll back a newer counter. Upstash
uses one atomic Lua command for the minute check. Its keys hash the owner ID. Only
explicit `AI_SERVICE_JOB_STORE=memory` uses process-local test/development counters.
Other modes require Upstash credentials at startup and use durable daily counters.
Quota-store failures return 503 and permit no provider call.

## Charging and failure semantics

- One `router.complete` call consumes one daily unit before attempting a provider.
  Internal retries and fallback providers share that debit and the total attempt cap.
- Attempted provider failures/timeouts are not refunded. Their remote outcome may
  be uncertain; this conservative policy prevents free repeated failure attempts.
  A new request key can debit again. Reuse of the same request key/job ID and
  identical child-call inputs replays the committed result without another debit.
- A schema-validation re-ask is another logical call. Generating cards for several
  chapters consumes one call per generated chapter, rather than one per document.
- No configured provider, all circuits open, invalid oversized input, saved-artifact
  reads and scoped response-cache hits consume no daily unit. Phase 8 8.A01 stores
  bounded generated responses privately in Postgres (or explicit memory dev mode),
  with SHA-256 prompt/model/schema/language/source-revision scope, TTL, owner/document
  keys and deletion cascades. Responses enter cache only after feature validation;
  malformed JSON/schema output is discarded and can be retried fresh. A cache
  outage becomes a miss/write skip; provider calls still pass through admission.
- Minute allowance is checked before the daily debit. A daily denial can consume a
  minute-window slot, but cannot increment the exhausted daily counter.
- Denials return shared-shape HTTP 429 with `Retry-After` seconds and a
  `minute_limit` or `daily_quota` reason. CORS exposes the header. Summary generation
  checks admission before committing SSE headers, so this remains a real HTTP 429.
- Quota-denied jobs remain pending until the retry time without using a provider
  failure attempt. Flashcard jobs checkpoint completed chapter drafts before a
  pause; the old deck is kept until all chapters have generated. Worker crash
  leases and atomic, history-preserving final deck merge remain A05/A08 work.

## Providers and deployment

Provider order, models, timeout, retries and circuit settings come from typed
configuration. The approved chain uses Logfare then Groq
(`AI_SERVICE_LLM_PROVIDER_ORDER=logfare,groq`). When the configured chain is
exhausted, the service returns a clear provider failure.
Hugging Face is an optional compatibility slot and remains inactive in this
chain. Standard free Hugging Face accounts have no included Inference Providers
credits as of 2026-11-20.
[Hugging Face pricing](https://huggingface.co/docs/inference-providers/pricing)

Do not rely on historical provider limits. Confirm current account/model limits
and billing controls using the provider console and primary documentation before
adding credentials. No paid fallback is authorized. Deployment instructions and
required environment keys are in [deployment-7.8.md](deployment-7.8.md).

The compatibility web route accepts `{document_id, question}` and proxies the
implemented `/api/documents/{id}/chat` operation. The previously referenced generic
FastAPI `/api/chat` route does not exist.

## Remaining budget and durability work

Phase 8.A03 adds owner-scoped Postgres operation reservations. An optional UUID
`Idempotency-Key` is propagated by the web proxy; browser calls supply one and
callers can retain it for transport retries. Background calls use the durable job
ID. Child-call hashes distinguish chapter work and validation re-asks. Completed
results replay; unused reservations release; a provider timeout or expired active
lease stays uncertain and cannot silently reissue a remote request. A new key is
an explicit new attempt. Export/deletion includes reservations and private results.
No provider outcome is claimed to be exactly once. A04 adds configurable
per-user, per-feature and global UTC-day token ceilings plus user/global active
generation slots. Before a provider call, the router reserves a conservative
upper bound based on UTF-8 input bytes and configured output limits across all
remaining attempts. Cache hits do not reserve budget. Confirmed usage settles
the hold; an unknown attempt conservatively settles to its reserved amount, and
an expired reservation frees only its slot while keeping its token charge.
Defaults and limits are in `apps/ai-service/.env.example`. Embedding/speech
admission and worker lease recovery remain later Phase 8 work.

Local regressions cover concurrent memory reservations, UTC boundaries, mocked
Postgres/Upstash/cache behavior, direct/streamed/proxied HTTP admission and scoped
cache reuse, worker owner propagation, retry/fallback debit sharing and account/source
deletion. The optional isolated-table Postgres race/cache tests require
`STUDYVAULT_TEST_DATABASE_URL`; live Postgres, Upstash and real Clerk-token acceptance
remain staging gates.
