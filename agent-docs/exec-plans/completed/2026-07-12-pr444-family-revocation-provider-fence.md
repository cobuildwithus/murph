# PR 444 Family Revocation Provider Fence

## Goal

Close the accepted ReviewGPT finding that Family sponsorship revocation can
commit after the provider-start authority check but before the provider call
begins.

## Constraints

- Keep provider-start authority and sponsorship revocation serialized through
  the existing hosted-member row lock.
- Cover both direct Family member removal and deletion of a Family owner.
- Do not suspend or delete sponsored beneficiary accounts when the owner is
  deleted.
- Preserve canonical member-lock ordering and the existing account-deletion
  fail-closed behavior.

## Working Set

- `apps/web/src/lib/hosted-onboarding/family-plan.ts`
- `apps/web/src/lib/hosted-privacy/account-data-service.ts`
- `apps/web/test/hosted-family-plan.test.ts`
- `apps/web/test/hosted-account-data-service.test.ts`
- `apps/web/test/phone-calls-account-deletion.db.test.ts`

## Verification Plan

- Focused unit tests for direct removal and owner-deletion lock scope/order.
- PostgreSQL barrier coverage proving both revocation paths serialize with the
  provider-start authority transaction.
- Web typecheck and affected-diff verification, run serially.
- Required completion audits followed by the single permitted ReviewGPT rerun
  on the pushed exact head.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
