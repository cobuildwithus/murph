# PR 295 ReviewGPT round 17 fixes

## Goal

Resolve the accepted ReviewGPT round 17 storage-mode finding for Retell phone
call analysis webhooks.

Success criteria:

- `call_analyzed` never persists a final result unless Retell explicitly reports
  `data_storage_setting: basic_attributes_only` on that payload.
- Existing analyzed-webhook tests use explicit basic storage when finalization is
  expected.
- Focused Retell tests and hosted web typecheck pass before pushing and
  rerunning ReviewGPT.

## Constraints

- Keep the fix fail-closed and simple.
- Do not add a storage-proof table, provider-event framework, or schema field
  unless tests prove the simpler guard is insufficient.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Change the analyzed webhook storage guard to reject missing storage mode.
2. Add/adjust focused tests for missing storage mode and valid explicit basic
   storage.
3. Run focused verification, commit, push, and rerun ReviewGPT.

## State

Ready to finish.

## Notes

- Round 17 finding: recovery paths can set `providerCallId` before
  `call_analyzed`, so accepting missing storage mode on analyzed webhooks is not
  equivalent to durable privacy proof.
- Verification passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-routes.test.ts --no-coverage`
  - `pnpm --filter @murphai/hosted-web typecheck`
  - `git diff --check`
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
