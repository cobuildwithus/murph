# Group refill confirmation retry

Status: completed
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
3. [x] Run focused tests, typecheck, diff checks, and the Product UX walkthrough.
4. [x] Commit and push an exact candidate, open a PR, and start the required
   preliminary specialist and final ReviewGPT passes concurrently with CI.
5. [x] Resolve accepted findings, complete parent review, close this plan with
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
- The focused purchase-service and refill-dispatch suites pass all 211 tests.
  Connection-loss and HTTP 408 regressions lose the first confirm response,
  re-read an unchanged intent, preserve the exact binding and idempotency key,
  stay notification-silent, and succeed on the next minute attempt without
  creating or canceling an intent.
- Hosted Web typecheck passes after the normal generated-client preparation.
- Draft PR #2035 owns the candidate. The existing public sponsorship-payment
  recovery item now includes this refill-retry correction and both contributing
  PRs instead of adding a duplicate changelog outcome.
- The Product UX Patch walkthrough is `Ready`: transient pre-attempt failures
  stay silent and retry in the background, while provider-proven authentication
  or card failures keep the existing payer recovery and group replies remain
  independent of billing-provider latency.
- The combined purchase, dispatcher, Stripe-reconciliation, and changelog run
  passes all 313 tests. Targeted lint, Hosted Web typecheck, and
  `git diff --check` pass, and the candidate contains no generated or binary
  changes.
- The preliminary specialist finding was accepted and resolved by proving the
  exact post-error Stripe re-read count, identity, and ordering. Round 1's
  permanent-rejection finding was accepted and resolved with definitive
  cancellation and recovery coverage.
- Round 2 exposed HTTP 408 and cross-owner classifier coupling. The recorded
  retrospective chose shrinkage: account-deletion replay returned to its
  unchanged policy, while confirmation evidence stayed local to the saved-card
  owner. The valid full-snapshot round 3 used the configured GPT-5.6 Pro model,
  exceeded the five-minute trust floor, and returned `ROUND_OUTCOME: PASS` with
  no findings.
- Required GitHub checks are green on exact head `5d81d8e1e80b`, and
  `git merge-tree --write-tree HEAD origin/main` succeeds against current main.
Completed: 2026-08-20
