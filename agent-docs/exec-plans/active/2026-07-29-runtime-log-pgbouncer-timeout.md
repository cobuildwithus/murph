# Runtime-log PgBouncer timeout compatibility

Status: active

## Outcome

Make the dedicated hosted runtime-log database usable through PlanetScale's
transaction-mode PgBouncer endpoint, then complete the production cutover
without moving application traffic to direct Postgres.

## Proven cause

- The isolated database, schema, indexes, credentials, direct endpoint, and
  pooled/direct database identity are healthy.
- The first dedicated-mode production canary failed before SQL execution with
  PostgreSQL protocol code `08P01`.
- A matching probe succeeds through the pooled endpoint when the node-postgres
  `statement_timeout` startup parameter is absent, and succeeds through the
  direct endpoint when that parameter is present.
- PlanetScale PgBouncer rejects unallowlisted startup parameters. Ignoring
  `statement_timeout` would silently discard the intended server-side bound,
  while direct application traffic would give up the required serverless
  pooling boundary.

## Invariants

- Production runtime traffic continues through the pooled endpoint; the direct
  endpoint remains migration and administration only.
- The server cancels runtime-log statements after at most ten seconds.
- The driver has a slightly longer client-side query timeout so normal server
  cancellation wins first.
- Production migration preflight proves the pooled runtime role has the
  required server-side timeout before a deployment can proceed.
- Dedicated write failure never falls back to the primary database.
- Account-deletion locking, compatibility reads, retention, and the fourteen-day
  primary tail remain unchanged.

## Steps

1. Replace the rejected startup parameter with a client-side query timeout and
   add a pooled-role server-timeout preflight.
2. Add focused regression coverage and update the operator contract.
3. Run scoped verification and the required completion review gates.
4. Commit, push, open the PR, resolve ReviewGPT and CI, and merge.
5. Deploy in primary mode, drain prior requests, cut over only the storage mode,
   and verify both database write paths plus runtime health.

## Evidence

- No open PR, active execution plan, or active worktree overlaps the changed
  runtime-log database paths or this PgBouncer compatibility fix.
- The installed `pg` client serializes `statement_timeout` into startup
  configuration while enforcing `query_timeout` with a client-side timer.
- Focused Vitest proof passes all 18 runtime-log write and migration tests.
- The Web TypeScript project passes typechecking.
- A local PostgreSQL scenario confirms the preflight interval predicate accepts
  the required ten-second role setting.
- The production runtime role has been configured with the ten-second
  server-side timeout while application storage remains in primary mode.
- Preliminary specialist review, final review, exact-head CI, final ReviewGPT,
  merge, deploy, drain, cutover, and post-cutover verification remain pending.

Updated: 2026-07-29
