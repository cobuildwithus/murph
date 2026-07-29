# Pulse Trial Customer Lock Scope

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Remove Stripe and hosted-crypto work from the member-locked transaction that
  reserves a Stripe Customer for Pulse Trial Checkout.
- Preserve the existing member billing row as the only durable owner and keep
  the checkout UX and provider idempotency contract unchanged.

## Success criteria

- The reservation path reads or creates the candidate Stripe Customer outside
  a database transaction.
- One short member-locked transaction re-reads current billing state and binds
  the candidate only when no Customer has already won.
- Concurrent callers converge on the member's bound Customer without adding a
  queue, lease, lifecycle state, schema, dependency, or cleanup loop.
- A definitely unbound candidate is deleted after the transaction when account
  deletion, suspension, or a different durable Customer wins the race.
- Focused coverage proves Stripe and hosted-crypto operations cannot execute
  while the member lock is held.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/billing-service.ts`
  - focused hosted billing-service tests
  - current recurring-billing documentation only if the owner contract changes
- Out of scope:
  - auto Pulse Trial enrollment, whose provider-under-lock contract is a
    separate existing instant-start ownership design
  - usage-credit Customer preparation outside this PR's changed surface
  - schema, migrations, UI, Checkout policy, or Stripe product changes

## Constraints

- Stripe's existing member-derived idempotency key remains the duplicate-create
  fence.
- The member billing row remains the single source of truth for which Customer
  wins.
- Eligibility and mutable checkout authority are revalidated by the existing
  downstream checkout-attempt claim after reservation.
- Add no new durable owner, state machine, queue, retry worker, abstraction, or
  dependency.

## Evidence to establish

1. Trace reservation, Customer creation, encryption, binding, and downstream
   checkout-attempt revalidation.
2. Add a regression that fails when provider or hosted-crypto work occurs while
   the transaction/member lock is active.
3. Add or retain deterministic concurrent-winner coverage for the short bind.

## Verification

- Focused hosted billing-service tests.
- `pnpm test:diff` over the touched hosted Web owner and tests.
- `pnpm verify:acceptance`.
- Preliminary completion-specialists ReviewGPT coverage pass.
- Parent final review, final ReviewGPT correction round, exact-head CI, and
  merge-conflict proof.

## Progress

- [x] Re-established the exact PR head and traced the remaining Pulse Trial
  reservation call site.
- [x] Prove the complete reservation/bind ordering and add the focused failing
  regression.
- [x] Implement the smallest outside-transaction provider/crypto preparation
  with a short locked bind.
- [x] Resolve the preliminary specialist's deferred-boundary coverage finding
  and the parent review's definite-unbound Customer cleanup race.
- [x] Complete focused, canonical, and acceptance verification.
- [x] Complete preliminary specialists and parent review.
- [ ] Complete final ReviewGPT, CI, and conflict proof.
Completed: 2026-07-29
