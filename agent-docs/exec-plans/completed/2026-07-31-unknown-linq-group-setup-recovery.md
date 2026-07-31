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
- For an unknown iMessage email sender, send a private short-lived encrypted
  recovery link from the same healthy managed line.
- Reuse `HostedMemberRouting.pendingLinqParticipantContact` plus the exact group
  chat id as a temporary identity bridge. The next message resolves through the
  existing pending-contact lookup, provisions through
  `ensureHostedThreadContainerRouteTx`, and the existing group demotion clears
  the temporary binding.
- Add no schema, alias table, claim model, queue, cron, or ownership transfer.

## Verification

- Focused token and group planner tests.
- `apps/web` typecheck and diff-aware verification in CI.
