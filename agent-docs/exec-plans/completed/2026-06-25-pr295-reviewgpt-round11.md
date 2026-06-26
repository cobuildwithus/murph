# PR 295 ReviewGPT round 11 fixes

## Goal

Resolve the accepted ReviewGPT round 11 finding for hosted Retell phone calls.

Success criteria:

- A hosted phone call cannot start unless the web control plane can resolve a
  concrete assistant notification route for the final result.
- `call_analyzed` must not commit a terminal analyzed row if result
  notification enqueue cannot resolve or append a deliverable route.
- The fix reuses the existing hosted mailbox notification path.
- Focused verification and typecheck pass before pushing and rerunning
  ReviewGPT.

## Constraints

- Do not add notification task tables, provider event tables, or a phone-call
  supervisor.
- Keep one persisted phone-call row and one result path.
- Prefer fail-closed validation over speculative route persistence unless a
  test proves persistence is necessary.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Factor hosted phone-call result notification route resolution into a small
   reusable helper.
2. Validate a result route before starting Retell.
3. Make webhook result notification enqueue throw on missing/invalid route
   inputs so the transaction rolls back.
4. Add focused service and webhook regressions.

## State

Ready for scoped commit.

## Notes

- Round 11 finding: phone-call finalization could silently skip notification
  when the member no longer resolved to a deliverable route.
- Fixed by requiring a hosted phone-call result notification route before
  Retell start and before committing `call_analyzed`.
- Missing route or invalid result notification input now throws inside the
  webhook transaction, so the terminal analyzed row is not committed silently.
- Verification passed:
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-routes.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts --no-coverage`;
  `pnpm --filter @murphai/hosted-web typecheck`;
  `git diff --check`.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
