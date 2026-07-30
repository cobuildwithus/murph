# Close exact-subscription payment authority races

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Preserve the exact Murph billing Subscription as the direct-payment authority
  through the existing PaymentIntent bind boundary.
- Never replace an unsupported legacy Stripe default Source with a different
  attached PaymentMethod.

## Success criteria

- An exact Subscription `default_source` opens Checkout instead of charging an
  inherited Customer PaymentMethod.
- A Customer `default_source` prevents group sole-PaymentMethod fallback.
- Personal and Family billing identity is revalidated under the existing payer
  lock before the unconfirmed PaymentIntent is bound or confirmed.
- Authority changes before bind cancel the unbound intent and continue through
  Checkout; changes after bind do not retarget exact-intent recovery.
- Frozen v1-v3 behavior remains unchanged.

## Constraints

- Reuse the billing-reference, payer-lock, purchase, PaymentIntent, Checkout,
  and webhook owners already present.
- Add no persisted preference, queue, lifecycle, or reconciliation mechanism.
- Do not add legacy Source charging; unsupported Source authority fails closed
  to Checkout.

## Tasks

1. [x] Detect explicit Subscription and Customer legacy defaults in v4 selection.
2. [x] Carry an ephemeral exact billing proof into the existing bind transaction.
3. [x] Re-read the current personal or Family billing reference under the payer
   lock before binding.
4. [x] Add focused selection and authority-race regressions.
5. [x] Run focused verification and product re-review.

## Verification

- Focused usage-credit purchase, reconciliation, and Stripe-event Vitest.
- Prepared web typecheck.
- Product-experience re-review.
- Final ReviewGPT correction round and exact-head GitHub CI.
- Passed: focused purchase, reconciliation, and Stripe-event Vitest, 231 tests.
- Passed: `pnpm --dir apps/web typecheck:prepared`.
- Passed: product-experience re-review with `NO FINDINGS`.
- Pending after the exact remediation head is pushed: ReviewGPT, GitHub CI, and
  mergeability proof.
Completed: 2026-07-29
