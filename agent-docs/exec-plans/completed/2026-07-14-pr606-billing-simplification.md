# PR 606 Billing Simplification

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

Replace the billing portion of PR 606 with one independently deployable patch
built from current `main`, preserving only the proven legacy synthetic-owned
Family reconciliation repair.

## Success criteria

- An inactive legacy Family Stripe event owned by a synthetic group container
  converges instead of retrying to poison; active legacy groups remain visibly
  failed for one-time operator repair.
- Cleanup cancels the exact subscription and refunds only the exact causal paid
  invoice, with idempotent retry behavior.
- No owner migration, checkout fence, account-deletion scanner, new receipt
  schema, or generic compensation framework.
- The final diff excludes PR history artifacts and unrelated automation/runtime
  changes.
- Target no more than 220 production additions and 260 focused test additions;
  stop and cut scope before exceeding either cap.

## Constraints

- Rebuild manually from current `main`; do not cherry-pick mixed PR 606 commits.
- Reuse the existing Stripe event receipt and immutable event/provider ids.
- Keep this Family-only; do not add Pulse cleanup, a lifecycle manager, queue,
  migration, or state owner.
- Prefer removal of compatibility paths that current data and deployment facts
  no longer require.

## Decisions

- Scope is limited to exact retryable cleanup for inactive synthetic-owned
  Family billing. Already-active legacy groups require a proven, one-time
  operator repair and are explicitly outside this PR.

## Tasks

1. Re-prove the legacy synthetic-owned Family event failure on current `main`.
2. Implement the smallest exact-owner correction and focused regressions.
3. Re-read the diff against the line caps and delete redundant compatibility.
4. Run required verification, coverage, security/privacy, and final review.
5. Finish, push, open a draft PR, and run exact-head ReviewGPT with CI.

## Progress

Now:

- Implementation, focused verification, coverage, security/privacy, and
  simplification audits complete: inactive synthetic-owned events converge,
  while active legacy groups remain visibly failed for operator repair.

Next:

- Parent-agent handoff, scoped commit/PR, CI, and exact-head ReviewGPT.
Completed: 2026-07-14
