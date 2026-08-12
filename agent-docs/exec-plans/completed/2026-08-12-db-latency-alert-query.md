# Bound the hosted runtime latency monitor query

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Keep the five-minute hosted runtime latency monitor index-bounded as retained
  trace, delivery, and mailbox history grows.

## Success criteria

- Candidate admission no longer depends on one cross-table `OR` predicate that
  can force broad scans before the 20,001-row cap.
- The query preserves the exact 24-hour resumed-activity, usage-denial,
  chronology, grouping, and truncation semantics.
- A representative PostgreSQL proof demonstrates bounded candidate work and
  usable indexes under dominant unrelated history.
- Focused tests, Web typecheck, lint, and privacy review pass. Preliminary
  ReviewGPT is attempted when the existing private thread is accessible.

## Constraints

- Reuse the current latency trace, mailbox, and delivery owners.
- Prefer a small `UNION` of indexed candidate identities followed by one exact
  hydration query; add no queue, cache, or duplicate projection without a
  demonstrated need.
- Return only aggregate monitor health and preserve identifier-free alerts.

## Tasks

1. [x] Inspect the existing exact-base ReviewGPT thread without creating a
   duplicate. Its one-character partial response remained inaccessible through
   the live review browser, so no patch or finding was available.
2. [x] Replace the broad cross-owner `OR` with five independently time-indexed
   candidate branches and one exact hydration query.
3. [x] Add PostgreSQL query-plan/cardinality proof under dominant stale history
   and at the 20,001-row truncation boundary.
4. [x] Run focused tests, typecheck, lint, schema/migration checks, architecture
   guards, docs drift, privacy scan, and diff review.

## Verification

- Run the latency alert monitor and cron suites, the relevant opt-in PostgreSQL
  proof, Web typecheck, and scoped lint.

## Outcome

- Candidate admission now uses a materialized five-branch `UNION` over the
  existing trace, delivery, and mailbox owners, followed by exact trace
  hydration and the unchanged latency-origin, chronology, grouping, and
  truncation rules.
- Three concurrent indexes cover previously unindexed staging, delivery
  acceptance, and mailbox consumption candidate branches. Existing indexes
  continue to cover ingress acceptance, provider start, and owner joins.
- A local PostgreSQL proof seeded 50,000 stale rows per owner, admitted exactly
  one candidate through each branch, observed all five intended time indexes
  with no owner sequential scan, and preserved usage-denial restart chronology
  plus the 20,001-row truncation signal.
- Focused monitor/cron tests, the PostgreSQL proof and denial-concurrency test,
  Web typecheck, scoped lint, Prisma generation/validation/migration deploy, the
  production migration guard, workspace and architecture guards, docs drift,
  privacy scan, and `git diff --check` passed.
Completed: 2026-08-12
