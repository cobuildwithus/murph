# Hosted runtime log database

`apps/web` keeps hosted product and control facts in the primary Prisma
Postgres database. High-volume hosted runtime diagnostics use a separate
Postgres database so optional observability traffic, indexes, and retention do
not compete with mailbox, workspace, billing, or delivery authority.

## Ownership

The existing signed callback remains the only ingestion boundary:

```text
Cloudflare runtime
  -> POST /api/internal/hosted-runtime/log
  -> ECDSA verification + one primary anti-replay nonce insert
  -> accepted-attempt recovery claim, when present
  -> isolated runtime-log Postgres append
```

The callback stays in `apps/web`; Cloudflare receives no database credential and
there is no new service or queue. The anti-replay nonce remains in the primary
control database because `runner.accepted_attempt_failed` recovery shares this
callback. Admission performs one insert keyed by the nonce hash; primary-key
uniqueness rejects a replay, and the callback performs no expiry sweep. A
runtime-log database outage must not prevent a valid recovery claim from being
authenticated and signaled.

The isolated database is the only runtime-log owner. Production fails closed
when its URL is missing. Local development may leave it unconfigured; runtime
log writes and reads then return empty best-effort results without provisioning
another database.

## Data model

The isolated schema is intentionally small:

- `hosted_runtime_log` owns bounded redacted diagnostic rows keyed by a
  namespace-scoped SHA-256 digest of the random hosted member id.
- Transaction-scoped advisory locks are derived from that digest; there is no
  permanent subject or deletion-tombstone table.

The isolated database does not store the raw hosted member id and has no
cross-database foreign key. Attempt ids and other existing redacted operational
correlation fields retain their current contract and limits.

### Provider request diagnostics

`runner.provider_egress_diagnostic` is the bounded provider-request trace for
hosted OpenAI Responses traffic and Venice Responses calls explicitly tagged by
Codex as `request_kind: memory`. Version 3 records request and input byte counts,
allowlisted shape/model kinds, cache-key presence, and keyed prefix fingerprints.
For parsed Responses input, it also extends the existing aligned
`inputNestedMetricKinds`, `inputNestedMetricCounts`, and
`inputNestedMetricBytes` arrays with fixed function-output metrics. Nonzero
action metrics use `function_output.action.command.execution`,
`function_output.action.dynamic.tool.call`,
`function_output.action.mcp.tool.call`, or `function_output.action.other`.
`function_output.repeated` means the output has a `call_id` already seen in the
request. `function_output.equivalent` means a different `call_id` carried the
exact same deterministic JSON serialization earlier. Repeated and equivalent
properties are counted independently when both apply, and zero-valued metrics
are omitted. They do not claim semantic equivalence, and no call id, serialized
output, or comparison key is persisted.
Request bodies above 6 MiB retain the request byte count and `too_large` status
but skip JSON and function-output classification.
Venice memory rows additionally record the canonical Murph model, the allowlisted
upstream Venice model id, response-header latency, HTTP outcome, validated
`CF-RAY`, bounded provider retry count, and whether the provider's reported model
matches the requested route. `providerResponseTtfbMs` measures time through
response headers, not full streamed-generation latency.

Codex `session_id`, `thread_id`, `turn_id`, and `window_id` values are never
stored. When `HOSTED_LOG_FINGERPRINT_SECRET` is configured, the Worker records
only context-separated HMAC-SHA256 fingerprints so repeated `request_kind`
`memory` calls can be grouped within the retention window. Without the secret,
the diagnostic records fingerprint availability only. Provider request and
response bodies, prompts, messages, tool arguments/results, arbitrary response
headers, account balances, credentials, paths, vault content, and direct member
identifiers remain excluded.

The row is observability only and remains failure-isolated from provider egress.
Venice foreground and untagged calls do not create these rows. Container egress
schedules tagged memory rows with Cloudflare `waitUntil` when available and
otherwise starts a best-effort detached callback, which can be lost if the
invocation ends. Diagnostic persistence never delays a provider response or
transport error. Non-OK and transport-error diagnostics use warning retention,
while accepted and request-only diagnostics use debug retention. Venice response
status and response-header latency are recorded only after upstream dispatch;
Murph-local platform-usage denials do not produce Venice response rows, and
transport failures omit response-header latency.

The separate assistant `provider.prompt_size` trace may record
`conversationHistoryPresent`, `conversationHistoryCount`, and
`conversationHistoryBytes`. Those fields describe only the bounded conversation
history flattened into the initial provider prompt; they do not measure
function outputs carried into later mid-turn Responses requests.

The existing `assistant.provider.plan` trace may record `reasoningEffort` only
as `low`, `medium`, `high`, `xhigh`, or `null`. The value is captured after
conversation and turn-scoped automation overrides resolve and is the normalized
value passed to the Codex provider attempt. Raw provider configuration, prompts,
messages, credentials, and paths remain excluded.

### Web-control preflight rejection attribution

Ordinary hosted-runtime callers select branded route descriptors from the same
registry that derives the shared Cloudflare allowlist. If runtime validation
nevertheless detects a descriptor/policy mismatch, it throws the dedicated
`HOSTED_WEB_CONTROL_ROUTE_NOT_ALLOWLISTED` error before issuing a request.
Before throwing, Cloudflare writes the immediate event
`runner.web_control_preflight_rejected` through the existing durable runtime-log
port. That event contains only bounded policy metadata and deliberately omits
the route, query, payload, description, member id, and credentials. Failure to
persist telemetry never replaces the original typed error. When the rejected
call belongs to retained system-mailbox work, the existing
`mailbox.system_processed` retry warning preserves that code in the typed
`error_code` column.

