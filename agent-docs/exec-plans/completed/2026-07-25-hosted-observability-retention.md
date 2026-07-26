# Hosted observability retention and recovery ownership

Status: completed

## Goal

Stop production diagnostics from costing unbounded Postgres storage, request-path
latency, and hidden runtime-recovery coupling, without weakening any duplicate
gate or losing a warn/error diagnostic.

## Measured starting state

Read-only production counts on 2026-07-25:

| Table | Rows | Size | Expired by the proposed policy |
| --- | --- | --- | --- |
| `hosted_runtime_log` | 354,388 | 529 MB | 157,662 info rows older than 7 days |
| `hosted_linq_provider_event` | 7,115 | 19 MB | 3,481 rows with 9 MB of diagnostic JSON |
| `device_sync_signal` | 47,652 | 16 MB | 8,004 |
| `device_webhook_trace` | 31,318 | 14 MB | 0 |
| `hosted_ingress_latency_trace` | 3,129 | 8.9 MB | 1,697 |
| `hosted_assistant_runtime_issue` | 2,250 | 1.7 MB | 1,050 already past `expires_at` |

`hosted_runtime_log` is 98% info-level. `device_sync_signal`,
`hosted_ingress_latency_trace`, `hosted_assistant_runtime_issue`, and
`hosted_linq_provider_event` had no retention at all: nothing but account
deletion ever removed a row. `device_webhook_trace` had retention, but it ran as
a global delete on the webhook request path and has found nothing to delete.

## Invariants

- Observability writes never become user-facing latency.
- warn/error diagnostics stay on the direct write path and are never dropped.
- Runtime recovery does not depend on a diagnostic row being written or read.
- Webhook duplicate gates stay durable: Linq provider events and unprocessed
  device webhook traces are never deleted by retention.
- Cleanup is serial and bounded per hourly cron invocation.
- No new table, service, queue, or state owner.

## Implementation

### Runner log transport

One background writer drains a module-level info buffer. The writer is
self-clocking: everything logged while a request is in flight coalesces into the
next request, so a busy invocation sends far fewer round trips with no timer and
no added delay for any entry. Each request stays within the callback's 50-entry
and 128 KiB bounds. warn/error still write directly and block only on their own
write. `at` is stamped at enqueue, so persisted ordering still reflects logical
time.

### Recovery ownership

`runner.accepted_attempt_failed` used to elect a recheck owner by reading back
the runtime log table after insertion. The claim now lives on `HostedWorkspace`
as one nullable cooldown timestamp taken with a conditional `updateMany`. This
keeps recovery control state in the control plane and makes runtime logs purely
diagnostic.

### Retention

The existing hourly job gains five categories and keeps its serial shape. Every
category deletes in ordered batches of 5,000 with a ceiling of 4 batches per
run, so a backlog drains over hours instead of opening one long delete
transaction.

| Data | Retention |
| --- | --- |
| Runtime logs, warn and error | 14 days (unchanged) |
| Runtime logs, all other levels | 7 days |
| Ingress latency traces | 7 days |
| Assistant runtime issues | existing `expiresAt`, now enforced |
| Device-sync signal history | 30 days |
| Processed device webhook traces | 30 days |
| Linq provider diagnostic JSON | compacted after 7 days |
| Mailbox envelopes, web sessions | existing 30 days, unchanged |

The runtime-log policy replaces the previous `assistant.automation_detail`
special case: level is the property that predicts both volume and usefulness, so
one rule covers every noisy event code instead of naming them.

Linq provider-event rows are the transactional webhook duplicate gate and are
never deleted. Their `extraction_json`, `payload_sanitized_json`, and
`payload_shape_json` are nulled after seven days; the event identity, timestamps,
correlation fields, and statuses remain.

### Request-path cleanup removed

`PrismaHostedWebhookTraceStore` ran a global 30-day prune before a claim, after
completion, and after a release. All three are deleted; the hourly job owns
processed-trace retention. The trace being released is still deleted directly.

### Batched runtime-issue import

Issue ids are already stable and an existing row was never updated, so the serial
`upsert(update: {})` loop becomes one `createMany({ skipDuplicates: true })`.

### Duplicate Linq payload shape removed

The sanitized payload embedded a second copy of `payloadShapeJson` under
`data_shape`. The canonical column remains; the copy is gone.

## Deployment

The migration is expand-only: one nullable workspace column plus four indexes.
Deploy the database migration and web callback before the Cloudflare/runtime
producer. Both orders are correct, but the old callback expands a batch into
concurrent single-row inserts, so it should not receive batched traffic longer
than necessary.

## Rollback

Application code can roll back with the nullable column and indexes left in
place. Do not drop the column during an incident.

## Verification

```sh
pnpm test:diff
pnpm verify:acceptance
```

After deployment, verify that the runtime log callback request count falls while
logged entries stay flat, the hourly retention route stays bounded, pool waiters
do not rise, `runner.accepted_attempt_failed` still schedules at most one
recheck per member per 30-second window, and Linq duplicate webhook handling is
unchanged.
Updated: 2026-07-25
Completed: 2026-07-25
