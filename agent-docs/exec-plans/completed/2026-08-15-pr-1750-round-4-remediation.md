# PR 1750 round-four authority remediation

Status: completed
Updated: 2026-08-15

## Goal

Close the remaining post-reservation Stripe authority races, keep Portal crypto
outside pooled transactions, and preserve the canonical sponsorship lock order
during account deletion.

## Design

- Reuse direct and Family Checkout attempt revalidation immediately before
  provider entry, at bind, and before returning an existing Session URL.
- Compare bounded lookup-key and claim scalars while owner locks are held; do
  not decrypt billing state in authority transactions.
- Cancel payer sponsorships in their existing beneficiary-first transaction
  immediately after the durable deletion suspension fence, before external
  cleanup begins.
- Add no durable state, queue, lease, scheduler, or reconciliation owner.

## Round-four anomaly retrospective

- The original requirement is one deploy-safe ownership cutover: every legacy
  Stripe mutation must yield to an exact compatibility claim before provider
  entry and before publishing or binding provider state.
- The immutable first-reviewed head had 164 added and 0 deleted authored-source
  lines. The corrected worktree has 978 added and 149 deleted authored-source
  lines; tests moved from 475 added and 0 deleted lines to 2,468 added and 102
  deleted lines. The added source is review-driven boundary coverage across the
  existing direct, Family, Portal, webhook, and deletion owners.
- Round four exposed one original-PR omission—the post-reservation Checkout
  boundaries—and two review-induced issues: a broad Portal crypto read inside a
  pooled transaction and a mixed deletion transaction that violated the
  sponsorship owner's beneficiary-first lock order.
- Continue as one PR. Splitting the correction would deliberately leave one
  legacy writer able to race a claim during the compatibility window. The
  correction adds no schema or lifecycle owner: it reuses exact claim scalars,
  narrows Portal reads, and moves sponsorship cancellation back to its existing
  canonical transaction before external cleanup. Reject a queue, lease,
  reconciler, compatibility state machine, or additional mutation owner.

## Verification

- [x] Reproduce the late-claim Checkout races and sponsorship ordering failure.
- [x] Prove direct and Family claims stop provider entry, bind, and URL return.
- [x] Prove member Portal decrypts only its Customer id and only outside locks.
- [x] Prove sponsorship cancellation commits before external deletion cleanup.
- [x] Run focused tests, real-PostgreSQL proof, Web typecheck, scoped lint, and
      repository billing/docs/privacy gates.
- [ ] Pass exact-head CI and a fresh full ReviewGPT round.
- [ ] Merge the PR and retire the task worktree.
Completed: 2026-08-15