Use a fixed half-open observation window to count all observed preflight
rejections without returning subject keys or raw JSON:

```sql
SELECT
  redacted_json->>'method' AS method,
  redacted_json->>'operation' AS operation,
  redacted_json->>'reason' AS reason,
  redacted_json->>'transport' AS transport,
  COUNT(*) AS event_count,
  COUNT(DISTINCT subject_key) AS distinct_subject_count,
  MIN(at) AS first_at,
  MAX(at) AS last_at
FROM hosted_runtime_log
WHERE at >= :window_start
  AND at < :window_end
  AND event_code = 'runner.web_control_preflight_rejected'
  AND error_code = 'HOSTED_WEB_CONTROL_ROUTE_NOT_ALLOWLISTED'
GROUP BY
  redacted_json->>'method',
  redacted_json->>'operation',
  redacted_json->>'reason',
  redacted_json->>'transport'
ORDER BY method, operation, reason, transport;
```

Use the existing processing outcome to attribute retained system-mailbox
retries:

```sql
SELECT
  redacted_json->>'status' AS status,
  redacted_json->>'wakeKind' AS wake_kind,
  redacted_json->>'routeAction' AS route_action,
  COUNT(*) AS event_count,
  COUNT(DISTINCT subject_key) AS distinct_subject_count,
  MIN(at) AS first_at,
  MAX(at) AS last_at
FROM hosted_runtime_log
WHERE at >= :window_start
  AND at < :window_end
  AND event_code = 'mailbox.system_processed'
  AND error_code = 'HOSTED_WEB_CONTROL_ROUTE_NOT_ALLOWLISTED'
GROUP BY
  redacted_json->>'status',
  redacted_json->>'wakeKind',
  redacted_json->>'routeAction'
ORDER BY status, wake_kind, route_action;
```

Return only those aggregates. Never return `subject_key` values or raw JSON.
The preflight log uses the existing runtime-log transport, and the error remains
on the existing retry path; both changes are observability-only.

### Assistant-notification validation attribution

An existing `mailbox.system_processed` warning with
`error_code = 'ASSISTANT_NOTIFICATION_INVALID_RESPONSE'` may include the
optional `redacted_json.assistantNotificationValidationFailureReason` field.
The field is a closed validation-boundary vocabulary:

- `decision_json_unparseable`: no parseable JSON decision object was present.
- `decision_schema_invalid`: a parsed JSON object failed the notification
  decision schema.
- `runtime_presentation_non_send_decision`: a runtime-owned presentation was
  paired with a decision other than `send_message`.
- `creative_response_media_invalid`: creative-response media was not exactly
  one generated voice memo.

Only those four literal values pass the existing assistant-notification
structured-redaction allowlist. Provider output, response text, prompts,
messages, payloads, route values, identifiers, paths, stacks, and free-form
errors are not copied into this field. The value is pass-local observability:
it is not written into system-mailbox state and does not alter validation,
retryability, attempt counts, wake selection, delivery, or canonical state.

This is a zero-volume-change extension. It adds no event, success-path log,
metric, database write, request, queue, timer, await, or fanout. For a retrying
validation failure, a new runner attaches the field to the already-emitted
warning; older runners and unrelated warnings remain schema-compatible because
the field is optional.

For post-deploy verification, choose one fixed observation end timestamp and
run the query below separately for the latest four-hour window, its immediately
preceding four-hour window, the rolling 24-hour window, and the rolling
seven-day window. Supply fixed `:window_start` and `:window_end` values for each
run so the windows do not move while results are compared. A `NULL` reason is
the unattributed mixed-version bucket:

```sql
SELECT
  redacted_json->>'assistantNotificationValidationFailureReason'
    AS assistant_notification_validation_failure_reason,
  redacted_json->>'status' AS status,
  redacted_json->>'wakeKind' AS wake_kind,
  redacted_json->>'routeAction' AS route_action,
  COUNT(*) AS event_count,
  COUNT(DISTINCT subject_key) AS distinct_subject_count,
  MIN((redacted_json->>'attemptCount')::bigint) AS min_attempt_count,
  MAX((redacted_json->>'attemptCount')::bigint) AS max_attempt_count,
  MIN(at) AS first_at,
  MAX(at) AS last_at
FROM hosted_runtime_log
WHERE at >= :window_start
  AND at < :window_end
  AND event_code = 'mailbox.system_processed'
  AND error_code = 'ASSISTANT_NOTIFICATION_INVALID_RESPONSE'
GROUP BY
  redacted_json->>'assistantNotificationValidationFailureReason',
  redacted_json->>'status',
  redacted_json->>'wakeKind',
  redacted_json->>'routeAction'
ORDER BY
  assistant_notification_validation_failure_reason,
  status,
  wake_kind,
  route_action;
```

Return only those aggregates. Never return `subject_key` values or raw JSON.
If natural traffic produces no recurrence, report zero events; do not generate
production traffic to exercise the telemetry.

## Append and deletion serialization

Every append runs in one short transaction:

1. Take the subject's transaction-scoped advisory lock.
2. Re-read the primary member row.
3. Return `loggedCount: 0` when the member is missing or suspended.
4. Insert the validated batch with one SQL statement.

The encrypted account-deletion cleanup receipt owns the exact runtime-member id
set after primary deletion commits. Its `runtime_logs_completed_at` completion
field is recorded only after the isolated delete succeeds; zero matching rows
is idempotent success. Every immediate or hourly cleanup attempt enters one
runtime-log database transaction:

