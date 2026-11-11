# Retain identity columns for deployment-pinned Stripe Workflows

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

Remove the unsafe automatic identity-column DROP from PR #4820 while retaining
the obsolete invite route, service and current Prisma-model deletions.

## Evidence and scope

ReviewGPT found that old Stripe Workflows outlive the ordinary function drain.
Their Prisma full identity read fails with P2022 after contraction; a sixth
attempt poisons the payment receipt and the ordinary cron excludes it. Keep the
physical nullable columns without adding runtime state or retry machinery.
The earlier completed plan is historical; this correction supersedes its
physical-contraction rollout decision.

## Tasks

1. Delete the automatic DROP migration and document the older-workflow settlement gate.
2. Prove the old generated client's failure with dropped columns and compatibility
   with retained columns; verify the current client and relevant auth/billing tests.
3. Update PR evidence, commit and push as Draft. Parent owns final readiness and CI.

## Verification

- Generated the actual Prisma client from base `34d9f4edc1` without changing the
  committed schema. Against the isolated local database with the original DROP
  applied, the existing Pulse Trial paid-conversion PostgreSQL fixture was
  temporarily seeded with five prior attempts. The full identity read raised
  P2022, the paid transaction rolled back, the sixth receipt became poisoned,
  and `reconcileDueHostedStripeEvents` left it excluded. One focused test passed
  these failure assertions. Temporary fixture changes were restored.
- Restored only the three nullable columns in that local database. The same
  base-generated client read a synthetic identity row with all legacy fields,
  committed paid entitlement on attempt six and completed the existing runtime
  wake retry on attempt seven. One focused test passed; fixture edits were restored.
- Regenerated the current Prisma client. With retained columns, current member,
  Telegram, SMS, legacy-projection compatibility and Stripe entitlement PostgreSQL
  suites passed: 5 files, 156 tests. Command: `MURPH_TEST_POSTGRES_CONCURRENCY=1`
  with the isolated local `DATABASE_URL`, then
  `pnpm --dir apps/web test:prepared -- test/better-auth-member-postgres-concurrency.test.ts test/better-auth-telegram-postgres-concurrency.test.ts test/better-auth-sms-postgres-concurrency.test.ts test/invite-phone-code-retirement-postgres.test.ts test/hosted-stripe-webhook-entitlement-postgres.test.ts`.
- `pnpm --dir apps/web test:prepared -- test/hosted-onboarding-stripe-event-reconciliation.test.ts test/hosted-onboarding-stripe-workflows.test.ts test/hosted-onboarding-stripe-webhook-reconciliation.test.ts`: 3 files, 128 tests passed.
- `pnpm --dir apps/web typecheck:prepared`, `pnpm complexity:diff`,
  `pnpm docs:drift` and `git diff --check`: passed. Complexity remains 14 changed
  source files and zero hotspots above 20.
- No runtime retry policy, state or authority changed. No production mutation.
  The physical DROP is deferred until all older applicable Stripe Workflows
  have settled, followed by a separately reviewed contraction and rollback floor.
  Parent owns final exact-head CI and accepted ReviewGPT finding disposition.
Completed: 2026-11-10
