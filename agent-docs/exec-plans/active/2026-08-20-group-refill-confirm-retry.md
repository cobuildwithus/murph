# Group refill confirmation retry

Status: active
Created: 2026-08-20
Updated: 2026-08-20

## Goal

Keep a durably bound automatic group-refill PaymentIntent retryable when a
confirmation request fails and a live Stripe re-read proves that no payment
attempt occurred.

## Product UX

- Outcome: automatic $5 group refills recover from transient confirmation
  failures without pausing sponsorship or asking the payer to re-enter payment.
- Reaches: the existing background group-sponsorship refill and payer recovery
  journey.
- Proof: focused state-machine coverage, current-policy saved-method selection
  coverage, exact-head CI, and a redacted live-state walkthrough.

## Constraints

- Preserve the exact frozen purchase, PaymentIntent, idempotency key, billing
  authority, cap, and provider reconciliation owners.
- Retry only when Stripe proves the same intent remains `requires_confirmation`;
  authentication-required and card-failure states retain Checkout recovery.
- Add no queue, persisted state, scheduler, or payment-method fallback.
- Never place member, provider, card, or production identifiers in repository
  artifacts or review packets.

## Tasks

1. [x] Trace the production purchase, Stripe intents and events, current
   sponsorship state, deployed code, and existing tests.
2. [x] Add the smallest retry-preserving correction and focused regression
   coverage.
3. [ ] Run focused tests, typecheck, diff checks, and the Product UX walkthrough.
4. [ ] Commit and push an exact candidate, open a PR, and start the required
   preliminary specialist and final ReviewGPT passes concurrently with CI.
5. [ ] Resolve accepted findings, complete parent review, close this plan with
   `scripts/finish-task`, and prove exact-head CI and mergeability.

## Verification log

- The live automatic intent was created with an attached Apple Pay card and
  future off-session usage, then canceled one second later without a Charge,
  decline, authentication event, or payment-failure event.
- The matching purchase reached `payment_failed`, which rules out the existing
  pre-confirmation authority-expiry branches and matches confirmation recovery
  returning an unchanged `requires_confirmation` intent before cancellation.
- The reliability contract already requires ambiguous confirmation to remain
  bound and retryable. The implementation currently cancels every nonterminal
  post-confirmation-recovery state, while coverage exercises re-read failure but
  not a successful re-read proving the intent is still unattempted.
- The successful recovery Checkout attached a new Apple Pay card to the same
  Customer with future off-session usage. Current sponsorship, cap headroom,
  payer status, beneficiary access, and purchase-state preconditions are valid.
- The focused purchase-service suite passes all 194 tests. Its regression loses
  the first confirm response, re-reads an unchanged intent, preserves the exact
  binding and idempotency key, and succeeds on the next minute attempt without
  creating or canceling an intent.
- Hosted Web typecheck passes after the normal generated-client preparation.