1. Take every subject advisory lock in deterministic signed-lock-key order.
2. Delete all matching runtime-log rows.
3. Keep the existing cleanup receipt pending when the transaction fails.

This proves both races without a new lifecycle owner. The receipt stores one
nullable `runtime_logs_completed_at` timestamp so a completed isolated cleanup
is never re-gated on a later database outage:

- An append that owns the subject lock first commits before cleanup; cleanup
  then removes that row.
- Cleanup that owns the lock first completes after the primary suspension fence;
  every later or delayed append rechecks that authority and writes zero rows.
- If the isolated database is unavailable after canonical account deletion, the
  receipt retries with bounded backoff until blocking and deletion converge,
  then records the target complete independently of Cloudflare and vendors.

No isolated tombstone remains after account deletion. A warm runner or late
network drain cannot recreate diagnostics because append checks primary member
authority only after acquiring the same isolated advisory lock used by cleanup.

## Wearable import timing

Eligible hosted webhook imports write the buffered info event
`device-sync.import_completed`. Its privacy-limited `redacted_json` separates
the operational stages instead of treating all missing-data time as one delay:

- `eventToProviderSendBucket`: a coarse, non-reversible upstream delay bucket
  computed before persistence (`under_5_minutes`, `5_to_30_minutes`,
  `30_minutes_to_2_hours`, `2_to_24_hours`, or `over_24_hours`)
- `providerSendToWebhookMs`: verified signed webhook-envelope send to Murph
  receipt, when the provider exposes the signed time
- `webhookToImportMs`: Murph receipt to successful canonical import
- `runtimeQueueMs` and `importExecutionMs`: local queue and execution durations
- `provider`: bounded connector/executor context (`junction`, `oura`, `whoop`,
  or `strava`)
- `sourceProvider`: bounded wearable-source context. Junction-backed imports
  retain their normalized source slug, including Garmin, Fitbit, and any other
  supported Junction source; direct integrations fall back to `provider`
- `jobKind`: bounded operational job context

Clock skew does not become a negative latency; only the affected measurement is
omitted. The log deliberately excludes raw stage timestamps, event or resource
types, source-device identifiers, counts, health values, webhook bodies, and
exact event-to-import intervals. Source-provider attribution is a product-wide
provider slug, never a member, account, connection, or physical-device id. The
timing metadata on the dirty-resource carrier holds only the coarse upstream
bucket, exact signed-send-to-receipt duration, earliest Murph receipt needed
for the remaining duration, and a timing-only source slug. The timing source is
separate from the pre-existing `sourceProviderSlug`, which remains part of
resource execution identity and provider input.
Pre-existing ingestion fields still use provider occurrence for dirty-window
and clean-transition wake ownership; those fields are not copied into this
runtime event. Compact timing and job fields
can remain in the existing dirty row; oversized job payloads use the existing
encrypted dirty-payload row. Coalesced hints keep the slowest upstream bucket,
longest signed delivery, and earliest receipt, so timestamps from different
events are never paired into a synthetic duration. Source attribution survives
coalescing only when every hint agrees; a mixed-source job omits
`sourceProvider` instead of choosing one.

The timing association is pass-local and deliberately best-effort. A compact
job that remains queued or retrying beyond its admitting runtime pass can later
succeed without a `device-sync.import_completed` event. Canonical import and
retry behavior remain authoritative; this event is not an exhaustive import
ledger. Like other debug/info logs, it uses the nonblocking runtime-log buffer
and seven-day retention.

Example bounded diagnostic read:

```sql
SELECT
  at,
  redacted_json->>'provider' AS provider,
  redacted_json->>'sourceProvider' AS source_provider,
  redacted_json->>'eventToProviderSendBucket' AS upstream_delay_bucket,
  (redacted_json->>'providerSendToWebhookMs')::bigint AS upstream_delivery_ms,
  (redacted_json->>'webhookToImportMs')::bigint AS murph_import_ms
FROM hosted_runtime_log
WHERE at >= now() - interval '24 hours'
  AND event_code = 'device-sync.import_completed'
ORDER BY at DESC
LIMIT 100;
```

## Reads and retention

Status and latency dashboards read only the isolated store. If a dedicated
status read is unavailable, the Web status response omits its optional
`recentLogs` window. The orchestration projection therefore reports an unknown
log count while workspace and mailbox status remain available.

The dedicated store keeps the existing policy:

- debug/info: 7 days
- warn/error: 14 days
- ordered batches of 5,000, at most four batches per hourly cleanup

The dedicated runtime-maintenance cron runs at minute 50 of each hour. It
performs bounded runtime-signal fan-out before cleaning this isolated database
serially through the diagnostic pool. A diagnostic-database failure is logged
and contained. Callback and browser assertion
nonces belong to a separate primary-database nonce cron at minute 5; its
callback statements retain the 5,000-row statement cap and use a dedicated
400-batch catch-up ceiling.

## Configuration

Runtime traffic:

```text
HOSTED_RUNTIME_LOG_DATABASE_URL
HOSTED_RUNTIME_LOG_DATABASE_POOL_MAX=5
```

The dedicated runtime login role must enforce the server-side query bound:

```sql
ALTER ROLE <runtime-role> SET statement_timeout = '10s';
```

