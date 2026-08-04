# Unknown Linq group setup recovery

Status: completed
Created: 2026-07-31
Updated: 2026-07-31

## Goal

Let an otherwise valid but unrouted iMessage group recover when its first sender
is not yet an active recognized Murph member, including the case where Apple
Messages sends from an email address instead of the member's phone number.

## Design

- Keep the existing invariant that only a later inbound message from an active,
  recognized member provisions the thread container.
- Send one idempotent setup link in an unknown group. Clicking it only signs in
  or signs up; it never claims or connects the group.
- Use one expiring same-tab browser handoff so the existing auto-trial or Stripe
  success client returns completed setup to the group instruction page. Billing
  APIs and durable account state remain unchanged.
- For an unknown iMessage email sender, send a private 24-hour encrypted
  recovery link from the same healthy managed line. Keep its bearer token in the
  URL fragment so it does not enter request logs or referrers.
- Derive that encrypted token deterministically from the stable provider event,
  with separate encryption and nonce keys, so one Linq idempotency key always
  carries identical message bytes on retry.
- Reuse `HostedMemberRouting.pendingLinqParticipantContact` as the temporary
  identity bridge, but resolve it only when its email, group chat id, and Murph
  recipient line all match the new inbound. The existing group demotion clears
  that exact temporary binding after route creation.
- Serialize private recovery against group route creation with the existing Linq
  chat ownership lock and reject a verified email already owned by another
  account.
- Add no schema, alias table, group claim, connect button, ownership transfer,
  queue, cron, or message backfill.

## Verification

- Focused token, browser handoff, recovery-route, exact pending-routing, and
  group planner tests.
- `apps/web` typecheck and diff-aware repository verification in CI.
