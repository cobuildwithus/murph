# PR 295 ReviewGPT round 19 fixes

## Goal

Resolve the accepted ReviewGPT round 19 finding for Retell call-analysis result
durability.

Success criteria:

- `call_analyzed` persists the final `HostedPhoneCall` result before attempting
  user notification.
- If notification enqueue fails, Retell replay can retry notification without
  erasing the stored result.
- Duplicate notification attempts remain safe through the existing
  phone-call-result notification key.
- Focused Retell tests and hosted web typecheck pass before pushing and
  rerunning ReviewGPT.

## Constraints

- Do not add a new queue, notification table, or provider-event framework.
- Preserve idempotent result updates and mailbox dedupe keys.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Split `handleRetellCallAnalyzed` into one transaction for result persistence
   and a second transaction for notification append.
2. On analyzed replay where the row is already finalized, retry notification
   append from the stored result.
3. Update focused tests for notification failure and duplicate replay.
4. Run focused verification, commit, push, and rerun ReviewGPT.

## State

Ready to finish.

## Notes

- Round 19 finding: a route/mailbox failure inside the same transaction rolls
  back `analyzedAt` and `resultJson`, risking permanent final-result loss after
  Retell webhook retries expire.
- Verification passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-retell.test.ts --no-coverage`
  - `pnpm --filter @murphai/hosted-web typecheck`
  - `git diff --check`
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
