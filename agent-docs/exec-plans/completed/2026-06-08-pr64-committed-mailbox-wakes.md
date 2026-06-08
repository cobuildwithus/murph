# PR64 committed mailbox wakes

## Goal

Finish PR64 review fixes so generic system work wakes Temporal by signaling the
committed mailbox item itself, while true manual runtime-control requests remain
AI-gated before commit.

Success criteria:

- Settings phone/email/telegram channel sync signals the appended
  `member.channels.updated` mailbox item.
- Stripe activation retry/reconciliation signals the existing
  `member.activated` mailbox item.
- `signalHostedManualRunRuntime` is no longer used as a generic wake for these
  already-committed system facts.
- Focused tests and typechecks pass, with unrelated failures called out.

## Constraints

- Preserve unrelated worktree edits and active coordination rows.
- Keep the change small: no new scheduler, wake-fact materializer, or Web demand
  classifier.
- Do not expose local identifiers, secrets, or raw private data in committed
  artifacts or handoff text.

## Approach

1. Return mailbox item ids from channel-sync append helpers.
2. Update settings sync routes to signal `mailbox_appended` for the committed
   channel-sync item.
3. Update Stripe activation wake paths to resolve and signal the committed
   activation mailbox item.
4. Update tests for settings, channel sync, Stripe activation wake, and focused
   hosted orchestration behavior.
5. Run focused verification, commit, and push the PR update.

## State

Active.

## Notes

- Earlier PR64 fixes already added the new Temporal patch marker and the
  `manual-ai-gated` source for true manual runtime-control requests.
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
