# Hosted ingress wake repair

## Goal

Close the remaining hosted ingress wake reliability gaps without adding new
state or orchestration layers.

## Scope

- Re-signal existing mailbox items on duplicate active-member webhook delivery.
- Fail foreground ingress requests when the Temporal mailbox signal cannot be
  handed off after mailbox append, so the upstream retry path remains durable.
- Keep Temporal activity failures on a bounded retry loop instead of treating
  activity failure classification as a signal-only wait.

## Non-goals

- No new outbox table, queue, cron, scheduler, or compatibility path.
- No product-demand source/reason reintroduction.
- No changes to unrelated hosted runner, media, or exercise-library lanes.

## Verification

- Focused web ingress tests.
- Focused hosted Temporal workflow tests.
- Hosted Temporal guard.
- Typecheck.
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
