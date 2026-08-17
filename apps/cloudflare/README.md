# @murphai/cloudflare-runner

Cloudflare-hosted execution plane for the hosted Murph path.

`apps/web` is the canonical owner of onboarding, billing, auth, device-sync authority, usage reconciliation, and other hosted product facts. `apps/cloudflare` is the execution-only edge/runtime layer that accepts authenticated execution/control requests, restores encrypted runtime state, invokes workspace-runtime work, and writes the next encrypted workspace checkpoint through hosted-runtime callbacks.

## What This App Owns

- ensure-processing requests (callback-signed from the Temporal orchestrator or
  Vercel OIDC-authenticated direct Linq and Assistant Ask latency wakes from `apps/web`) plus Vercel
  OIDC-authenticated browser/session/status/deletion control requests from
  `apps/web`
- per-user execution coordination in `USER_RUNNER`
- native runner-container lifecycle in `RUNNER_CONTAINER`
- encrypted hosted workspace snapshots, legacy encrypted artifact blobs, encrypted runner-secrets blobs, and the execution-sidecar blobs needed to run hosted jobs in `BUNDLES`

## What It Does Not Own

- browser or webhook control-plane flows for onboarding, billing, auth, or member lifecycle
- canonical hosted product facts or ledgers outside the encrypted execution workspace, including hosted usage and lifecycle state in `apps/web`
- gateway state or other product truth outside the encrypted workspace snapshot

## Route Surface

Public routes:

- `GET /`
- `GET /health`

Internal control routes:

- `POST /internal/users/:userId/runtime/ensure-processing` is the idempotent
  processing adapter; it accepts either the Temporal orchestrator's callback
  signature or web's Vercel OIDC credential for the direct-wake latency
  hint (dispatched by presented credential, never falling through a failed
  one), records which trigger won as the `triggeredByWebDirect` orchestration
  latency leaf, and starts, wakes, or accepts a pending runtime wake for only
  the bound user's runtime. Both credentials receive the real accepted-or-retry
  result after start/wake intent is accepted, not after the runtime reaches
  idle; the direct path does not hide that result behind Worker `waitUntil()`
- `POST /internal/users/:userId/runtime/shell-prewarm` is the optional
  Vercel OIDC-authenticated typing/instant-start shell hint. Its bounded source
  distinguishes those two existing callers; an empty legacy request remains
  accepted as `unknown`. It rechecks live admission and returns after the named
  container registers an asynchronous start attempt; it does not wait for
  readiness or create runtime authority.
- `POST /internal/users/:userId/browser-vault/session` creates an encrypted browser-vault read session for the latest web-owned replica ref
- `GET /internal/users/:userId/status`
- `POST /internal/deploy/container-smoke` is a signed deploy-verification callback, not a product control API

