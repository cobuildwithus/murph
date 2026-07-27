# Stripe Billing 80/20 Replacement

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Replace the oversized recurring-billing hardening patch with the smallest
  current-main change that preserves the highest-value protections: paid
  authority before entitlement, one accepted Checkout subscription, actionable
  ordinary payment recovery, current-subscription reversal convergence, and
  invoice-visible Family quantity changes.

## Success criteria

- Ordinary card-funded member and Family subscription transitions never grant
  new entitlement before Stripe proves trial or paid authority.
- Concurrent standard subscription Checkout completions converge on one
  accepted subscription without canceling the accepted winner.
- Ordinary authentication or collection-required outcomes return an existing
  Stripe-hosted recovery action instead of remaining indefinitely pending.
- Current-subscription invoice failures, refunds, and disputes preserve the
  existing locked billing cursor and suspension invariants.
- Family quantity mutations produce provider-visible invoice chronology.
- Ambiguous historical funding, multi-allocation, Customer Balance, credit-note,
  and same-second attribution cases fail closed without a new replay engine or
  second billing owner.
- The replacement stays near the intended 20% implementation budget, with
  focused behavior tests instead of exhaustive combinatorial state tables.

## Scope

- In scope:
  - current `apps/web` recurring member and Family billing owners
  - standard subscription Checkout acceptance and loser handling
  - the smallest shared collection-state projection needed by existing callers
  - current subscription/invoice refund and dispute reconciliation
  - Family subscription quantity mutation configuration
  - focused tests and current-state billing documentation
- Out of scope:
  - backward replay across historical invoices or Stripe Customer Balance
  - automated credit-note or multi-payment-allocation restoration
  - encrypted Family invite continuation state
  - exhaustive Stripe schedule or Billing Portal policy validation
  - custom payment UI or a second billing state machine
  - presentation changes unless existing UI cannot expose the retained recovery
    action

## Constraints

- Stripe remains canonical for subscription and payment facts; Postgres remains
  the single Murph projection.
- Existing hosted-member and Family locks remain the only mutation owners.
- Existing paid access must not be degraded merely because a rare historical
  funding shape is ambiguous; new positive entitlement fails closed.
- A non-idempotent Stripe effect that may have started is not blindly retried.
- Preserve unrelated active work, especially the mobile Family settings
  presentation lane.
- Add no dependency or new service, queue, scheduler, or generic billing
  framework.

## Evidence to establish

1. Trace current-main synchronous Checkout, plan-change, Family capacity,
   webhook, refund/dispute, and account-deletion paths.
2. Reproduce only the high-value failures from PR #972 against current main.
3. Prove which current mechanisms already satisfy the desired outcome and
   delete redundant proposed machinery from the replacement design.
4. Compare the final change shape with PR #972 and record the retained and
   deliberately deferred provider cases.

## Verification

- Focused hosted Web tests for each retained failure class.
- `pnpm test:diff` over the touched hosted Web owners.
- `pnpm verify:acceptance`.
- One production-shaped direct scenario using synthetic Stripe objects and the
  real owner boundary; live Stripe test-mode proof when local authentication is
  available.
- Required product-experience review if recovery behavior changes.
- Preliminary completion-specialists ReviewGPT pass, parent final review, final
  PR ReviewGPT gate, and required CI on the exact replacement head.

## Decisions

- Build from current `origin/main`; preserve PR #972 only as review evidence and
  a regression-case source.
- Prefer a small replacement PR over editing or rebasing the oversized branch.
- Treat rare ambiguous tender/history cases as explicit support-required
  outcomes rather than reconstructing provider causality locally.

## Progress

- [x] Traced the current Checkout, webhook/reconciliation, Family ownership,
  capacity-change, and privacy-codec paths from current `origin/main`.
- [x] Added one durable direct-Checkout attempt with intent-bound Stripe
  idempotency and exact-session recovery.
- [x] Added first-winner standard Checkout binding and narrow ordinary-payment
  loser cleanup.
- [x] Made direct Checkout respect active or in-progress Family billing and made
  ordinary Family capacity changes immediately invoice-visible.
- [x] Added focused concurrency, ambiguity, winner/loser, Family, migration, and
  reconciliation tests.
- [x] Proved all 129 migrations on a fresh temporary PostgreSQL database and
  verified all five additive columns before removing the database.
- [x] Passed the exact-state Web diff check: 6,891 tests passed, TypeScript and
  lint passed, dev smoke passed, and the production build passed.
- [ ] Complete the preliminary specialist review and resolve actionable
  findings without rerunning that specialist pass.
- [ ] Run final parent review, acceptance verification, exact-head final
  ReviewGPT, CI, and merge-conflict proof.
