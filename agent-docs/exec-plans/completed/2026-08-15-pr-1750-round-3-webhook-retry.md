# PR 1750 round-three webhook retry remediation

Status: completed
Updated: 2026-08-15

## Goal

Keep accepted Stripe webhook receipts retry-owned while a transient Family
effect claim blocks their direct-member billing projection, then replay the
same receipt normally after the claim becomes terminal.

## Design

- Distinguish `stripe_effect` from settled Family billing authority at the
  existing shared Stripe-event classifier.
- Raise the existing exact `HOSTED_STRIPE_EFFECT_PENDING` error there.
- Keep that exact error non-poisoning in the existing `HostedStripeEvent`
  failure owner; add no state, queue, scheduler, lease, or reconciliation owner.
- Document generic Stripe reconciliation as an intentionally claim-aware
  compatibility surface.

## Verification

- [x] First reproduce the current completed-without-write receipt failure.
- [x] In real PostgreSQL, prove a claim leaves the receipt failed/retryable and
  the direct billing projection unchanged, then clear the claim and prove the
  same receipt writes `past_due` and completes. The proof starts at attempt six
  to verify the pending claim remains non-poisoning.
- [x] Run local focused tests, the real-PostgreSQL suite, Web typecheck, scoped
  lint, and billing/docs/schema gates. Proof is green: 447 focused tests, 33
  real-PostgreSQL tests, and 1,026 broader compatibility tests.
- [x] Pass privacy and diff gates.
- [ ] Pass exact-head CI and a fresh full ReviewGPT round.
- [ ] Merge the PR and retire the task worktree.
Completed: 2026-08-15
