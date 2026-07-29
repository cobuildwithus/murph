# Reuse explicitly saved cards for usage top-ups

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Stop repeat usage-credit purchases from asking a payer to type the same card
  on every Checkout fallback, while preserving explicit consent and the frozen
  reconstruction contract for existing purchases.

## Success criteria

- New usage-credit Checkout Sessions let the payer explicitly save a payment
  method for future top-ups.
- A uniquely reusable saved card is preferred over a subscription-only default
  for later direct top-up attempts.
- Frozen v1, v2, and v3 purchases reconstruct their original Stripe request
  shapes and card-selection behavior.
- Focused billing tests, the canonical diff/acceptance checks, required review
  passes, and exact-head CI/ReviewGPT gates pass.

## Scope

- In scope: usage-credit Stripe request policy, saved-card selection, focused
  regressions, and the durable billing/security/reliability documentation.
- Out of scope: subscription payment-method management, automatic recharge,
  frontend layout changes, schema changes, or rewriting historical Stripe
  PaymentMethod consent state.

## Constraints

- Technical constraints: Stripe object identifiers remain server-owned; no raw
  card data is stored; purchase request policy is frozen before provider I/O;
  ambiguous card choices continue through Checkout.
- Product/process constraints: use Stripe's explicit save control, preserve
  old idempotent request bodies, avoid overlap with active Settings layout work,
  and complete the billing-sensitive PR review path.

## Risks and mitigations

1. Risk: Changing a frozen Checkout request causes an idempotency mismatch.
   Mitigation: introduce v4 and assert v1-v3 reconstruction separately.
2. Risk: Treating a subscription-limited card as broadly reusable violates the
   payer's display consent.
   Mitigation: prefer only `allow_redisplay=always` cards as the new signal and
   keep ambiguous choices in Stripe Checkout.
3. Risk: Multiple reusable cards create an implicit server-side choice.
   Mitigation: retain the existing unambiguous-default rule and otherwise
   present Checkout.

## Tasks

1. Add failing regressions for v4 Checkout consent and reusable-card priority.
2. Add v4 while preserving v1-v3 request reconstruction and selection.
3. Update the live billing/security/reliability contract.
4. Run scoped and canonical verification plus required reviews.
5. Commit, push, open the PR, and finish exact-head CI/ReviewGPT gates.

## Decisions

- Stripe's `payment_method_save=enabled` owns explicit future-top-up consent.
- Existing `limited` or unspecified PaymentMethods are not upgraded or broadly
  redisplayed by Murph.
- `allow_redisplay=always` is the only new reusable-card priority signal.

## Verification

- Commands to run: focused Vitest for usage-credit purchase/reconciliation,
  apps/web typecheck, `pnpm test:diff`, `pnpm verify:acceptance`, product
  experience review, preliminary completion-specialists ReviewGPT, final
  ReviewGPT, CI, and non-mutating mergeability proof.
- Expected outcomes: v4 requests expose explicit saving, later purchases use a
  unique reusable card, frozen policies remain stable, and all gates pass.
- Completed: focused usage-credit purchase, reconciliation, and Stripe-event
  tests passed (246 tests); prepared web typecheck passed; an isolated Stripe
  test-mode Session accepted the v4 off-session setup, explicit save control,
  and `always` redisplay filter before its test objects were retired; local
  product-experience review returned `NO FINDINGS`.
- Preliminary `completion-specialists` ReviewGPT returned one accepted coverage
  finding: explicitly prove the v4 multiple-reusable-card default branch and
  frozen v3 legacy selection. Its same-thread test-only patch was inspected,
  passed `git apply --check`, and was applied deliberately. The focused service
  suite then passed 132 tests and prepared web typecheck passed again.
- Parent final review re-read the complete source, test, and contract diff after
  that remediation and found no remaining implementation or proof gap. The
  final exact-head ReviewGPT and GitHub CI gates follow plan archival.
- Operator direction: after the local shared-host lane exhausted its ten-minute
  admission window, the user asked to skip the remaining local/remote
  acceptance work and use GitHub CI as the verification gate. The queued
  one-shot Testbox was stopped before execution.
Completed: 2026-07-29
