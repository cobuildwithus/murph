# PR 932 Round 17 Deletion Projection

Status: completed

## Goal

Make production account deletion preserve the same member/day signup
suppression projection as terminal provider receipts when deleting group-owned
outreach and its delivery correlations.

## Finding

Round 17 verified the receipt-owned projection but found that group-owner
account deletion can remove a participant's group-aware delivery correlation
without reprojecting that participant's daily marker. The deleted destination
then has no remaining delivery fact or exact group context capable of releasing
suppression.

## Ownership and lock decisions

- Keep `HostedLinqDelivery` as the sole delivery identity and terminal-status
  owner.
- Share the existing live generic/group predicate between receipt failure and
  account deletion; do not add another projection definition.
- Discover affected participant member/day identities before deletion, include
  participant members in the transaction's stable member-lock set, and acquire
  every member lock before the group-outreach drain lock.
- Re-read affected identities under the drain lock. If a newly created delivery
  names a participant outside the prelocked set, fail retryably and let the
  transaction retry rather than acquiring a member lock in reverse order.
- After correlations are deleted, release only markers whose member/day has no
  live generic or group-aware sibling.
- Add no table, attribution field, queue, scheduler, state machine, or
  reconciliation owner.

## Proof

- Reproduce accepted group delivery, group-owner account deletion, delayed
  failure, and ordinary same-day retry through `deleteHostedAccountData`.
- Prove deletion-before-failure and failure-before-deletion converge.
- Preserve suppression when a generic or separate group-aware live identity
  survives.
- Run deletion and receipt transactions concurrently on separate PostgreSQL
  connections and assert completion without deadlock or stale suppression.
- Run focused account-deletion and delivery tests, PostgreSQL proof, canonical
  diff verification, and acceptance verification.

## Evidence

- ReviewGPT round 17 reviewed `88fe002f8f30` and returned one task-scoped
  deletion-owner finding; it otherwise validated both receipt orders,
  sibling-live preservation, buffered consequences, and accepted/delivered
  restoration.
- Exact-head CI passed 27/27 checks before this remediation.
- A focused unit regression failed before the fix because the participant was
  not locked or reprojected.
- Account-deletion, delivery-store, and transport suites: 205 tests passed,
  including retryable unlocked-participant drift.
- PostgreSQL proof: four cases passed, including both terminal receipt orders,
  production account-deletion fallback, sibling preservation, ordinary retry,
  and a two-connection receipt/deletion race that remained blocked on the
  participant lock until the receipt transaction released it.
- Regenerated Web typecheck and targeted lint passed.
- Crabbox acceptance passed on Testbox `tbx_01kygpbfqa82p48392d8ktbkyn`:
  the Web matrix passed 6,842 tests with 179 skipped, the production build
  passed, and both Cloudflare suites passed 1,934 tests.
- Canonical `pnpm test:diff apps/web` passed on Testbox
  `tbx_01kygpvqtgyamyc4fseyhvbvbd`, including Web typecheck, lint, dev smoke,
  the same 6,842-test matrix, and the production build.

Updated: 2026-07-26
Completed: 2026-07-26
