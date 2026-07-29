# Dedicated hosted runtime log database

Status: completed

## Goal

Move high-volume hosted runtime diagnostic rows off the primary product database
without adding a queue, a new service, or any recovery dependency on the
observability store.

## Proven starting point

- Cloudflare already batches info/debug entries and sends one signed request to
  the existing Vercel callback; warn/error entries remain direct best-effort
  writes.
- The callback currently consumes a replay nonce and inserts runtime-log rows in
  the primary database.
- Runtime recovery ownership already lives on `HostedWorkspace`, so runtime-log
  rows are diagnostic only.
- Recent status and latency dashboards still read the primary log table.
- Account deletion currently relies on the primary log foreign key and cascade
  to reject late diagnostic drains.

## Invariants

- In dedicated write mode, new runtime-log rows never use the primary product
  database. Primary-table retention remains only for the bounded compatibility
  tail; isolated retention never uses the primary pool.
- The callback anti-replay nonce stays in the primary control database because
  accepted-attempt recovery shares the callback and must survive a diagnostic
  database outage.
- Account deletion eventually fences and deletes every isolated runtime-log row
  through the existing encrypted retry receipt.
- A suspended or deleted runtime member can never acquire a new runtime-log row.
- Recovery, mailbox authority, billing, and product state remain on the primary
  database.
- Existing seven-day verbose and fourteen-day warn/error retention stays
  bounded and serial.
- Deployment can roll back during a fourteen-day compatibility window without
  dual-writing or bulk-copying diagnostics.
- No synchronized runtime-producer or Cloudflare rollout is required; the
  optional Cloudflare status optimization remains protocol-compatible.

## Design

- Keep the signed Vercel callback and existing Cloudflare batching.
- Add one small raw-Postgres runtime-log owner backed by
  `HOSTED_RUNTIME_LOG_DATABASE_URL`. An explicit
  `HOSTED_RUNTIME_LOG_STORAGE=primary|dedicated` gate controls only new writes
  and lets the isolated schema and deletion owner deploy before writes move.
  Reads, retention, and account deletion keep using the isolated database in
  both production modes, so a cleanup-aware rollback cannot orphan existing
  rows. Local/test defaults to primary; production fails closed when the mode or
  isolated URL is absent or invalid.
- Keep callback replay nonces in primary Postgres. This tiny control write is
  required for replay-safe recovery and is not diagnostic storage.
- Store only a namespace-scoped SHA-256 subject key on each diagnostic row; the
  raw member id is never persisted in the isolated database.
- Serialize append/delete with a transaction-scoped PostgreSQL advisory lock
  derived from that subject key. After taking the lock, append rechecks primary
  member authority and writes one validated SQL batch only when the member still
  exists and is not suspended. Deletion takes the same locks in stable order and
  deletes the matching rows.
- Extend the existing encrypted account-deletion cleanup receipt rather than
  adding a new lifecycle owner. One nullable completion timestamp records the
  isolated target independently; failure keeps `cleanupPending` true and the
  normal bounded retry loop continues without re-running a completed target. A
  primary delete trigger blocks older deployments from erasing a receipt while
  that timestamp is null.
- Keep legacy primary reads and retention for the existing maximum fourteen-day
  window. After the explicit cutover, new writes go only to the isolated
  database. Status and latency reads merge both stores during that window; a
  follow-up contract cleanup removes the primary model/table and compatibility
  reads after no old row can remain.
- Give the isolated database an independent Prisma migration directory, but
  use the existing `pg` dependency at runtime so the main generated Prisma
  client does not pretend the secondary database owns product tables.

## Stress cases to prove

1. One callback batch becomes one log insert statement, never one statement per
   entry.
2. Empty or malformed batches never partially persist.
3. Dedicated-database failure never falls back to primary diagnostic writes.
4. An append that locks first commits before deletion and is then removed.
5. Deletion that locks first makes every delayed append observe suspended or
   missing primary authority.
6. Multi-runtime deletion locks subjects in stable order.
7. The account-deletion receipt records isolated cleanup independently, remains
   pending on failure, and converges on retry without a new owner.
8. Recovery authentication and recheck claiming still run when diagnostic
   persistence fails.
9. Status and latency reads keep the pre-cutover window without duplicates or
   hidden per-store truncation.
10. Retention remains bounded and keeps warn/error longer than verbose logs.
11. Production migration fails closed when the dedicated URL is missing, the
   direct URL is a known pooler endpoint, pooled/direct log endpoints reach
   different databases, or a disguised hostname alias reaches the primary
   database.
12. Local/test fallback continues to work against the existing primary schema.

## Deployment

1. Provision the isolated Postgres project/cluster and configure runtime plus
   direct migration URLs in Vercel with `HOSTED_RUNTIME_LOG_STORAGE=primary`.
2. The production migration runner creates the isolated schema before primary
   migrations and before the new web build is promoted; all writers remain on
   primary while old deployments drain.
3. After the prior Web deployment has fully drained, switch the mode to
   `dedicated`. Cloudflare keeps using the unchanged callback contract.
4. Verify isolated inserts, primary insert cessation, merged recent status,
   latency timing, bounded retention, and account deletion retry convergence.
5. After fourteen days, remove compatibility reads, primary runtime-log
   retention/deletion, Prisma model/relation, and table through the normal
   contract-migration lane.

## Rollback

Set `HOSTED_RUNTIME_LOG_STORAGE=primary` and roll back only to the first
cleanup-aware deployment from step 2 while leaving both schemas and isolated
URLs in place. That build returns new writes to primary but continues isolated
reads, retention, and account-deletion cleanup. After isolated writes exist, do
not roll back below this compatibility floor to a pre-change build that cannot
own isolated deletion. Never repoint the isolated database URL at production
Postgres.

## Verification

- Focused isolated store, callback, status, latency, retention,
  account-deletion-cleanup, configuration, and migration-runner tests.
- SQL-level proof for subject locking, fenced late writes, rollback, and
  bounded retention.
- `pnpm test:diff`
- `pnpm verify:acceptance`
- `git diff --check`, privacy scan, and secret-pattern scan.

## Completion evidence

- Preliminary `completion-specialists` ReviewGPT inspected the exact pushed
  implementation head. It found two accepted reliability/coverage gaps:
  post-commit device-sync diagnostics could be skipped by a later failed update,
  and the real-PostgreSQL suite did not exercise the read and retention SQL.
  The final implementation flushes already-collected diagnostics from `finally`
  without changing the canonical error, and the PostgreSQL suite now executes
  recent reads, timing reads, and bounded retention.
- Focused migration, mailbox, and device-sync suites pass: 112 tests.
- The isolated real-PostgreSQL concurrency and SQL suite passes: 6 tests,
  including both append/deletion lock orderings, overlapping subject deletion,
  the compatibility receipt guard, recent and timing reads, and bounded
  retention.
- `pnpm test:diff apps/web apps/cloudflare` passes, including 7,423 web tests,
  the production web build, 2,141 Cloudflare Node tests, and 3 Workers tests.
- `pnpm verify:acceptance` passes, including package coverage, every workspace
  typecheck and built-package boundary, the production web build, and both
  Cloudflare verification lanes.
- Web lint passes with zero errors; 22 unchanged warnings remain outside this
  task. `pnpm logs:guard` and `git diff --check` pass.
Updated: 2026-07-29
Completed: 2026-07-29
