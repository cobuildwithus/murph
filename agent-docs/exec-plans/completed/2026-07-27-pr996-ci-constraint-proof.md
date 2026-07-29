# PR 996 CI constraint proof

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Make the existing hosted PostgreSQL CI lane execute the detached
  direct-payment migration before asserting its database-only proof.

## Success criteria

- The PostgreSQL usage-credit suite installs the exact checked-in migration on
  its local schema before creating fixtures.
- Valid sessionless fulfilled-payer detachment succeeds.
- Missing PaymentIntent or Charge lookup proof is rejected by PostgreSQL in
  both local migrated-schema verification and the hosted E2E PostgreSQL lane.
- Focused and canonical verification, exact-head CI, and ReviewGPT round 3 pass.

## Constraints

- Do not weaken or conditionally skip either negative database assertion.
- Do not change the hosted E2E schema owner or replace its existing
  `prisma db push` setup.
- Add no production state or runtime behavior.

## Tasks

1. Apply the exact migration in the local-only PostgreSQL suite setup.
2. Rerun focused migrated-PostgreSQL and canonical verification.
3. Close this plan, push the existing PR branch, and rerun exact-head final
   ReviewGPT with CI.

## Outcome

- The local-only PostgreSQL suite now applies the exact checked-in migration
  before any usage-credit fixture, so both Prisma-migrated and db-push schemas
  exercise the same constraint.
- The exact hosted E2E PostgreSQL batch passed from a fresh db-push schema:
  11 files and 39 tests.
- Web typecheck and touched-file ESLint passed.
- Canonical `pnpm test:diff` passed in Blacksmith testbox
  `tbx_01kygz6hw10gcebj2cjrevkdjs`.
- Canonical `pnpm verify:acceptance` passed in Blacksmith testbox
  `tbx_01kygzhpvm4c3pmc1ad497n3ft`.
Completed: 2026-07-27
