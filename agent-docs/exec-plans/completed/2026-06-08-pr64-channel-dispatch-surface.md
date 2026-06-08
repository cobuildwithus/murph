# PR64 channel dispatch surface

## Goal

Delete the unused `wake` field from the settings channel-sync dispatch return
surface so callers receive only the committed mailbox item id they actually
signal.

Success criteria:

- `HostedMailboxAppendDispatch` contains only `mailboxItemId`.
- Settings route tests and channel-sync tests reflect the smaller return shape.
- Focused web tests and typecheck pass.

## Constraints

- Keep the cleanup scoped to settings channel-sync dispatch shape.
- Do not alter mailbox append semantics, signal behavior, or Temporal logic.
- Preserve unrelated active plans and worktree state.

## Approach

1. Remove `wake` from the dispatch interface and return value.
2. Update test fixtures and expectations.
3. Run focused web verification, commit, and push PR64.

## State

Active.

## Notes

- The committed mailbox row remains the authoritative wake fact; callers only
  need its id.
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
