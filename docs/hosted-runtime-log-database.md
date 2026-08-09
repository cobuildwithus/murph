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
  -> ECDSA verification + primary anti-replay nonce
  -> accepted-attempt recovery claim, when present
  -> isolated runtime-log Postgres append
```

The callback stays in `apps/web`; Cloudflare receives no database credential and
there is no new service or queue. The anti-replay nonce remains in the primary
control database because `runner.accepted_attempt_failed` recovery shares this
callback. A runtime-log database outage must not prevent a valid recovery claim
from being authenticated and signaled.

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
Codex as `request_kind: memory`. Version 2 records request and input byte counts,
allowlisted shape/model kinds, cache-key presence, and keyed prefix fingerprints.
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

## Reads and retention

Status and latency dashboards read only the isolated store. If a dedicated
status read is unavailable, the Web status response omits its optional
`recentLogs` window. The orchestration projection therefore reports an unknown
log count while workspace and mailbox status remain available.

The dedicated store keeps the existing policy:

- debug/info: 7 days
- warn/error: 14 days
- ordered batches of 5,000, at most four batches per hourly cleanup

The normal retention cron runs isolated cleanup serially through the diagnostic
pool after the primary control-database cleanup completes.

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
