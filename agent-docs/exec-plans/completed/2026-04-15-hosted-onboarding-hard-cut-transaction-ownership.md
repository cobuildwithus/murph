# Hosted Onboarding Hard-Cut Transaction Ownership

## Goal

Hard-cut hosted-onboarding transaction ownership so workflow entrypoints own transactions directly, mutating helpers require `Prisma.TransactionClient`, query helpers accept read-capable db handles, and the shared `withHostedOnboardingTransaction` pattern is removed from hosted-onboarding domain code.

## Why

- Stripe webhook reconciliation, billing success redirect, invite, and identity flows currently compose public workflow functions that can each open transactions.
- Billing and routing mutators still own transactions internally, which hides transactional scope and makes nested interactive transactions possible.
- The best long-term architecture is explicit transaction ownership at workflow boundaries and tx-only mutators below that boundary.

## Scope

- `apps/web/src/lib/hosted-onboarding/shared.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-*.ts`
- `apps/web/src/lib/hosted-onboarding/billing-success-service.ts`
- `apps/web/src/lib/hosted-onboarding/member-activation.ts`
- `apps/web/src/lib/hosted-onboarding/linq-home-routing.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-member-billing-store.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts`
- `apps/web/src/lib/hosted-onboarding/invite-service.ts`
- `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-member-identity-store.ts`
- focused hosted-onboarding tests under `apps/web/test/**`

## Constraints

- Hard-cut the pattern; do not leave dual transaction-ownership models in place.
- Include `billing-success-service.ts` in the same architecture cut.
- Preserve unrelated dirty files in the worktree.
- Keep external I/O and post-commit effects outside DB transactions.

## Plan

1. Remove transaction ownership from hosted-onboarding mutators and introduce explicit tx-only write helpers where needed.
2. Update Stripe webhook reconciliation and billing-success flows so they own transactions directly and call tx-only helpers.
3. Update invite and identity flows so workflow entrypoints own transactions directly and no longer compose transaction-owning public functions.
4. Remove obsolete shared transaction helper usage from hosted-onboarding modules and update tests.
5. Run focused verification, review diffs carefully, and commit only task files.

## Verification Target

- Focused hosted-onboarding Vitest files covering stripe, billing-success, invite, identity, activation, and shared helpers
- `pnpm --dir apps/web typecheck`
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
