# Bind usage top-ups to the exact billing subscription

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Reuse the card belonging to the exact Murph billing subscription for a
  user-initiated top-up without considering unrelated subscriptions on the same
  Stripe Customer.

## Success criteria

- Family top-ups resolve the exact group billing subscription already owned by
  `HostedAccountGroupBillingRef`.
- Personal top-ups resolve only the matching member billing subscription.
- Group funding remains Customer-scoped because its payer need not have a
  Murph billing subscription.
- A v4 direct attempt uses that exact subscription's explicit default, or its
  inherited Customer default.
- Missing, stale, terminal, customer-mismatched, or unrelated subscription
  identity falls back safely without cross-subscription card selection.
- Frozen v1-v3 behavior remains unchanged.

## Scope

- In scope: current-policy subscription identity resolution, direct saved-card
  selection, focused tests, and matching durable billing contracts.
- Out of scope: schema changes, subscription payment-method management, and
  automatic top-ups.

## Constraints

- Reuse existing billing-reference owners; do not persist a second subscription
  preference on the purchase.
- Stripe remains the card-data owner and the webhook remains the sole grant
  authority.
- Do not guess among unrelated subscriptions.

## Tasks

1. [x] Resolve the exact billing subscription from the persisted purchase target.
2. [x] Restrict v4 card selection to that subscription and its inherited Customer
   default.
3. [x] Add Family multi-subscription, missing-identity, inheritance, and frozen
   policy regressions.
4. [x] Align durable docs and rerun focused verification and product review.

## Verification

- Focused usage-credit purchase, reconciliation, and Stripe-event Vitest.
- Prepared web typecheck.
- Product-experience re-review and final ReviewGPT delta review.
- GitHub CI and mergeability proof.
- Passed: focused purchase, reconciliation, and Stripe-event Vitest, 226 tests.
- Passed: `pnpm --dir apps/web typecheck:prepared`.
- Passed: product-experience re-review with `NO FINDINGS`.
- Pending after the exact head is pushed: final ReviewGPT delta review, GitHub
  CI, and mergeability proof.
Completed: 2026-07-29
