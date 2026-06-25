# PR 295 ReviewGPT round 8 fix

## Goal

Prevent the hosted phone-call start route from clobbering webhook-owned call
state when Retell advances a call before the start path commits its final row
update.

Success criteria:

- Start success writes `providerCallId`/`calling` only if the row is still the
  untouched local `starting` row.
- Start failure writes `failed` only if no webhook has advanced the row.
- Regressions prove webhook-completed rows are not overwritten by late start
  success or late start failure.
- Focused web verification passes before pushing and rerunning ReviewGPT.

## Constraints

- Keep one `HostedPhoneCall` row and the existing webhook result path.
- Do not add locks, queues, event tables, attempts, tasks, supervisors, or a
  generalized state machine.
- Preserve webhook ownership of final result/status.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Add conditional `updateMany` transitions to `createHostedPhoneCall`.
2. Read current row when a conditional transition affects zero rows.
3. Return current mapped start status if webhook state already advanced.
4. Add focused store/race regressions.
5. Run focused verification, commit, push, and rerun ReviewGPT.

## State

Ready for scoped commit.

## Notes

- Round 8 accepted finding: a Retell webhook can recover by metadata and write
  final state before `createHostedPhoneCall` commits success/failure; the start
  path then overwrites that final state back to `calling` or `failed`.
- Fixed by changing start success/failure writes to conditional `updateMany`
  transitions from the untouched `starting` row only. If the transition affects
  zero rows, the service reads and returns the current row without clobbering.
- Verification passed:
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-routes.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts --no-coverage`;
  `pnpm --filter @murphai/hosted-web typecheck`;
  `git diff --check`.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
