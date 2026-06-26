# PR 295 ReviewGPT round 21 fixes

## Goal

Resolve the ReviewGPT round 21 finding that `call_analyzed` can commit terminal
phone-call state before the result notification wake is durably queued.

Success criteria:

- A new `call_analyzed` finalization and result notification append happen in
  one transaction.
- If notification route resolution or mailbox append fails, the analyzed write
  rolls back and Retell can retry cleanly.
- Duplicate `call_analyzed` deliveries still retry the stable deduped
  notification append.
- Focused Retell webhook tests, web typecheck, and diff checks pass before
  pushing and rerunning ReviewGPT.

## Constraints

- Do not add provider event tables, queues, or a retry subsystem.
- Preserve the existing stable `phone-call-result:<id>` notification dedupe key.
- Keep the fix local to the phone-call result path and focused tests.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Move `appendResultNotification` into the same transaction that performs the
   first successful `call_analyzed` update.
2. Keep duplicate analyzed events idempotent by appending the stored-result
   notification inside the duplicate transaction path.
3. Update tests so notification append failures roll back terminal state.
4. Run focused verification, commit, push, and rerun ReviewGPT.

## State

Ready to finish.

## Notes

- Round 21 found that the previous two-transaction shape depended on a Retell
  retry to repair notification enqueue failures after terminal state committed.
- Verification passed:
  `pnpm --filter @murphai/hosted-web test:prepared -- apps/web/test/phone-calls-retell.test.ts`.
  The command ran the full web Vitest suite under the web workspace config.
- Typecheck passed: `pnpm --filter @murphai/hosted-web typecheck`.
- Whitespace check passed: `git diff --check`.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
