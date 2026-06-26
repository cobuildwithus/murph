# PR 295 ReviewGPT round 10 fixes

## Goal

Resolve the accepted ReviewGPT round 10 finding for hosted Retell phone calls.

Success criteria:

- Omitted `allowTransferToUser` fails closed instead of granting live-transfer
  authority.
- A call brief must explicitly set `allowTransferToUser: true` before the web
  service resolves or passes a verified transfer number.
- Live `ask_murph` consultation ends rather than transfers when transfer
  authority is omitted.
- Focused verification and typecheck pass before pushing and rerunning
  ReviewGPT.

## Constraints

- Keep the existing small primitive set and one-row phone-call model.
- Do not add a transfer policy gateway, approval table, supervisor, queue, or
  new orchestration layer.
- Keep transfer destination server-owned and never model-supplied.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Change the hosted phone-call brief transfer default to fail closed.
2. Add focused contract, service, and consultation regressions for omitted
   transfer authority.
3. Run focused verification, commit, push, and rerun ReviewGPT.

## State

Ready for scoped commit.

## Notes

- Round 10 finding: `allowTransferToUser` defaulted to `true`, so omission
  silently expanded outbound-call approval into live-transfer authority.
- Fixed by changing the hosted phone-call brief schema default to `false`.
- Added regressions proving omitted transfer authority does not resolve a
  verified transfer number and live consultation returns `end_call`.
- Verification passed:
  `pnpm --dir packages/hosted-execution exec vitest run test/phone-calls.test.ts`;
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-routes.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts --no-coverage`;
  `pnpm --filter @murphai/hosted-execution typecheck`;
  `pnpm --filter @murphai/hosted-web typecheck`;
  `pnpm --filter @murphai/assistant-engine typecheck`;
  `pnpm --dir packages/assistant-engine exec vitest run test/assistant-phone-calls.test.ts`;
  `git diff --check`.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
