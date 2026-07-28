# PR #932 round 22 liveness remediation

## Objective

Resolve ReviewGPT round 22's accepted finding without adding state or a new
owner: a terminally failed group-aware signup delivery must make its exact group
outreach available again even when the row retains historical acceptance or
delivery timestamps.

## Change

- Make current `HostedLinqDelivery.status` the sole liveness authority for
  group-aware signup delivery recovery, matching the existing shared
  member/day liveness query.
- Add production-path PostgreSQL proof for accepted-to-failed exact-group
  recovery, duplicate inbound replay, and a later winning delivered receipt
  restoring suppression.

## Verification

- Run the focused group-outreach store and PostgreSQL recovery suites.
- Run `pnpm test:diff apps/web` and `pnpm verify:acceptance`.
- Push the exact correction head and run ReviewGPT round 23 with required
  GitHub checks.
Status: completed
Updated: 2026-07-28
Completed: 2026-07-28
