## Goal

Finish the hosted-member privacy cut by replacing the staged greenfield migration train with one clean baseline migration while preserving the already-landed runtime hard cut.

## Success Criteria

- The hosted-member privacy migrations no longer model an additive rollout; one baseline migration creates the split tables, drops dead durable fields, and removes `hosted_session`.
- Tests and proof notes describe the final greenfield shape, not the old staged sequence.
- The `skipIfBillingAlreadyActive` fix remains present in the verified final tree.

## Scope

- `apps/web/prisma/migrations/**`
- `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
- `docs/reviews/hosted-member-privacy-final-proof-2026-04-06.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Greenfield assumption: no existing hosted-member production data to preserve.
- Safe only for databases that have not already recorded the deleted staged hosted-member privacy migration ids; any dev/staging/preview database that applied them must be reset before using the rewritten history.
- Preserve unrelated worktree edits.
- Do not regress the runtime/schema hard cut already landed.

## Verification

- `pnpm --dir apps/web exec prisma format --config prisma.config.ts`
- `pnpm --dir apps/web exec prisma generate --config prisma.config.ts`
- `pnpm exec tsc -p apps/web/tsconfig.json --pretty false`
- `pnpm --dir apps/web lint`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-onboarding-request-auth.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts --no-coverage`
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
