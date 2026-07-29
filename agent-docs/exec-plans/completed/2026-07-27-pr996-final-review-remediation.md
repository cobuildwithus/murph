# PR 996 final-review remediation

Status: completed
Created: 2026-07-27
Updated: 2026-07-26

## Goal

- Resolve the accepted final ReviewGPT findings on PR 996 without changing its
  branch, user-authorized amount model, or webhook-authoritative grant owner.

## Success criteria

- A direct PaymentIntent is confirmed only after the exact intent is bound to
  an active payer's still-created purchase under the payer-row lock.
- A terminal or suspended race leaves the unconfirmed intent canceled and
  cannot consume a later success event without reconciliation.
- The existing payer-owned cancel endpoint can close a sessionless direct
  attempt from any purchase surface without target authority.
- Fulfilled sessionless direct purchases can detach safely during payer account
  deletion while retaining non-secret lookup proof for later refunds/disputes.
- Focused tests, canonical verification, exact-head CI, and delta-only final
  ReviewGPT complete before PR 996 leaves draft.

## Constraints

- Keep one purchase row and the existing Stripe-event reconciler as the only
  durable ambiguity and fulfillment owners.
- Add no schema, queue, scheduler, card store, or parallel cancellation owner.
- Preserve Checkout cancellation and first-time-card fallback behavior.

## Tasks

1. Make the payer lock the direct-intent binding linearization boundary.
2. Extend the existing cancel and account-deletion owners for sessionless
   direct proof.
3. Add focused race, cross-target cancellation, detachment, and payerless
   reversal tests.
4. Run scoped and canonical verification, commit and push, then run final
   ReviewGPT round 2 against only the remediation delta and mark PR 996 ready.

## Outcome

- The payer-row lock is now the linearization boundary for binding an
  unconfirmed direct PaymentIntent. A suspended payer or closed unbound
  purchase cancels the intent without confirming it.
- The existing payer-owned cancel endpoint now handles sessionless direct
  attempts, while preserving succeeded or processing intents for webhook
  reconciliation.
- Fulfilled direct purchases can detach from a deleted payer without inventing
  Checkout proof; retained non-secret PaymentIntent and Charge lookup evidence
  continues to support payerless refund and dispute reconciliation.
- The Settings and cross-target recovery surface exposes direct-payment
  cancellation, with the real shared component represented in the design
  catalog.

## Verification

- Focused Vitest: 3 files, 175 tests passed.
- Web TypeScript 7 typecheck: passed.
- Touched-file ESLint: passed.
- Desktop and mobile design-catalog browser captures: passed.
- `pnpm test:diff apps/web`: passed in Blacksmith Testbox
  `tbx_01kygrts2qdy8twr4qppfswsch`.
- `pnpm verify:acceptance`: passed in Blacksmith Testbox
  `tbx_01kygryw7ys3sfz64x3e9z186c`.
- Final ReviewGPT round 2 and exact-head CI run after the scoped commit so they
  certify the immutable pushed head.
Completed: 2026-07-26
Completed: 2026-07-26