The supported worker HTTP surface stops at those narrow control routes, the deploy smoke callback, and the public banner and health checks.
Hosted assistant delivery recovery comes from the encrypted local runtime outbox state inside the workspace checkpoint plus web-owned hosted-runtime logs/status.
The runner container sends runtime internal Worker requests to normal virtual hosts such as `results.worker` and `web-control.worker`. Cloudflare Container outbound interception routes those requests back into Worker-owned handlers, using the runtime write-fence headers as authority.
The phone-call start port is one bounded `web-control.worker` callback into `apps/web`; its protocol floor is 45 seconds even when the generic web-control timeout is 30 seconds, so the web-owned 40-second aggregate deadline finishes before the caller gives up. Deploy and prove convergence of this 45-second Cloudflare caller before deploying a web build with the 40-second deadline. The longer caller is backward compatible with older web builds; an old 30-second caller is not compatible with the 40-second web deadline, so Cloudflare cannot be rolled back below 45 seconds while that web build is active. Retell credentials and provider calls remain web-owned and are never forwarded into the runner.
`murph.plan_usage` uses one allowlisted signed `web-control.worker` callback.
Cloudflare transports and validates the strict result but owns no billing or
usage truth and has no billing mutation authority. The current runner opts into
`subscriptionActionQuote`, which is current terms for an explicit member
request rather than a recommendation or consent. The usage-thresholded
`recommendedAction` remains separate and may carry the exact first-party
`add_usage` Settings handoff.
`murph.labs` uses one allowlisted signed `web-control.worker` callback for live
read-only `search`, `show`, and ZIP `locations` requests. Cloudflare transports
and validates the strict normalized result but owns no Junction credential,
catalog, query history, ZIP persistence, provider interpretation, or commerce
authority. The capability is optional and is registered only in verified
private direct turns.
`murph.subscription` uses the same write-fenced, allowlisted callback boundary
for one input-bound subscription action. Cloudflare validates and transports the
strict result but owns no plan facts, action claim, payment URL, or billing
mutation logic. Web durably claims the first action on the accepted input's
existing mailbox row.
The established optional quote remains compatible with older runners that send
the empty request. The `add_usage` recommendation is a new strict union member:
deploy the Cloudflare parser that accepts it before Web can emit it. Roll back
the Web producer before rolling Cloudflare below that consumer version.
The usage-record callback may also transport one bounded Linq group delivery
target captured from the accepted mailbox input. The target includes the
existing thread-route authority and is advisory to web-owned accounting; the
Worker does not resolve, persist, or authorize an alternate recipient.
The runner container also uses Cloudflare HTTPS outbound interception for hosted provider egress. OpenAI, Exa, Mapbox, Linq, Telegram, hosted data API, and Workers AI transcription real credentials stay in Worker env. Native child-process integrations for OpenAI, Exa, Mapbox, `murph_data_api`, and `workers_ai_transcribe` receive a runner-scoped signed Murph provider credential in the provider's native credential slot; the Worker verifies that credential as `provider + user + runner`, asks UserRunner whether the same runner currently has an active runtime for that user/provider, then injects the real Worker-owned credential only into the upstream request. Runtime-controlled provider calls may instead carry exact write-fence headers or a provider-egress token; there is no tokenless active-user-fence provider authorization path. Delivery providers (Linq and Telegram) and ElevenLabs continue to require exact write-fence headers or a provider-egress token, because those effects must stay behind recipient binding, journaling, and idempotency. The Worker constrains Codex-native managed OpenAI search to exact `POST /v1/alpha/search`, constrains Exa to `POST /search`, constrains Linq to the runtime route matrix (`GET /phone_numbers`, `GET /attachments/:id`, `POST /attachments`, `POST /chats`, `POST /chats/:id/messages`, `POST /chats/:id/voicememo`, `POST /chats/:id/typing`, `DELETE /chats/:id/typing`, `POST /chats/:id/read`, `POST /messages/:id/reactions`, `DELETE /messages/:id`), constrains Telegram to its explicit operation allowlist, including `sendRichMessage`, constrains Mapbox to read-only GET allowlisted path families, and strips runtime authority headers before upstream provider egress leaves Cloudflare. Runtime code does not call Linq's contact-card provider endpoint directly; first-contact native contact-card sharing stays web-owned. Hosted generated-image turns call OpenAI through the runner-scoped provider credential path, persist the validated bytes as a canonical vault capture, and return private `vault_image` media. Final message delivery reloads and hash-verifies those bytes, then uses Linq's attachment upload or Telegram multipart `sendPhoto`. Linq group-avatar mutation is the narrow URL-only exception: after preflight, the write-fenced Worker route stores one deterministic application-encrypted R2 object and returns an opaque at-most-one-day capability on Murph's fixed Worker origin directly to the runtime provider boundary. The capability reveals no member id, R2 key, storage namespace, or image hash; the public Worker route decrypts and verifies the object and returns `private, no-store`. Retries reuse the deterministic object only while its original 24-hour lifecycle window remains, and each capability expiry is capped at that object's lifecycle boundary. At or after the boundary, the mutation-locked `UserRunner` replaces the same deterministic key before returning a newly bounded capability; the R2 lifecycle and account deletion still own cleanup without relying on Linq fetch acceptance. The URL is not response media or model-visible state. The legacy write-fenced `results.worker/generated-images` route returns `410 Gone` so older warm runners fall back to text instead of creating public objects. Runner container names identify the runner for server-side validation; `ctx.containerId` is not provider-egress authorization. Unknown egress currently passes through during migration and logs only sanitized method/host/path metadata. Adding a new hosted provider API, method, or runtime tool that calls an intercepted provider is not complete until this egress boundary and its regression tests allow the exact upstream operation. Updating the Codex pin additionally requires a source-manifest review: required CI resolves `rust-v<version>` from OpenAI, verifies its exact commit and `codex-rs/codex-api/src` tree, and then uses native binary scanning only as cross-platform corroboration. The test-only inventory cannot generate or widen the Worker policy.
Venice joins that same Worker-owned credential boundary for core inference.
The Worker permits only `POST /api/v1/responses` and
`POST /api/v1/responses/compact`, accepts only canonical Luna/Terra/Sol request
models, and replaces the model with the matching regular Venice provider id
(`openai-gpt-56-luna`, `openai-gpt-56-terra`, or `openai-gpt-56-sol`) while disabling
Venice's added system prompt, web search, and web scraping at the final egress
boundary. Runtime egress derives the provider id from the same shared map that
Web records in its pricing snapshot, so the allowance rate remains bound to
the actual upstream model. Codex Responses Lite `/responses` requests also have
their standard top-level tools restored and receive an explicit GPT-5.6 prompt
cache breakpoint on the final block of the contiguous leading developer prefix.
The Worker preserves the stable cache key and caller-owned cache controls, does
not modify compact or ordinary Responses cache behavior, and never logs prompt
content or cache keys. Specialized
tools such as generated images continue to use their own managed providers even
when Venice owns the core assistant turn.
The container supervisor sets `CODEX_CA_CERTIFICATE`, `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, and `CURL_CA_BUNDLE` to Cloudflare's runtime interception CA path, and direct invocation builds the runtime config from an explicit frozen supervisor env, preserves those CA bundle pointers plus Cloudflare-managed proxy env needed by hosted-local Containers egress interception, and still blocks operator-only process-control env plus user-supplied proxy overrides.

Root `pnpm dev` starts the same local Cloudflare container path and uses the image-owned `codex app-server` runtime with direct OpenAI configuration routed through the Worker intercept. There is no host Codex bridge for normal hosted-local execution: `MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN` and `MURPH_DEV_CODEX_APP_SERVER_PROXY_URL` are rejected by the Cloudflare runner env policy. Generated local env files are treated as secret material and must provide `HOSTED_ASSISTANT_PROVIDER=openai` plus the Worker-owned `OPENAI_API_KEY` secret; the raw key is not copied into direct runtime env.

## Storage Contract

- The live v2 workspace snapshot is one encrypted zstd-compressed tar object under `users/<namespace>/workspace-snapshots/<snapshotId>.snapshot.enc`. The container uploads that object directly to the canonical ENAM R2 bucket through a short-lived presigned `PUT` URL minted by the Worker, and restores through a presigned `GET`; Worker routes carry JSON session/presign/complete metadata only and never receive the snapshot body. This v2 format is a greenfield zstd hard cut: gzip v2 refs are not produced or restored.
- V2 snapshot creation validates the planned durable-root entries, then streams `tar -> zstd -> AES-GCM` into the encrypted object. Restore treats v2 snapshots as first-party authenticated artifacts: it verifies the encrypted object size/hash, AES-GCM tag, and plaintext compressed archive hash, extracts once into a temporary root, then swaps that root into place. Restore does not re-list tar members; a valid encrypted snapshot is trusted as output from the snapshot writer.
- Legacy full/base bundle refs and legacy artifact sidecars remain restoreable during migration, but v2 snapshot production does not externalize raw files into artifact blobs.
- Separate encrypted objects hold runner-specific secret overrides and other execution-only sidecar blobs so those runtime artifacts do not force workspace rewrites.
- Durable Object SQLite stores execution coordination only: lease and stale-result fencing, alarm hints, timestamps, and short-lived direct-R2 upload sessions without persisted presigned URLs. Canonical mailbox ordering, workspace checkpoint refs, redacted status/logs, and mailbox lag stay web-owned; snapshot refs come from hosted-runtime workspace control responses and may be kept only as an in-memory warm cache.
- A valid workspace-CAS snapshot is not discarded because web observes newer conversation input. Current web commits the request snapshot, redacted watermarks, and wake projection as one prefix and may return `conversationInputAhead`; a live default-mode runtime imports through the existing foreground path, while retention-only work or shutdown leaves the durable mailbox row for reconciliation. The runner performs no post-upload wake discard and no metadata-only shutdown resnapshot. If shutdown follows a real import that staged assistant input, its ordinary dirty checkpoint carries a due assistant wake so restore can run it. Handling for an old web deployment's `foreground_pending` checkpoint response remains compatibility-only.
- Hosted raw email payloads now live under the encrypted, root-independent `hosted-email/messages/{storageNamespaceId}/` prefix. Raw blobs and their encrypted recovery refs carry an R2 lifecycle backstop under `hosted-email/messages/` that makes them deletion-eligible after 24 hours, while account-deletion cleanup removes the same user prefix directly. Normal worker deploys reapply that checked-in lifecycle rule before `wrangler deploy`. Removed pre-launch root-derived raw-email paths are unsupported under the greenfield hard cut; the same lifecycle prefix bounds any transient leftovers.
- Account deletion removes user-scoped R2 objects from the canonical ENAM bucket, then destroys the warm container before deleting Durable Object state. It proves the bucket stably empty, clears the alarm, and calls Durable Object storage `deleteAll()` after the SQL owner check; already-absent SQL state is idempotent success, while missing `deleteAll` support or any R2/container/state failure remains incomplete so web's durable cleanup receipt retries it. The response carries explicit `deleteAllCompleted` evidence; web must treat a legacy response without that field as pending. Deploy this Worker before the receipt-producing web release and do not roll Cloudflare below this capability while those receipts can run.
- Other encrypted execution blobs remain owner-cleaned or durable by design, including workspace snapshots, legacy artifact blobs, and runner-secrets blobs. Hosted device-sync runtime authority stays in `apps/web` behind narrow signed callbacks.
- Hosted R2 uses one canonical production bucket in ENAM and one isolated preview bucket for all runtime reads, writes, presigns, lifecycle rules, restores, and account deletion. Deploy preflight requires both buckets to be ENAM Standard. The retired OC region has no Worker binding or runtime role.
- Runtime domain-root material comes from a signed web callback as ingress/runtime
  envelopes only. Cloudflare verifies the GCP KMS authority signature and unwraps
  only its configured P-256 automation recipient; it does not receive GCP KMS
  decrypt credentials.

## Worker Contract

Bindings:

- `USER_RUNNER`
- `DATABASE_HEALTH_MONITOR`, one environment-scoped SQLite Durable Object for
  production database metric history and alert admission
- `DEVICE_WEBHOOK_QUEUE`, encrypted non-canonical burst transport with one
  serial consumer and an encrypted dead-letter queue
- `DEVICE_WEBHOOK_DLQ`, producer binding used only for encrypted dead-letter
  Queue metrics
- `DEVICE_WEBHOOK_QUEUE_MONITOR`, one environment-scoped SQLite Durable Object
  for five-minute Queue-health observations and restart-safe operator paging
- `RUNNER_CONTAINER`
- `BUNDLES`
- `CF_VERSION_METADATA` version metadata binding, used by deploy smoke to prove the requested Worker version actually handled the request
- optional `HOSTED_EMAIL` native `send_email` binding for outbound hosted email

Required worker secrets:

- `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK`
- `HOSTED_DATABASE_ALERT_LINQ_CHAT_ID`
- `HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID`
- `HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN`
- `HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID`
- `HOSTED_LOG_FINGERPRINT_SECRET`
- `HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET`
- `HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET`
- `HOSTED_R2_PRESIGN_ACCESS_KEY_ID`
- `HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY`
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`
- `LINQ_API_TOKEN`
- `MURPH_DATA_API_KEY`
- `OPENAI_API_KEY`

