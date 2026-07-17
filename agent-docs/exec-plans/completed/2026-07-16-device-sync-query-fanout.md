# Bound device-sync and member-store per-item query fan-outs

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Stop request paths that fan one or more Prisma queries out per item over
  unbounded arrays (a user's device connections, a batch of member ids) from
  pinning one pooled connection per item. These fan-outs contributed to
  pool-checkout timeouts at ~10 users on the 15-client web pool.

## Success criteria

- `HostedDeviceSyncPublicIngressService.listConnections` and the backfill
  diagnostic use the existing batch
  `listConnectionSourcesForConnections` query instead of one
  `listConnectionSources` query per connection, with identical response
  shape and ordering.
- `readHostedDeviceSyncRuntimeConnectionSnapshot` (hosted-runtime-authority)
  and `readHostedMemberEmailSnapshots` (hosted-member-store) process items
  sequentially, holding at most one pooled connection at a time, with
  unchanged results.
- Scoped verification passes.

## Scope

- In scope: `apps/web/src/lib/device-sync/{prisma-store,public-ingress-service,hosted-runtime-authority,backfill-diagnostic}.ts`,
  `apps/web/src/lib/hosted-onboarding/hosted-member-store.ts`, matching tests.
- Out of scope: provider webhook handling, wake service, settings page
  fan-out (separate task), auth-path queries (separate task).

## Constraints

- No new abstractions: reuse the existing batch source query seam and plain
  sequential loops; do not add concurrency-limiter machinery.
- Overlapping ledger rows: hosted-member-store.ts is also listed by the
  hosted signup timezone handoff lane; this change only touches
  `readHostedMemberEmailSnapshots` iteration shape.
Completed: 2026-07-16
