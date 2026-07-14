# PR 606 ReviewGPT Round 4 Remediation

## Objective

Prove and resolve the exact-head Round 4 findings without weakening account
deletion, checkout retry, active-turn ordering, or Stripe event ownership.

## Findings To Prove

1. Legacy Stripe discovery must not treat an unavailable client as a successful
   empty scan while the finite compatibility window remains active.
2. A Family Checkout attempt whose exact provider session is proven terminal
   must be retired with a narrow compare-and-set before a retry can reuse it.
3. Active-turn actor admission must bound foreground reads to the requested
   route while preserving the first different-actor ordering barrier.
4. Family and Pulse cleanup receipts should collapse only if one event-owned
   descriptor can delete the duplicated state without broadening policy or
   weakening exact subscription and invoice proof.

## Constraints

- Accept findings only after production-path proof against the current head.
- Prefer deletion, the existing owner lock, and one route-addressable pending
  representation over parallel state or recovery machinery.
- Preserve fail-closed account deletion, fresh provider idempotency after a
  terminal attempt, actor-scoped ordering, durable retry, and exact refund
  causality.
- Keep the active mailbox-ledger lane in mind when editing hosted runtime input
  ownership; its row is advisory rather than exclusive.

## Completion

- Add focused failing regressions before each accepted behavior fix.
- Run affected tests, typechecks, diff-aware verification, required security and
  coverage audits, and the parent final review.
- Commit through `scripts/finish-task`, push the new head, update the PR body,
  and run the next exact-head ReviewGPT round concurrently with CI.

## Disposition

1. Accepted. Account deletion now fails closed when the compatibility-window
   Stripe scan cannot run, including when no persisted billing reference exists.
2. Accepted. Once the exact newly-created Family Checkout Session is proven
   expired, a narrow attempt-and-session compare-and-set retires the attempt so
   a retry receives a fresh provider idempotency key.
3. Accepted with a smaller implementation than the suggested route index. The
   notifier already owns the exact newly-staged input IDs, so active admission
   now carries those IDs through to the input source and reads only that bounded
   set. Initial selection folds the same-route, same-actor prefix already in
   memory and preserves the first different-actor barrier.
4. Rejected after tracing both obligations. Family compensation owns an exact
   subscription cancellation plus optional exact-invoice promotion/refund;
   Pulse loser cleanup owns cancellation only. A shared persisted descriptor
   would require a policy discriminator, nullable invoice state, and generic
   dispatch across reconciliation and deletion while retaining both business
   branches. That renames the duplication instead of deleting it and broadens
   coupling between independent payment policies. The current event-owned
   receipts remain separate and explicit.

The branch also merged the latest `main` TypeScript 7 upgrade before final
verification.

## Verification Evidence

- Hosted web, assistant engine, and assistant runtime typechecks passed on
  TypeScript 7.
- The account-deletion and Family plan suites passed: 169 tests.
- The hosted turn-input suite passed: 13 tests, followed by a focused passing
  initial same-actor-prefix regression added during final proof.
- The active-turn controller suite passed: 17 tests.
- The rapid mailbox staging regression passed with exact notified IDs, and the
  isolated outbox timing test passed.
- Diff-aware verification passed dependency, boundary, hosted runtime,
  Temporal, crypto, log, and affected typecheck stages. Its broad parallel test
  stage exposed one setup-wizard assertion that reproduces unchanged on exact
  `origin/main`; all change-related failures passed after focused correction or
  rerun.
- The independent security/privacy audit found no medium-or-higher findings.
- The coverage-write audit added a concurrent newer-checkout preservation
  regression and found no unresolved proof gap.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
