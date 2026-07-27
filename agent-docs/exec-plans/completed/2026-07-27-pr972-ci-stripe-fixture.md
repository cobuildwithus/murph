# PR 972 Stripe CI Reconciliation Remediation

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Restore the exact-head hosted PostgreSQL CI proof after the reviewed billing
  branch expanded the canonical Stripe financial-context read contract.
- Preserve the retryable local-owner race and healthy restoration behavior
  required by current `main`.

## Scope

- Keep a Stripe-resolved Subscription whose local billing owner is still racing
  retryable under the existing subscription-identity-pending error.
- Make the canonical member financial-state writer explicitly own billing
  suspension set/clear transitions without weakening external suspension
  fences.
- Update the hosted member-lock PostgreSQL fixture so its Stripe provider stub
  exposes the paid-invoice relationship and healthy recurring state now
  required to resolve and restore a legacy Charge.
- Run the focused PostgreSQL proof, canonical diff verification, and full
  acceptance verification.
- Commit, push, update PR #972's evidence, and monitor the replacement exact
  head.

## Constraints

- Treat the production Invoice, InvoicePayment, Refund, and Dispute reads as the
  source-of-truth contract; do not add a production fallback for an incomplete
  test double.
- Preserve the current-main retryable identity-pending classification while
  the canonical Stripe Subscription exists but its local owner binding has not
  committed yet.
- Keep generic Stripe billing writes from clearing account-deletion suspension;
  only the canonical financial-state caller supplies an explicit billing-owned
  suspension transition.
- Preserve the fixture's existing concurrency interleavings and expected
  restoration states.
- Do not start ReviewGPT round 7 without explicit authorization.
- Keep unrelated worktree and coordination-ledger rows untouched.

## Verification Plan

1. Reproduce the six failing PostgreSQL restoration cases locally against the
   isolated worktree database.
2. Run focused lint/typecheck and the canonical changed-file test lane.
3. Run canonical full acceptance.
4. Inspect the scoped diff, finish the plan, push, and monitor exact-head CI.

## Result

- Reproduced the six hosted PostgreSQL restoration failures against an
  isolated worktree database and confirmed the incomplete Stripe fixture was
  only the first failure boundary.
- Restored the existing retryable subscription-identity-pending classification
  when Stripe has resolved the Subscription but the local owner binding is
  still racing.
- Made canonical financial-state reconciliation explicitly set and clear the
  billing-owned suspension timestamp while preserving the store's external
  suspension fences.
- Extended the hosted PostgreSQL Stripe double with the paid
  Charge-to-InvoicePayment-to-Invoice-to-Subscription relationship and empty
  refund/dispute evidence required by the production reconciliation contract.
- Passed the focused billing event suite (55 tests), the real PostgreSQL
  member-lock suite (14 tests), scoped ESLint, hosted Web prepared typecheck,
  staged diff validation, and the privacy scan.
- Passed canonical changed-file verification in Blacksmith Testbox
  `tbx_01kygz1md0ejeb8zzcy0h4dvrj`
  ([Actions](https://github.com/cobuildwithus/murph/actions/runs/30238512412)).
- Passed full canonical acceptance in Blacksmith Testbox
  `tbx_01kygz67rts0epn3sad3ycxkq1`
  ([Actions](https://github.com/cobuildwithus/murph/actions/runs/30238618416)).
Completed: 2026-07-27
