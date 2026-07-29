# Revalidate billing status before saved-card bind

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Prevent direct saved-card confirmation when the canonical personal or Family
  Subscription becomes terminal without changing its Stripe identifiers.

## Success criteria

- The ephemeral selection proof includes the existing canonical billing
  eligibility and freshness facts needed to identify the same authority.
- Bind-time revalidation under the existing payer lock rejects terminal or
  changed authority even when Customer and Subscription IDs are unchanged.
- Rejected authority verifies cancellation before Checkout and never confirms
  the unbound intent.
- Status changes after a successful bind do not retarget exact-intent recovery.

## Constraints

- Reuse canonical billing snapshots and the existing payer lock.
- Add no persisted version, preference, state owner, queue, or repair path.
- Frozen v1-v3 behavior remains unchanged.

## Tasks

1. [x] Identify the canonical nonterminal/eligible predicate and freshness fact for
   personal and Family billing.
2. [x] Carry those existing facts in the ephemeral v4 billing authority.
3. [x] Revalidate the complete proof before bind.
4. [x] Add personal and Family same-ID status and freshness race regressions.
5. [x] Run focused verification and product re-review.

## Verification

- Focused usage-credit purchase, reconciliation, and Stripe-event Vitest.
- Prepared web typecheck.
- Product-experience re-review.
- Final ReviewGPT round 5, exact-head GitHub CI, and mergeability proof.
- Passed: 150 focused purchase-service tests, including isolated personal and
  Family same-ID status and freshness races.
- Passed: 264 focused purchase, reconciliation, and Stripe-event tests.
- Passed: `pnpm --dir apps/web typecheck:prepared`.
- Passed: scoped ESLint with zero warnings or errors.
- Passed: canonical `pnpm test:diff` owner verification, including 7,411
  hosted-web tests, full-app lint with zero errors, dev smoke, and production
  build.
- Passed: product-experience re-review with `NO FINDINGS`.
- Pending after push: final ReviewGPT round 5, exact-head GitHub CI, and
  mergeability proof.
Completed: 2026-07-29
