# PR 559 ReviewGPT Round 14

## Goal

Resolve the two accepted exact-head invariant findings:

1. Hosted refetch must dedupe against an expired final-attempt companion row before the scheduler reclaims it.
2. A local heartbeat must not persist any runtime-owned field while `DISCONNECT_IN_PROGRESS` is authoritative.

## Constraints

- Keep companion dedupe and reclaim in the existing SQLite job-store owner.
- Preserve generic expired/exhausted replacement and dead-letter behavior.
- Reuse the existing retryable `CONNECTION_DISCONNECT_IN_PROGRESS` domain error under the connection lock.
- Add no queue, lock, retry owner, or lifecycle state.

## Verification

- Prove refetch returns the original companion job, leaves one row, and same-row reclaim extends its fence.
- Prove the disconnect heartbeat rejects with retryable 409 and performs no update.
- Prove the agent heartbeat route preserves that retryable 409 disposition.
- Run affected store/web tests, owner typechecks, docs and diff checks.
- Close the plan, push with an exact remote-head guard, and rerun exact-head ReviewGPT concurrently with CI.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
