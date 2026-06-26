# PR 295 ReviewGPT round 7 fix

## Goal

Remove the remaining runtime-local assistant turn ordinal from hosted
phone-call request-key identity.

Success criteria:

- `createPhoneCallRequestKey` does not hash `assistantTurnOrdinal`.
- A regression proves changing only the runtime ordinal does not change the
  request key.
- Focused assistant verification passes before pushing and rerunning ReviewGPT.

## Constraints

- Keep request-key identity based on stable approved input/delivery facts and
  the exact bounded call brief.
- Do not add new idempotency state, task tables, supervisors, queues, or model
  tool arguments.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Remove `assistantTurnOrdinal` from the hosted tool request-key scope.
2. Remove it from phone-call request-key hashing and related test doubles.
3. Add/update the regression for ordinal-only changes.
4. Run focused verification, commit, push, and rerun ReviewGPT.

## State

Ready for scoped commit.

## Notes

- Round 7 accepted finding: `assistantTurnOrdinal` can change across retry or
  replay for the same approved call, producing a second real outbound call.
- Fixed by removing `assistantTurnOrdinal` from
  `AssistantHostedToolRequestKeyScope` and the phone-call request-key hash.
- Verification passed:
  `pnpm --dir packages/assistant-engine exec vitest run test/assistant-phone-calls.test.ts`;
  `pnpm --filter @murphai/assistant-engine typecheck`;
  `git diff --check`.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