The migration preflight verifies that the pooled endpoint reports a positive
`statement_timeout` no greater than ten seconds. The node-postgres pool uses a
slightly longer twelve-second client query timeout and deliberately does not
send `statement_timeout` as a startup parameter: PlanetScale's
[transaction-mode PgBouncer](https://planetscale.com/docs/postgres/connecting/pgbouncer)
rejects unallowlisted startup parameters. This follows PlanetScale's
[connection-resilience guidance](https://planetscale.com/docs/postgres/connection-resilience):
enforce the database timeout at the role and keep the client timeout slightly
longer. Do not add `statement_timeout` to PgBouncer's
`ignore_startup_parameters`, because that would accept the connection while
silently discarding the server-side bound.

Migration traffic:

```text
HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL
```

Production requires the isolated runtime-log URL. Static URL checks reject
obvious aliases before connecting.
The migration preflight then proves the real endpoint topology in two steps:
pooled and direct runtime-log endpoints must contend for the same random
transaction advisory lock, and the direct primary and runtime-log endpoints
must report different cluster-wide PostgreSQL system identifiers. Production
therefore requires a genuinely separate Postgres project or cluster; a second
schema or logical database on the primary cluster is rejected because it would
still share compute, storage, WAL, checkpoints, and connection capacity.

Local development and tests may leave the runtime-log database unconfigured,
which makes best-effort log writes and reads no-ops. To exercise the dedicated
path locally, provision a separate database, configure its URLs, and run:

```bash
pnpm --dir apps/web runtime-logs:migrate:deploy
```

The optional real-Postgres proof needs only a loopback primary test URL. It
creates a temporary second logical database, proves that the production
topology preflight rejects it as the same physical cluster, applies both
migrations, proves the deletion fences, and drops the database:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test \
MURPH_TEST_RUNTIME_LOG_POSTGRES=1 \
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/hosted-runtime-log-postgres-concurrency.test.ts
```

The production migration wrapper applies isolated migrations before primary
Prisma migrations, proves pooled/direct identity with a live advisory-lock
probe, proves physical primary isolation with cluster system identifiers, and
verifies the canonical schema owner before invoking Prisma.

## Deployment

The dedicated database and URL configuration must remain in place for every
production Web deployment. Deploy the Web build that no longer references the
primary runtime-log table, let prior functions drain, then run the post-deploy
contract migration that drops the legacy table. No synchronized Cloudflare
rollout is required because the signed callback protocol is unchanged. Verify
dedicated append rate, callback failures, retention counts, status continuity,
account deletion, and absence of the primary table after the contract lane.

## Rollback

After the contract migration drops the primary table, the rollback floor is the
first Web deployment that no longer references it. Restoring an older build
requires re-expanding the primary schema first. Keep both isolated URLs
configured, do not repoint them at the primary database, and leave the isolated
schema in place during an incident.

## Shared Vault CLI phase timing (existing usage profile)

`hosted_ai_usage.turn_profile_json.cliTiming` is optional internal telemetry in
**the existing primary usage database**, not a new runtime-log stream/table.
The legacy `murph.assistant-turn-profile.v1` / `.v2` request, token, tool call,
duration, failure and output-byte fields retain their existing meanings. Do not
sum a native tool's inclusive duration with these CLI phases.

### Ownership and transport

Normal `runMurphCliEntrypoint` / `runMurphCliAction` calls open a timing scope;
`createVaultCliShell` uses native Incur middleware's resolved registered command
path and `next()`. Both scoped and full routing use that shell. Identity comes
from the closed catalog in `runtime-state/cli-timing`, never shell parsing,
arguments or result data. Unrecognized names and pre-resolution failures use
`other`. Standalone setup/discovery paths without that middleware remain
unattributed; persistent interactive/MCP sessions are not per-RPC measurements.

`cli-entry.ts` loads `runtime-state/node/cli-timing` through native dynamic
imports at its existing asynchronous entry/action and serve-options boundaries.
This keeps the timing implementation and closed wire catalog out of the runner's
static startup closure while native module caching preserves one ALS instance
for entry, middleware, recursive batch actions and query scopes. The timing-owner
import completes before the entry/action scope opens; that import is **not**
included in `total` or relabelled as `setup`. No new loader, cached state owner or
transport await is introduced. Canonical runner assembly still enforces the
20,000-byte entry and 33,200-byte static-closure budgets.

Web's own `apps/web/tsconfig.json` paths map includes both timing public subpaths
from source. Its independent paths map must not rely on the root map or a prior
runtime-state `dist` build. The existing source resolver and Next configuration
remain the owners; no alias rewriter or compatibility shim is required.

The existing usage extractor has no subprocess phase payload, and stdout/stderr
are model-visible tool results. The small metadata seam below bridges only that
missing boundary; it is not a new persisted log or monitoring service.

The existing Codex process owns one unreferenced, loopback-only UDP endpoint and
one bounded active-attempt collection window. Its explicit shell environment
setting passes an ephemeral endpoint to naturally occurring CLI subprocesses.
The existing hosted shell allowlist admits **only this new diagnostic name**;
per-thread explicit allowlists receive the same narrow addition. Authentication,
provider variables, sandbox/network permission and tool invocations are unchanged.
Warm loaded threads may ignore resume overrides, so the endpoint lasts for the
existing process, not one thread/resume. There is no awaited bind/send/flush,
filesystem spool, retry, external request, daemon, collector service or keepalive.
One best-effort datagram is sent when a root CLI scope naturally finishes. Neither
stdout, stderr, native results nor prompts carry diagnostic text. An attempt with
no native source events does not receive a diagnostic-only event: telemetry cannot
turn an empty startup failure into provider activity. No caller flag
or `--full-output` is required. Without the endpoint, the scope is a no-op.

The complete route is:

```text
CLI entry + Incur dispatch + shared query-freshness scopes
 -> runtime-state/node/cli-timing bounded root summary (loopback datagram)
 -> existing CodexAppServerProcess active collection
 -> diagnostic-only murph/cliTiming raw event (not model input or a new log)
 -> buildAssistantCodexTurnProfileJson / extractCodexAssistantProviderUsage
 -> existing hosted usage reporting, including detached-assistant-ask forwarding
 -> hosted-execution parseAssistantUsageRecord independent optional normalization
 -> usage-record-port optional timing fit against the complete HTTP body budget
 -> existing /api/internal/hosted-execution/usage/record bounded body ingestion
 -> apps/web hosted-execution/usage.ts JSON normalization
 -> existing HostedAiUsage.turnProfileJson / hosted_ai_usage.turn_profile_json
```

No paths, IDs, argv, URLs, SQL, exception text, result values or health/provider
data are retained. The transport key and same-host monotonic ticks only guard
local collection-window admission and are stripped before the raw event/profile.
This is best-effort diagnostic attribution, not an authorization or integrity
ledger. Existing runtime/version dimensions, usage sampling and retention remain
unchanged; there is no new subject/correlation label.

### Timing semantics and completeness

All durations use `process.hrtime.bigint()`, floored to integer **microseconds**.
A command/outcome entry has `calls` and fixed phase summaries with `count`,
`sumUs`, `maxUs` and eight bucket counts. The phases are **inclusive**, not an
exclusive partition:

| Phase | Boundary / interpretation |
| --- | --- |
| `total` | Entry/action scope until completion or an observed Incur exit. Excludes Node launch and imports before the entry scope opens. |
| `setup` | Entry scope to first resolved Incur dispatch: lazy module loading, routing and vault selection done there. Later vault resolution remains in dispatch. Not pure startup. |
| `dispatch` | `await next()` in native middleware: argument/environment validation, command handler and any stream consumption performed there. Not pure handler CPU or query time. |
| `post-dispatch` | Middleware completion to action completion, including output/filtering/formatting performed there. Not pure serialization and not a guarantee of OS stream flush. |
| `teardown` | The existing entrypoint warm-Codex cleanup; recursive batch actions do not perform this cleanup. |
| `unattributed` | Action elapsed when no dispatch boundary was reached. It is not zero-cost setup or a guessed command phase. |
| `query-freshness` | Shared `ensureFreshQueryProjection`, including its nested phases/rechecks. Applies across query callers/CLI families. |
| `query-manifest` / `query-status` | Each existing canonical manifest scan / projection-status read, including rechecks. |
| `query-rebuild` / `query-wait` | Existing single-flight leader rebuild / follower's wait for that same promise. Only the leader owns rebuild time. |

Nested scope summaries must not be added to their inclusive parents. Concurrent
or overlapping named spans can overlap in time; repeated rechecks increase phase
`count`, not command `calls`. Remaining dispatch time is **unattributed work**:
for example stored-row reads, composition or other handler work. This patch does
not distinguish database, provider, query execution or serialization subphases.
CPU timing is intentionally omitted: process-wide CPU deltas would mix concurrent
invocations and single-flight owners, not reliably distinguish one caller's waits.

Outcomes are only `ok`, `error`, `unknown`: a normal return, a thrown exception /
observed nonzero Incur exit, or an observed thrown EPIPE whose existing bin policy
handles it separately. There are no invented timeout, cancellation or retry
classifications. Later asynchronous output failures may occur outside the scope;
normal return does not certify final pipe delivery. Handler cancellation is an
ordinary observed error unless the original owner returns normally. Hard kills
produce **no fabricated completion**; immediate `process.exit`, network-isolated
shells and late/failed datagrams may produce no report. The existing ordinary-member `murph-member-workspace` profile permits networking;
that is the built-entry transport proof's profile. Read-only and other profiles
with networking disabled remain unchanged and can therefore have no phase
transport. Do not widen a permission profile to obtain telemetry. A denied socket
in one validation host does not establish a permanent product restriction.

The receiver uses CLI-root start/end ticks against its active window, not a join
on native command item IDs. Roots begun in a prior window are rejected. A
background shell starting a **new** CLI root during a later window is counted in
that later collection window. Do not interpret CLI command outcomes as the outer
provider attempt's success, or add the native and CLI call counts together.

Structured batch recursively uses the same action boundary. Children have their
own command, phases and outcomes; the inclusive parent contributes only
`batchContainers`, never another latency sample. Unexecuted stop-on-error children
and children rejected before entering the CLI have no invented command timing.
Legacy batch output, counts, lengths, durations and failure handling are unchanged.

Bounds are source-owned: 32 distinct command/outcome entries per report/active
window; 11 fixed phase names; 64 started scoped spans per invocation (plus fixed
lifecycle samples); at most 8,192 bytes per complete UDP envelope (including the
ephemeral key/ticks) and 256 received packets per window. The 8 KiB cap is below
the supported macOS 9 KiB UDP datagram limit; no host setting or permission is
changed. The sender trims before sending, and the receiver rejects envelopes
over that same cap. No per-call list is retained. Known omitted/overflowed calls increment
`droppedCalls`; capped or unfinished scoped spans increment `droppedSpans`.
Payload trimming removes whole command summaries from the end of the bounded
collection and includes their full call counts in `droppedCalls`; the retained
samples are not a random sample. No packet splitting or retry is added.
Arithmetic overflow drops the incoming command's contribution without changing
legacy accounting. Packet-budget
exhaustion sets `transportTruncated`; rejected cross-window roots increment
`outOfWindowReports`. `reportCount` counts accepted root reports, not commands.
These counters cannot quantify unreceived packets or hard-killed processes.
A missing optional object/phase is **unknown**, never a duration of zero. An empty
activated-window report is not proof every CLI invocation was observed.

The complete usage-request ceiling is separately **16,384 UTF-8 bytes**, owned by
`HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES` in `hosted-execution/runtime-control` and
shared by the sender and Web route. Individually bounded datagrams can merge into
an oversized HTTP payload. `runtime-platform/usage-record-port.ts` therefore
normalizes/copies only `cliTiming` and measures the entire JSON body, including
`usage`, the legacy profile and any notice target, before transport serialization
and signing. It removes whole summaries from the end until the request fits,
adding their calls to the existing saturating `droppedCalls`. Other counters and
retained phases are unchanged; HTTP trimming does **not** set `transportTruncated`
(which describes the packet budget). A counters-only timing object can remain.

If even those counters do not fit, the optional `cliTiming` field is omitted.
Absence then means unavailable timing, not zero work, and does not distinguish
body-budget omission from older producers or missing transport. `droppedCalls`
can only quantify omissions where the timing object survives. All legacy usage,
provider-request, token, tool and notice-target fields are preserved; the queued
record is not mutated. An already-oversized legacy request remains oversized and
follows its existing rejection path rather than sacrificing accounting to fit.
No request/packet cap, retry or flush behavior changes. The corrected sender works
with the existing Web ceiling; this fix does not require coordinated deployment.

The exact histogram intervals in milliseconds are `[0,250)`, `[250,1000)`,
`[1000,2500)`, `[2500,5000)`, `[5000,10000)`, `[10000,30000)`,
`[30000,60000)`, `[60000,+infinity)`. Measured zero is in bucket 0.
For percentile rank `ceil(p * count)`, locate the first cumulative bucket covering
that rank and report its **interval**, not its midpoint as a precise percentile.
For the final bucket, the observed maximum supplies a finite upper bound on the
retained sample. Histograms merge by summing corresponding counts; never compute
per-call percentiles from per-profile averages. Truncation/loss means even those
bounds describe the retained samples, not the complete population.

### Bounded latest-72h / prior-72h inspection

Run on the **primary usage database**. This example uses one stable UTC anchor,
144 hours and a 50,000-row cap. A row-cap hit invalidates claims of complete period
coverage (inspect narrower fixed windows instead). It selects a small closed
operation subset; add only literal registered names from the contract, not argv
or user-supplied labels. Arrays/numbers below come from the independently validated
`murph.cli-timing.v1` object. No identifiers or free-text fields are selected.
Coverage columns are per-period and repeated alongside phase rows; **do not sum
them across phase rows**. Repeated query phases have sample counts, not unique
command coverage. `total` is the per-command timing distribution.

```sql
WITH anchor AS (SELECT now() AT TIME ZONE 'UTC' AS end_at),
rows AS MATERIALIZED (
  SELECT CASE WHEN occurred_at >= end_at - interval '72 hours'
              THEN 'latest72' ELSE 'prior72' END AS period,
         turn_profile_json -> 'cliTiming' AS t
  FROM hosted_ai_usage CROSS JOIN anchor
  WHERE provider = 'codex-cli'
    AND occurred_at >= end_at - interval '144 hours' AND occurred_at < end_at
  ORDER BY occurred_at DESC
  LIMIT 50000
), valid AS MATERIALIZED (
  SELECT period, t FROM rows
  WHERE t ->> 'schema' = 'murph.cli-timing.v1'
), coverage AS (
  SELECT r.period, count(*) AS usage_rows,
         count(v.t) AS rows_with_timing,
         sum((v.t ->> 'reportCount')::numeric) AS accepted_root_reports,
         sum((v.t ->> 'droppedCalls')::numeric) AS dropped_calls,
         sum((v.t ->> 'droppedSpans')::numeric) AS dropped_spans,
         sum((v.t ->> 'outOfWindowReports')::numeric) AS cross_window_reports,
         bool_or((v.t ->> 'transportTruncated')::boolean) AS packet_cap_hit
  FROM rows r LEFT JOIN LATERAL (
    SELECT r.t WHERE r.t ->> 'schema' = 'murph.cli-timing.v1'
  ) v ON true
  GROUP BY r.period
), wanted(command) AS (
  VALUES ('goal list'), ('family list'), ('memory show'), ('wearables latest'), ('wearables day'),
         ('wearables activity list'), ('wearables sources list'), ('other')
), commands AS (
  SELECT v.period, c FROM valid v
  CROSS JOIN LATERAL jsonb_array_elements(v.t -> 'commands') c
  JOIN wanted w ON w.command = (c ->> 'command')
  WHERE c ->> 'outcome' IN ('ok', 'error', 'unknown')
), samples AS (
  SELECT period, c ->> 'command' AS command, c ->> 'outcome' AS outcome, p
  FROM commands CROSS JOIN LATERAL jsonb_array_elements(c -> 'phases') p
  WHERE p ->> 'phase' IN ('total', 'setup', 'dispatch', 'post-dispatch',
    'teardown', 'unattributed', 'query-freshness', 'query-manifest',
    'query-status', 'query-rebuild', 'query-wait')
), totals AS (
  SELECT period, command, outcome, p ->> 'phase' AS phase,
         sum((p ->> 'count')::numeric) AS phase_samples,
         sum((p ->> 'sumUs')::numeric) / 1000 AS sum_ms,
         max((p ->> 'maxUs')::numeric) / 1000 AS max_ms
  FROM samples GROUP BY period, command, outcome, p ->> 'phase'
), bins AS (
  SELECT period, command, outcome, p ->> 'phase' AS phase,
         b.ordinality - 1 AS bucket,
         sum((b.value #>> '{}')::numeric) AS bucket_count
  FROM samples
  CROSS JOIN LATERAL jsonb_array_elements(p -> 'buckets')
    WITH ORDINALITY AS b(value, ordinality)
  GROUP BY period, command, outcome, p ->> 'phase', b.ordinality
)
SELECT t.*, t.sum_ms / nullif(t.phase_samples, 0) AS mean_ms,
       b.bucket, b.bucket_count,
       c.usage_rows, c.rows_with_timing, c.accepted_root_reports,
       c.dropped_calls, c.dropped_spans, c.cross_window_reports, c.packet_cap_hit,
       (SELECT count(*) = 50000 FROM rows) AS row_cap_hit
FROM totals t JOIN bins b USING (period, command, outcome, phase)
JOIN coverage c USING (period)
ORDER BY period, command, outcome, phase, bucket
LIMIT 4096;
```

To inspect coverage-only periods, including an all-legacy baseline with no timing
samples, use the same `anchor`, `rows`, `valid`, `coverage` CTEs and finish with
`SELECT * FROM coverage ORDER BY period LIMIT 2;`. A zero-count accepted report
and absent telemetry are different; neither establishes complete native-call
coverage. Do not filter exclusively to succeeded provider attempts when assessing
CLI errors or aborted-attempt missingness.

### Compatibility, rollout and proof

Deploy the updated hosted `parseAssistantUsageRecord` consumer **first**, then
publish runtime-state, query, CLI and the Codex-process producer/hosted allowlist
in the usual runtime image. No migration, deployment workflow/configuration or
release-contract bypass is needed. The allowlist edit is existing runtime shell
metadata admission, not expanded tool/network permission. Older v1/v2 profiles
remain readable. Old consumers drop the new optional key while retaining legacy
profile/token accounting. New consumers accept old producers. A new CLI with an
old launcher has no endpoint; a new launcher with an old CLI has no report. An
unknown future diagnostic schema/name or malformed optional object is dropped
independently, not a reason to reject valid legacy usage. Closed vocabulary
expansions likewise require consumer-first admission. Rollback can lose optional
coverage without changing tool execution or billing.

Focused proof lives in runtime-state `cli-timing.test.ts`, CLI
`cli-timing.test.ts`, query `query-projection-concurrency.test.ts`, and engine
`cli-timing-{transport,profile}.test.ts`. Real transport tests send valid envelopes
at exactly 8,192 bytes and at 8,193 bytes, so rejection exercises the receiver
rather than the host UDP size limit. The natural sender test requires receipt
of a trimmed report with nonempty summaries and conserved retained/dropped call
counts. Datagram loss still leaves unquantified missingness. The runtime
`hosted-runtime-codex-config.test.ts` built-entry test is an explicit opt-in:
`MURPH_RUN_HOSTED_CLI_TIMING_E2E=1`. Default source/coverage shards do not build a
CLI and skip only this artifact-dependent integration gate; deterministic fixture
parsing/failure/parity tests and existing production-surface tests remain enabled.
The parent must run the enabled gate successfully before marking the PR Ready.
Once enabled, missing artifacts, native failures, blocked reads/networking and
missing telemetry are hard failures, not reasons to skip.

The gate uses the pinned real Codex binary and a synthetic local Responses
provider, `buildHostedCodexConfigToml`, the unchanged `murph-member-workspace`
profile and production shell allowlist, with only the synthetic vault as a
workspace root. `MURPH_HOSTED_CLI_TIMING_CLI_BIN` optionally selects an absolute
path to the freshly packaged `@murphai/murph` **`dist/bin.js`**. Without it, the
test uses the checkout's `packages/cli/dist/bin.js`; this works only when that
layout is already readable by the profile. The test checks the built entry and
package name, but does not establish artifact freshness from the path: prepare
from the current candidate immediately before the run. Both test variables are
read by the test process only, not added to production environment admission.

Prepare the actual package/closure under an already permitted temporary root,
not a broad source-checkout copy or symlinks back to unreadable workspace files.
The existing release packer retains built workspace payloads and patched bundled
dependencies; native installation resolves the host's platform dependencies.
This avoids the runner installer's intentional Linux-only platform target on
macOS. The release packer's existing manifest also requires the public plugin
build; that plugin is not installed into this CLI fixture. No staging owner or
CI build is added. From the repository root on supported Node/pnpm:

```sh
set -eu
pnpm --filter @murphai/murph... --filter @murphai/openclaw-plugin... build
export MURPH_CLI_TIMING_ARTIFACT_ROOT="$(mktemp -d /tmp/murph-cli-timing.XXXXXX)"
node scripts/pack-publishables.mjs \
  --out-dir "$MURPH_CLI_TIMING_ARTIFACT_ROOT/tarballs" \
  --pack-output "$MURPH_CLI_TIMING_ARTIFACT_ROOT/pack-output.json"
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = process.env.MURPH_CLI_TIMING_ARTIFACT_ROOT;
const install = path.join(root, 'installed');
mkdirSync(install);
writeFileSync(path.join(install, 'package.json'), '{"private":true}\n');
const manifest = JSON.parse(readFileSync(path.join(root, 'pack-output.json'), 'utf8'));
const tarballs = manifest.packages
  .filter(entry => entry.name !== '@murphai/openclaw-plugin')
  .map(entry => path.resolve(entry.tarball));
execFileSync('npm', ['install', '--prefix', install, '--omit=dev',
  '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], { stdio: 'inherit' });
NODE
export MURPH_HOSTED_CLI_TIMING_CLI_BIN="$MURPH_CLI_TIMING_ARTIFACT_ROOT/installed/node_modules/@murphai/murph/dist/bin.js"
MURPH_RUN_HOSTED_CLI_TIMING_E2E=1 \
  pnpm --dir packages/assistant-runtime exec vitest run \
  --config vitest.config.ts --no-coverage \
  test/hosted-runtime-codex-config.test.ts -t 'shared CLI timing'
```

Packing/installing uses existing local package assets and ordinary public
package dependencies, not provider credentials or production traffic. The test
itself uses local synthetic providers only. Preparation failures must be fixed
before running the gate; no registry package may substitute for the candidate's
local Murph tarballs. Remove the temporary artifact root after validation. This
is a local artifact operation, not a deploy command or release-contract bypass.

All test homes, vaults, working directories and provider keys are synthetic.
The shell sets test-only `OPENSSL_CONF=/dev/null`; initialization and both parity
children use it, without widening the production allowlist. There is no source
loader, unrestricted sandbox substitution, new filesystem grant or extra runtime
workspace root. A readable CLI artifact does not prove every installed Node or
dependency read is permitted; subsequent native failures remain explicit.

The fixture runs telemetry-disabled and enabled built children inside the **same**
hosted shell/profile, comparing their completed exit status and each stdout/stderr
stream byte-for-byte. It checks the current call's authoritative
`custom_tool_call_output` selected by the current call ID, rather than assuming
nested `tools.exec_command` emits `commandExecution` events. The fixture emits
one fixed `MURPH_CLI_TIMING_SHELL_RESULT=` line inside that native output; native
status/wall-time/Output framing need not start with JSON. Missing/duplicate or
malformed sentinel lines, shell failure and child failure all fail the proof.
This sentinel is test-only output, never production tool text or telemetry. The
disabled child has no endpoint and must contribute no report. Scoped `goal list` and full-router
`family list` must expose lifecycle phases, **not** query freshness. A separate
built `wearables latest` invocation reaches the real query owner and must expose
`query-manifest`, `query-status`, and `query-freshness` on the synthetic vault.
No query calls are added to non-query commands. A nonempty session, unchanged
session on continuation, and native `warm-reused` traces are required.

Passing this gate establishes built CLI -> hosted shell -> Codex raw diagnostic
transport; the engine profile test composes it with the actual extractor -> hosted
normalization boundary. Separate startup cases distinguish no native event from
an actual native RPC error and retain the latter. Their receiver fixture mirrors
the one-shot production close contract: catch and finally can both finish cleanup,
but only the first can return a diagnostic. Empty startup failures remain empty;
native error evidence remains present exactly once. The profile token fixture is a valid
native notification, so request accounting is tested as well as tool accounting.
The history-dependent profile test loads the consumer source from the exact Git
base supplied in `MURPH_CLI_TIMING_COMPAT_BASE`; no copy of the old parser is kept
in the repository. Run that explicit gate from the active plan. A current-parser
roundtrip of field-stripped data is only legacy-shape proof, not mixed-version
proof. Ordinary runs without the base variable explicitly skip this additional
history-dependent case.

For source-resolution and startup-loading corrections, run the focused guards
from the repository root before the existing built hosted proof:

```sh
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/next-config.test.ts
pnpm --dir apps/web typecheck:prepared
pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage \
  packages/cli/test/cli-timing.test.ts packages/cli/test/cli-entry.test.ts \
  packages/cli/test/batch.test.ts packages/cli/test/batch-protocol-error-stages.test.ts \
  packages/cli/test/assistant-codex.test.ts \
  packages/cli/test/vault-cli-import-surface-contract.test.ts
pnpm --dir packages/cli typecheck
# Canonical production assembly on Linux x86_64; no deploy and no budget override.
pnpm --dir apps/cloudflare runner:bundle
```

The Web typecheck uses the normal generated-data preparation prerequisites, not
prebuilt timing declarations as a substitute for source resolution. Import
laziness tests are not a replacement for the assembly byte budgets or bundled
parity probes. Refresh the test CLI artifact after the loading change and rerun
the enabled hosted gate above; CI still owns exact-head Linux assembly and the
existing exact-first-parent total-output comparison.

For the merged-profile HTTP budget, run the composed sender/ingestion regression
and the route's exact byte-limit checks (no built CLI or external service needed):

```sh
pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage \
  apps/cloudflare/test/usage-record-port.test.ts
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/hosted-execution-usage-route.test.ts
pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts \
  --no-coverage test/assistant-usage.test.ts
```

The composed test uses real timing scopes/merge, sender and transport serialization,
then Web's actual bounded body reader and request parser through the existing
`#hosted-web-testing` seam. Providers, callback authentication, fetch and persistence
are synthetic; the fixture does not execute CLI handlers or make network requests.
It covers 24 distinct root summaries, maximum admitted cardinality, UTF-8/notice
headroom, counters-only and absent timing, and unchanged oversized legacy failure.
The separate route test checks both declared-length and streamed-byte enforcement
before allowance settlement. Ordinary source CI runs both owners without a new gate.

The warm `packages/runtime-state/bench/cli-timing.ts` microbenchmark rotates
baseline, disabled and enabled timing over warm blocks; it excludes transport
and actual CLI/query work and reports block means, not per-call percentiles or a
production speedup. Run it with `node --import tsx` (no tsx CLI IPC). Parent
validation must run repository tests/typechecks/builds, the actual complexity
guard and the built hosted lane on supported Node/pnpm and pinned Codex versions
before promotion. This telemetry patch does not authorize merging, deployment,
or bypassing the protected public-main release contract.
