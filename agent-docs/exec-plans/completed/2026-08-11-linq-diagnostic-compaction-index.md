# Bound Linq diagnostic compaction scans

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Keep the hourly Linq provider-event diagnostic compactor proportional to the
  rows that still retain diagnostic JSON as the durable duplicate-gate table
  grows.

## Success criteria

- A backward-compatible predeploy migration adds one concurrent partial index
  matching the compactor's predicate and `(received_at, event_id)` ordering.
- The existing full Prisma-managed retention index remains available for other
  ordered provider-event scans.
- Focused migration/source proof, Prisma validation, exact-head CI, preliminary
  specialist review, final ReviewGPT review, and current-base mergeability all
  pass for the pull request head.

## Scope

- The additive hosted Web Prisma migration and its focused source guards.
- The hosted migration inventory expectation required by the current schema
  proof suite.

## Constraints

- Do not deploy the migration or query production.
- Use `CREATE INDEX CONCURRENTLY` outside an explicit transaction.
- Keep PostgreSQL partial-index ownership migration-only because the current
  Prisma schema cannot express the predicate.
- Do not drop or replace the existing full index in this change.

## Tasks

1. Inspect and hash-match the ReviewGPT implementation artifact.
2. Apply the additive migration and focused regression proof, then reconcile
   the exact migration inventory guard.
3. Run focused migration, retention, production-guard, Prisma, and TypeScript
   validation and inspect the final diff.
4. Commit, push, open the pull request, and run the exact-head specialist and
   final ReviewGPT gates concurrently with CI.
5. Resolve accepted findings, close this plan through `scripts/finish-task`,
   and prove current-base mergeability without merging the pull request.

## Evidence

- The compaction query selects only rows with at least one of three diagnostic
  JSON fields populated, ordered by `received_at` then `event_id`.
- The existing index covers that order for every row, so already-compacted
  durable duplicate-gate rows remain in the scanned index indefinitely.
- Existing hosted Web migrations use concurrent, migration-only partial indexes
  with exact predicates and no transaction wrapper.
Completed: 2026-08-11
