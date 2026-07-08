# Derive Junction historical backfill work from connection metadata

## Why

During the June 18 – July 3 sleep_cycle-422 outage every Junction job failed,
including connect-time historical backfills and their empty-window retries.
The retry schedule lived only in the in-flight job chain (`scheduledJobs`
returned by a successful run), so when jobs died the chain was lost even
though the state (`junctionHistoricalBackfillStatus`, window, attempts,
lastEmptyAt) was durably recorded in connection metadata. One production
Garmin connection is still frozen at status "retrying" since June 27 with no
queued retry, and any future job loss recreates the same stall. Operators had
no lever short of a manual re-enqueue.

## Change

- `createScheduledJobs` (hourly pass) now derives due historical-backfill work
  from connection metadata: a "retrying" window re-enqueues once its ladder
  delay has elapsed; a connection with no recorded outcome re-derives the
  exact connect-window backfill until a terminal status lands; "complete" and
  "exhausted" derive nothing. Exact-window dedupe keys keep re-enqueueing
  idempotent while a job is queued.
- `buildHistoricalBackfillFollowUp` no longer schedules chain retry jobs; it
  only records metadata. Metadata is the single source of truth for backfill
  progress.

## Invariants

- Backfill work converges: every derived job either records "complete" (found
  records), advances the bounded empty-retry ladder (15m/1h/6h/24h →
  "exhausted"), or re-derives after transient loss.
- Imports remain idempotent (externalRef identity), so redundant backfill
  passes are safe by construction.
- One-time deploy effect (intended): existing connections with no recorded
  backfill status run one 180-day summary backfill on their next hourly pass,
  repairing anything the outage discarded, then record a terminal status.

## Verification

- `pnpm --dir packages/device-syncd typecheck` + `test` — 652 tests pass,
  including new coverage: due/not-yet-due retry derivation from metadata,
  no derivation for terminal statuses or window-less retrying metadata, and
  connect-window re-derivation when no outcome is recorded.
- `pnpm test:diff` from the worktree root before handoff.
Status: completed
Updated: 2026-07-03
Completed: 2026-07-03
