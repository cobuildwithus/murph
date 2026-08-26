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
- `hosted_runtime_log_deletion_fence` owns one monotonic row for each digest
  whose account-deletion cleanup reached the isolated database.
- Transaction-scoped advisory locks are derived from the same digest and
  serialize append with fence-and-delete.

The isolated database does not store the raw hosted member id and has no
cross-database foreign key. The deletion fence stores only the existing opaque
digest plus its database insertion time. It is never cleared or retention-
pruned. Attempt ids and other existing redacted operational correlation fields
retain their current contract and limits.

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

## Append and deletion serialization

Append validates the complete batch and resolves primary member authority before
any isolated pool checkout. A missing or suspended member returns
`loggedCount: 0` without opening an isolated transaction. An active member then
enters one short isolated transaction:

1. Take the subject's transaction-scoped advisory lock.
2. Re-read primary member authority and return `loggedCount: 0` when the member
   became missing or suspended.
3. Return `loggedCount: 0` when the subject deletion fence exists.
4. Insert the validated batch with one SQL statement.

The early authority read keeps its entire wait ahead of isolated checkout. The
final read preserves reversible billing-suspension authority under the subject
lock; billing restoration can clear that suspension, so it must not create a
permanent deletion fence.

Moving only the primary read would leave a privacy gap: append could read an
active member, account deletion could commit its primary suspension and complete
the isolated delete under the subject lock, and the stale append could then
open its isolated transaction after that lock was released. The monotonic fence
closes that exact interval.

The encrypted account-deletion cleanup receipt owns the exact runtime-member id
set after primary deletion commits. Its `runtime_logs_completed_at` completion
field is recorded only after the isolated transaction succeeds; zero matching
rows is idempotent success. Every immediate or hourly cleanup attempt:

1. Takes every subject advisory lock in deterministic signed-lock-key order.
2. Inserts each opaque subject digest into the deletion-fence table with
   `ON CONFLICT DO NOTHING`.
3. Deletes all matching runtime-log rows.
4. Keeps the existing cleanup receipt pending when the transaction fails.

Fence insertion and row deletion commit or roll back together. The caller's
bounded deletion budget is divided across lock acquisition, fence persistence,
and deletion. A lock or statement timeout therefore leaves no partial fence or
partial success, and a repeated cleanup safely retries the same transaction.

The two race orderings converge without a new service or lifecycle owner:

- If append owns the subject lock first, it commits its row before cleanup;
  cleanup then records the fence and removes the row.
- If cleanup owns the lock after append's earlier primary-active read, cleanup
  records the fence and deletes rows before releasing the lock; the delayed
  append then sees the fence and writes zero rows.
- If reversible billing suspension commits after append's early active read,
  the final authority read writes zero rows without creating a deletion fence.
- If the isolated database is unavailable after canonical account deletion, the
  receipt retries with bounded backoff until fence-and-delete converges, then
  records the target complete independently of Cloudflare and vendors.

A warm runner or late network drain cannot recreate diagnostics. The deletion
fence is keyed only by the existing opaque digest, stores no raw member id, and
is never cleared.

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

The normal retention cron first removes strictly expired callback nonces from
the primary control database under the shared 5,000-row and four-batch ceilings.
Each statement orders candidates by expiry and nonce hash, locks only that
bounded set with `FOR UPDATE SKIP LOCKED`, and deletes those exact rows. It then
runs isolated runtime-log cleanup serially through the diagnostic pool after the
primary control-database cleanup completes.

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
topology preflight rejects it as the same physical cluster, applies the
isolated schema and account-cleanup migrations, proves pool isolation plus both
deletion race orderings, and drops the database:

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
production Web deployment. The deletion-fence change is intentionally split
into two Web commits in the applyable patch:

1. Run the additive isolated migration that creates
   `hosted_runtime_log_deletion_fence`.
2. Deploy the compatibility commit that makes cleanup write the fence and makes
   append honor it while retaining the prior primary-under-lock ordering.
3. Let every pre-fence Web function drain.
4. Deploy the final commit that resolves primary authority before isolated
   checkout.

This order makes every mixed pair safe. Pre-change and compatibility appends
still re-read primary authority under the isolated lock; compatibility and final
cleanup both write the fence; final appends can therefore rely on the fence only
after every live cleanup writer knows how to create it. No synchronized
Cloudflare rollout is required because the signed callback request and response
remain unchanged.

The earlier primary-table cutover remains unchanged: deploy the Web build that
no longer references the primary runtime-log table, let prior functions drain,
then run the post-deploy contract migration that drops the legacy table. Verify
the pool-max-two zero-checkout proof, both deletion race orderings, repeated and
timed-out cleanup, dedicated append rate, callback failures, retention counts,
status continuity, account deletion, and absence of the primary table after the
contract lane.

## Rollback

The compatibility commit is the safe rollback waypoint for the final
pre-authority-read commit. Roll back to that commit first and let final-version
functions drain before moving farther back; its append path retains the old
primary-under-lock protection while every cleanup it runs still records the
additive fence. A later rollback to the pre-fence Web is then privacy-safe
because all remaining appends and cleanup use the former shared-lock protocol.
Leave the additive fence table and its rows in place throughout rollback; older
Web versions ignore them, and clearing them would destroy the final version's
privacy invariant.

After the separate contract migration drops the primary runtime-log table, the
rollback floor is still the first Web deployment that no longer references it.
Restoring an older build requires re-expanding the primary schema first. Keep
both isolated URLs configured, do not repoint them at the primary database, and
leave the isolated schema in place during an incident.
