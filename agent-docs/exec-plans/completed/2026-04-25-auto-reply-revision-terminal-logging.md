# Clarify auto-reply revision terminal logging

## Goal

Make local `murph run` auto-reply recovery logs distinguish a before-delivery revision from a stalled or duplicate provider turn.

Success criteria:

- Safe terminal output shows the existing revision progress detail when late same-conversation input forces a provider restart.
- Raw/private provider status details still remain hidden by default.
- Focused terminal logging tests cover the revision detail.

## Constraints

- Preserve unrelated dirty work and active ledger rows.
- Keep the change to terminal presentation; do not alter delivery, recovery, grouping, or retry behavior.
- Do not expose raw channel identifiers, delivery targets, message text, local paths, or secrets.

## Plan

1. Register this active lane in the coordination ledger.
2. Patch assistant CLI terminal logging to treat the existing revision status detail as safe-visible.
3. Add focused logging coverage.
4. Run package-local focused verification.
5. Close the plan through the repo workflow, committing only the scoped logging/test/plan files if safe.

## Verification

Pending.

## Notes

- The same-second `replied` then `reply-skipped` sequence is expected recovery flow: the first recovered receipt writes reply artifacts for the capture group, and the next failed receipt is immediately recognized as already covered by those artifacts.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