`MURPH_DATA_API_KEY` authorizes the Worker-to-web hop for the internal
`http://murph-data-api.worker/api/foods` and `/api/supplements` runtime
endpoints. The key stays Worker-owned and is never forwarded into hosted runtime
env. Hosted web must have `MURPH_LABELS_DB_URL` before serving either
`/api/foods` or `/api/supplements`; `MURPH_SUPPLEMENT_DB_URL` is not a runtime
fallback.

Required worker vars:

- `HOSTED_DATABASE_ALERT_ENABLED=1` in production only
- `HOSTED_WEB_BASE_URL`
- `HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG`
- `HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME`
- `HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION`
- `HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM`
- `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID`
- `HOSTED_CRYPTO_ENV`
- `HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID`
- `HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_NAME`
- `HOSTED_DATABASE_ALERT_PLANETSCALE_DATABASE_NAME`
- `HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION`
- `HOSTED_R2_PRESIGN_ACCOUNT_ID`
- `HOSTED_R2_PRESIGN_BUCKET_NAME`

Optional hosted crypto compatibility inputs:

- GitHub Environment variable
  `HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON`
- GitHub Environment secret
  `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON`

These inputs add non-active verification/decryption material; the required
single-key variables remain the active generation. Follow the reader-first
standby preload and future activation boundary in `DEPLOY.md`.

