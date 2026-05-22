# Remove Vercel Mailbox Lag Sweeper

## Goal

Delete the Vercel-hosted mailbox lag sweeper so hosted runtime wake orchestration
stays owned by Temporal and the runtime idle checkpoint is not interrupted by a
minute cron recovery loop.

## Scope

- Remove the `apps/web` cron entry, route, implementation, and focused tests for
  `/api/internal/hosted-mailbox/lag-sweeper/cron`.
- Remove dead web signal helper code that only supported the deleted sweeper.
- Update durable architecture/protocol docs so they no longer describe the
  Vercel lag sweeper as an active recovery backstop.
- Add a Cloudflare timing invariant so runner timeout overrides cannot make the
  Temporal owner-watchdog recheck fire before the runtime idle checkpoint
  window plus margin.

## Constraints

- Preserve existing runtime import support for historical
  `runtime.mailbox-lag-observed` control rows.
- Do not change device-sync dirty sweeping or Stripe receipt workflow cron
  behavior.
- Do not alter Temporal workflow command ordering.
- Preserve unrelated active worktree edits.

## Verification

- Focused stale-reference checks.
- Scoped app/repo verification for touched files.
- Required completion audits for runtime/trust-boundary code/config changes.
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