`HOSTED_WEB_BASE_URL` must be an origin-only hosted web URL. Do not configure a
subpath such as `https://example.test/app`; the worker appends its own internal
callback routes to that origin.
Production deploy preflight also requires `HOSTED_WEB_PRODUCTION_BASE_URL` and
rejects a production Worker when `HOSTED_WEB_BASE_URL` does not match that
production origin or when callback origins use HTTP, localhost, Docker bridge,
loopback, preview/development, or private-network hosts. The GitHub workflow
runs that preflight before artifact preparation; the local `deploy:worker`
path also runs it inside the apply step before artifact validation and upload.

### Production database-health monitor

The Worker cron `*/5 * * * *` calls the singleton
`DatabaseHealthDurableObject`. It uses PlanetScale's documented
[HTTP service discovery](https://planetscale.com/docs/postgres/monitoring/prometheus-postgres)
and [Postgres metric names](https://planetscale.com/docs/postgres/monitoring/prometheus-metrics-postgres)
to retain 30 days of:

- PgBouncer oldest-client wait and waiting-client count;
- the most saturated primary pod's current PgBouncer-to-Postgres connections
  against `max_connections`, plus server-pool state counts;
- primary Postgres connection states and total utilization; and
- per-region connection-error counters and positive deltas for direct port 5432
  and pooled application port 6432.

Discovery selects exactly one target by organization, database name, and branch
name. The configured branch ID then filters the selected Prometheus payload's
metric series. Both selectors are required because one organization can have
several production branches with the same branch name while discovery does not
publish branch IDs.

Port 5432 retains the direct migration-admission interpretation because
production application traffic is required to use transaction-mode PgBouncer
on 6432 and the direct endpoint is migration-only. Port 6432 is reported as the
broader pooled application connection-error condition. The provider metric has
no reason label, so the page cannot identify a specific pooled rejection cause.

Each metric family is normalized independently. When a documented family is
absent, the sample keeps that family unknown instead of substituting zero, still
evaluates every available signal, and records the canonical missing metric names
without retaining labels or raw scrape data. Unsafe available signals therefore
still open an incident immediately. A collection that fails before producing a
usable observation, including a scrape with every required family absent,
receives one bounded retry after one second; only an exhausted two-attempt
collection counts as a failed check. A usable partial observation ordinarily
remains single-pass so available unsafe evidence pages without delay. The
monitor retains every successfully parsed observation even when it contains no
usable required family and its retry fails before parsing; `unavailable` is
reserved for checks that produced no parsed observation. The
connection-error family tracks both supported ports, keyed by port and region
so their series cannot collide. Any observed supported port makes the family
available. An absent port is diagnostic sparse label cardinality, not a
collection failure. When a safe observation has the whole family absent, the
monitor makes one confirmation scrape after one second. PlanetScale's
[documented example Prometheus scrape configuration](https://planetscale.com/docs/postgres/monitoring/prometheus-postgres)
uses 30 seconds, but that is not a provider freshness guarantee and does not
justify another provider call. The monitor evaluates every available
confirmation signal
and composes any recovered supported port with the original complete gauge
evidence, so a port first seen there advances its baseline. Each observed port
advances only its own usable baseline;
an omitted port retains its prior baseline, and new or reset region series are
suppressed independently. A failed confirmation retains the original
incomplete observation, so absence never becomes zero and an old counter delta
is never replayed. Two checks with the whole family absent still open the
fallback monitoring incident. This keeps the existing maximum of two
observations and four provider requests; even two sequential ten-second fetch
timeouts per observation plus the one-second wait remain below the two-minute
run lease.
Structured failure warnings retain the parsed-observation count and exact
per-port omission counts without raw scrape content. An acknowledged
telemetry-only page is
one-shot for one unresolved operator-notification window.
Crossing the two-failure threshold records one bounded alert obligation in the
existing incident row. The first two-check window counts incomplete versus
unavailable observations, unions only canonical missing families, and sums
parsed observations plus exact 5432/6432 omission counts from checks where the
whole family was absent.
It identifies the threshold time as the window end. A bounded per-sample evidence value preserves
that provenance across restart. Structured warnings can retain a sparse-port
omission during another collection failure, but durable evidence clears that
diagnostic count unless the canonical connection-error family is missing. This
preserves the legacy reader correlation invariant across rollback. Legacy
evidence, including a single-port monitoring obligation, remains readable. Any
window containing legacy evidence reports unavailable port detail
rather than presenting a partial ratio as exact. An older
pending page or connection-error priority cannot lose the obligation; recovery
and another gap before acknowledgment coalesce into that same notification
while the first threshold window remains authoritative. The obligation does
not occupy a closed provider fence.
At the same time, until an incident admits its first page, concrete evidence
that appears on the threshold or a later sample, including either
connection-error category, persists in one combined immutable body. The exact
pressure and truthful telemetry facts therefore share the next eligible attempt
and one acknowledgment cycle. For acknowledged-incident recurrence, the next
eligible sample supplies any still-current unsafe evidence while historical
telemetry keeps its own observation time. Only acknowledgment of a
telemetry-bearing page clears the obligation; a later complete sample then
closes and rearms the incident. After acknowledgment, incomplete samples remain
queryable but cannot repeat telemetry copy inside concrete-pressure pages
unless a later rearmed threshold creates a new obligation. When a
connection-error condition takes admission priority after an earlier page, any
currently owed telemetry travels in that same immutable body while replayable
gauges remain excluded; pure deferred evidence keeps the latest stored check
time among its included categories, an aggregate containing a new current delta
uses the current check, and telemetry keeps its own condition-local observation
time. Concrete unsafe conditions retain an hourly recurrence. The object writes
Linq provider-attempt admission before egress, never attempts more than once per
hour across all incidents, and reuses the
exact body plus idempotency key after an ambiguous send. Concrete-pressure
bodies select deterministically by persisted incident and alert identity from
one hundred reviewed, observation-scoped openings. Those openings say only
that the recorded check met alert criteria; condition-specific and current-
state claims come from evidence that proves them. Retries therefore keep a
truthful body after recovery, while consecutive pages avoid broadcast-shaped
repetition without padding or filler. Telemetry-only pages remain evidence-led
and one-shot for each unresolved monitoring
window. The one-hundred-entry size is a bounded operator deliverability
requirement, not a guarantee about carrier or platform filtering: at the hourly
cap, one incident traverses one hundred reviewed leads before repeating one.
The bank stays literal reviewed data rather than generated prose or another
runtime dependency. The alert-state and sample-evidence columns are added
idempotently without advancing the schema version, so the previously deployed
Worker can ignore them during a rollback. The physical sample columns retain
their legacy `direct_connection_error_*` names, while current code stores the
generalized two-port baseline and aggregate delta in them. Category-specific
pooled-defer state uses additive columns. If the prior Worker acknowledges a
telemetry pending body, current code recognizes its cleared key/body plus
retained marker and prevents duplicate re-admission after re-upgrade. The
message reports actual collection time rather than the scheduled Cron slot and
describes partial or unavailable telemetry without claiming database pressure.
Before each message POST it requires the configured direct
[Linq chat health](https://docs.linqapp.com/guides/chats/chat-health/) and its
current [line reputation](https://docs.linqapp.com/guides/phone-numbers/phone-reputation/)
to be `HEALTHY`. It derives that chat's sole external phone recipient in memory,
never persists or logs it, and requires the two resolved recipients to differ
before the secondary operation can enter Linq. If primary identity cannot be
resolved, neither operation posts; if only the secondary is unavailable, the
healthy primary can still post. If the primary identity is known but its chat
or line health is unsafe or indeterminate, a healthy distinct secondary can
still post. A duplicate resolved recipient allows the primary operation only
and leaves the alert pending. Distinct healthy recipients are sent through
Linq's no-`from` auto-selection endpoint so a newly flagged line can fail over.
Unhealthy or indeterminate delivery health suppresses that destination's POST
and leaves the alert pending for the next paced attempt. This path does not
share state or fallback behavior with the Resend-only hosted reply-latency
monitor.

Defaulted worker vars:

- `HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS=3`
- `HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS=180000` for the runtime-owned idle
  window before a dirty invocation checkpoints and returns; production rejects
  lower values so routine checkpoints cannot bypass the three-minute quiet floor
- `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS=1200000` for the post-completion
  conversation warm lease (code default is `300000` when unset)
- `HOSTED_EXECUTION_RETRY_DELAY_MS=30000`
- `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS=45000` (must exceed the web-control timeout by at least 5 seconds)
- `HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS=30000`
- `HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=production`

After the additive runner-retention deploy has completed its observation and
container-drain window, set optional
`HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS=60000` to reconsider
maintenance-only idle shells every minute. When unset it falls back to the
conversation lease for safe rollback.

`HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS` bounds consecutive failed hosted runner
invocations for a Durable Object. Temporal decides when durable work is due by
reading web-owned reconciliation facts; Cloudflare does not reread web
mailbox/workspace status as a scheduler. Cloudflare alarms are limited to
workspace snapshot orphan cleanup; runtime completion and replacement
invocations clear their own stale execution-failure state without alarm
resync.

Optional execution vars and secrets:

- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID` for callback key rotation metadata on the required signed hosted-web path
- `HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS` and `HOSTED_EXECUTION_RUNNER_ENV_PROFILES` for execution-time secret forwarding
- `HOSTED_ASSISTANT_PROVIDER=openai` for Codex hosted assistant execution through the Worker egress intercept. The standard deploy preflight requires Worker-owned `OPENAI_API_KEY` plus `HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET`; hosted Codex receives only a signed Murph provider credential, never the real OpenAI key. Host Codex bridge/proxy env is not accepted
- Optional Venice core inference uses the Worker-owned `VENICE_API_KEY` secret.
  The regular provider ids `openai-gpt-56-luna`, `openai-gpt-56-terra`, and
  `openai-gpt-56-sol` are code-owned and derived from Murph's canonical model;
  there are no separate operator model vars. The fleet default remains
  `HOSTED_ASSISTANT_PROVIDER=openai`; Web projects the per-member
  Venice override for an invocation only after its separate rollout flag is
  enabled. The runner receives only a signed Venice credential.
- `HOSTED_R2_PRESIGN_ENDPOINT` can override the default account-scoped R2 S3 endpoint for direct snapshot URL generation. Production deploys must leave it as the account-scoped R2 HTTPS origin. Hosted-local dev, worker-only, and E2E profiles start a MinIO sidecar and inject local S3-compatible endpoints behind the local-only `HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT=1` guard; those local endpoint flags are not deploy vars.
- `HOSTED_AI_USAGE_REPORTING_SECRET` is an optional Worker-owned platform
  secret. It must not be forwarded into the hosted runtime env; usage
  attribution is added at the Worker/web-control boundary when configured.
- `HOSTED_EMAIL_DOMAIN`, `HOSTED_EMAIL_LOCAL_PART`, optional `HOSTED_EMAIL_FROM_ADDRESS`, `HOSTED_EMAIL_DEFAULT_SUBJECT`, and `HOSTED_EMAIL_SIGNING_SECRET` for hosted email routing
- opt-in runtime integrations such as `EXA_API_KEY`, `LINQ_*`, `TELEGRAM_*`, and `MAPBOX_ACCESS_TOKEN`; provider credentials for intercepted integrations stay Worker-owned and are represented in the hosted runtime by sentinel placeholders, while native parser binaries are image-owned by the runner container and rebound from the image instead of being serialized through Worker runtime envelopes; hosted audio transcription has no in-image model and runs through the Worker-owned `AI` binding behind the fixed `murph-transcribe.worker` egress host

When hosted email sender identity is configured, deploy automation renders an environment-specific native `HOSTED_EMAIL` send binding and constrains it with `allowed_sender_addresses` so outbound sender selection remains config-owned.

The runtime always includes the minimal `assistant` env profile. Deploy automation layers `exa`, `hosted-email`, `linq`, `mapbox`, and `telegram` on top by default. Cloudflare owns the configured profile string, runner-secret allowlisting, native parser toolchain binding inside the container image, and container transport rewrites such as local loopback host adaptation. The profile key sets and canonical hosted runtime launch spec are built by `@murphai/assistant-runtime`, so local and Cloudflare execution pass the same semantic runtime manifest shape. Hosted device-sync runtime config is derived into `runtime.resolvedConfig`, so it stays outside the runtime-env profile surface.

Cloudflare keeps only the wake-payload decryption lane plus the worker-owned callback-signing key. Broad web-private-field encryption stays in `apps/web`, and the hosted runtime reaches the web control plane through the worker proxy instead of holding callback-signing material directly.

## Private Operational Telemetry

The `HOSTED_RUNTIME_RETRY_ANALYTICS` Analytics Engine binding records one
identifier-free data point only after UserRunner has decided to return
`retry_later`. `index1` and `blob2` are the bounded retry reason, `blob1` is the
schema `murph.hosted-runtime-retry.v1`, `double1` is the event count, and
`double2` is the selected retry delay in milliseconds. The write is immediate,
unawaited, best-effort, and absent from successful processing. Run
[`scripts/runtime-retry-reasons.sql`](./scripts/runtime-retry-reasons.sql)
through the private Cloudflare Analytics Engine SQL API or dashboard to get a
sampling-corrected 24-hour reason breakdown.
The corresponding Workers structured log includes the bounded retry reason and
`orchestrationAttemptId` for request-level joins. That identifier is never
copied into Analytics Engine blobs, indexes, or doubles.

For the primary production control database, run the identifier-free cold-start
report through the read-only helper:

```sh
murph-prod-psql-ro -f apps/cloudflare/scripts/cold-start-latency-report.sql
```

Pass `-v window_hours=6` (or another integer) before `-f` to change the UTC
window. The first result groups uniquely matched Web-direct Linq runtime
attempts by the causal typing shell-prewarm observation consumed by their
container readiness call. It shows causal-hint lead time plus
accepted-to-runner, provider, and reply percentiles, all from the same ingress
trace and same reply runtime attempt. Instant-start, unknown-source, ambiguous,
backlog, and reply-handoff rows are omitted rather than inferred. A
`no_observed_prewarm` row is a comparison cohort, not proof that no hint was
sent, because stop, destroy, or Durable Object eviction may clear optional
in-memory diagnostics. `prewarm_start_issued_warm` means the platform start call
completed without a newly observed lifecycle start;
`prewarm_cold_start_observed` means the same container lifecycle did observe a
cold start. Neither means health readiness completed. One observation contains
one terminal operation outcome; later hints may increase only its bounded
coalesced-hint count and never launch another operation before readiness
consumes it.

The remaining report deduplicates causal rows by runtime attempt and keeps direct
cold starts separate from Temporal recovery. A direct sample must be the only
row in its runtime attempt whose Web direct-ensure orchestration id exactly
matches the id attached only after that request acquires the fresh runtime
fence. Active or warm wakes never receive launch identity. Ambiguous races,
mismatches, backlog rows, and missing ids are omitted. Temporal-owned launches
retain an explicit false direct-launch marker even if a later direct wake is
merged into them. Exact direct samples
begin only after the compatible Web and Cloudflare builds are deployed;
historical rows are intentionally not inferred from timestamp proximity. The
first table reports accepted-to-runner-job time only for those causal direct
cold starts. The second reports Temporal-activity-to-runner-job time by exact
recovery versus Temporal-only attempt; current Temporal-owned launches remain
Temporal-only when a direct wake overlaps, while pre-deploy rows with legacy
direct markers are labeled `legacy_unclassified` instead of being guessed.
Current rows without either the launch-owned direct id or the explicit
Temporal-owner marker are omitted: an activity can start before runner
acceptance yet reach the runtime later as an active wake, so timestamp order is
not launch evidence.
The final cohort is resolved before attempt-level deduplication, so mailbox-local
marker differences cannot discard a coherent multi-item invocation. Temporal
activities that begin after runner acceptance are active wakes, not startup
candidates, and are removed before ambiguity is assessed. Conflicting
launch-owner evidence also fails closed. Warm direct
wakes are omitted because they create no new runner job. The final table splits
the same causal direct samples across Durable Object dispatch,
consent locking, the existing health-data admission callback, runner-state
operations, the parallel container-readiness and invocation-preparation
branches, invocation launch, and runner-job acceptance. Per-phase chronology
guards omit unavailable or reversed cross-runtime clock samples. It returns no
member, mailbox, trace, or attempt identifiers.

## Runner Container Lifecycle

The native Cloudflare container is a warm per-user shell. Startup readiness is
allowed up to 15 wall-clock seconds, including lifecycle-lock queue time. Once
readiness-triggered cleanup starts, one absolute five-second cleanup deadline covers both
the pre-destroy state read and destroy settlement, with a distinct one-second
caller guard margin. The command budget begins at runtime-control authorization,
before route parsing, Durable Object dispatch, consent serialization, and
health-data admission. A settled readiness
failure compare-clears its fresh write fence. An
unsettled cleanup result or outer-guard timeout preserves that fence because
the container lifecycle RPC may still be completing; normal startup-grace
convergence, not a second state owner, performs recovery. For shorter commands,
readiness gets the smaller of 15 seconds and remaining budget minus the
one-second guard. Cleanup is not subtracted before readiness; if it cannot fit
after a failure, the guard preserves the fence. Deploy Web's backward-compatible
bounded client first, then this Worker result boundary. Successful workspace
invocations keep the same Durable Object write fence while the runtime waits
through `HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS`. Coalesced foreground input
may preempt that wait. While dirty, the exact assistant wake projected by the
current foreground phase may run once when due before the floor without
publishing a snapshot; inherited or committed wakes and durability barriers
remain checkpoint-first. If state remains dirty, the direct invocation
checkpoints with reason `idle_shutdown` at the floor or during shutdown before
returning success. A restored due wake in a clean workspace runs ordinarily.
Before a direct user-action provider turn, a session absent from the restored
published snapshot receives that same full `idle_shutdown` checkpoint while the
foreground watcher and detached work are quiescent. This includes a session
created earlier in the live invocation by deterministic welcome output; a
session already restored from the published snapshot adds no extra checkpoint.
Foreground conversation staging also aborts runner-owned background maintenance,
including an in-flight provider-cleanup request, without aborting the foreground
invocation itself.
When Cloudflare reports
the container `sleepAfter` lifecycle expiry, the container only yields to an
active foreground operation or tears down the warm shell.
Each invocation runs in-process through `packages/assistant-runtime` with
per-user warm workspace roots and invocation-local cache/temp roots. Runtime
effects use internal virtual hosts and write-fence headers instead of
per-invocation outbound proxy tokens or dynamically installed outbound
handlers. The runner does not run a separate post-request PID sweep over the
native Codex App Server; warm lifecycle is owned by the existing Codex
app-server slot and explicit runner cleanup paths.

Legacy artifact `GET` requests attach a validated read-purpose header and one
UUID correlation id that is stable across replay-safe retries. Runner and Worker
structured logs use only those fields plus bounded timing/status metadata; they
do not log artifact hashes or bodies.

The warm shell is destroyed when an invocation fails, warm health is stale,
deploy smoke finishes, explicit cleanup is called, or Cloudflare reports idle
activity expiry with no active foreground operation.

Foreground progress recovery is write-fenced instead of container-destroy
driven. A write fence is commit authority, not liveness proof; the exact wake,
replacement, ambiguous-wake, and fresh-startup retry contract is documented in
`agent-docs/references/hosted-runtime-protocol.md`. Durable Object activation
migrates legacy persisted active-invocation identity into the current write
fence so dormant objects retain commit authority; it does not restore retired
wake, backoff, or deadline state. Live runner side effects validate the
runtime-kind write fence by attempt, generation, and user identity. Hosted
OpenAI and Venice provider egress paths validate the signed Murph provider
credential's user and runner against UserRunner's current active runtime state.
Workspace version remains a checkpoint/restore freshness guard, not generic
side-effect authority.
Active, unsupported, error, and timeout liveness outcomes preserve the write
fence. Only explicit inactive or mismatch proof, or exact successful
completion, may enter the corresponding identity-safe recovery or clear path.
After an exact successful completion clears the fence, Cloudflare makes at most
one signed, bodyless owner-release callback to web with a timeout capped at two
seconds. A known future mailbox retry continuation skips the callback unless the
result carries the exact positive `immediateRecheckRequested` edge. That
signature-bound query means the invocation newly committed an unserviced
default or retention schedule; it does not carry the schedule itself. Without
the edge, Web signals Temporal only for current runnable mailbox lag and never
turns a persisted due wake into a repeated level-triggered signal. Callback
failure is logged and ignored with no retry or result mutation.

## Deploy Artifacts

`pnpm --dir apps/cloudflare deploy:artifacts` prepares:

- `apps/cloudflare/.deploy/runner-bundle/`
- `apps/cloudflare/.deploy/wrangler.generated.jsonc`
- `apps/cloudflare/.deploy/worker-secrets.json`

`pnpm --dir apps/cloudflare deploy:worker` is the canonical cut because it renders environment-specific deploy config, worker secrets, the hosted email send binding restrictions, and the cached native runner base image before upload; its apply step also runs deploy preflight before direct Wrangler upload.
Deploy smoke pins the 100% Worker version, verifies the response-reported version metadata, and, when enabled by the workflow, runs a signed managed-container smoke that compares the live runner bundle fingerprint with `.deploy/runner-bundle/.murph-runner-bundle-manifest.json`. The same smoke can mint an actual R2 S3 presigned PUT URL, upload a payload larger than 150 MiB from the container, verify the object size through the Worker R2 binding, and delete the smoke object.

See [DEPLOY.md](./DEPLOY.md) for the exact GitHub environment surface, lifecycle rules, and smoke workflow.
