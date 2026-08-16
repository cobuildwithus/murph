# PR 1750 round-two retrospective remediation

Status: completed
Updated: 2026-08-15

## Goal

Complete the recorded ReviewGPT round-two owner-boundary redesign so every
legacy Stripe admission resolves the complete future claim authority without
path-local partial classifiers or broad presentation projections inside billing
locks.

## Retrospective decision

The first-reviewed head changed authored production/design TypeScript by
+164/-0; round two reviewed +631/-98, with +477/-108 of review-driven change.
The repeated mechanism is partial, admission-specific reconstruction of the
same member/Family claim authority. Continue the indivisible compatibility PR
only by shrinking around the existing authority owners:

- Direct Checkout uses one complete bounded Family-claim authority reader at
  each existing admission and revalidation point.
- Generic Family Portal admission uses a narrow billing-owner reader with no
  roster, invite, private-contact, presentation, or external-key projection.
- No new durable owner, state, lifecycle, queue, lease, fence, migration,
  repair, or reconciliation mechanism is permitted.

The full decision and action-to-claim-owner matrix are recorded in the PR body
before this tactical remediation.

## Verification

- Prove a committed claim-only owner-group row defeats waiting Direct Checkout
  before Stripe Checkout Session creation and terminal claim removal restores
  admission.
- Prove Family Portal pre/post checks have bounded billing-only reads, zero
  private decryptions/external-key calls while locked, exactly one required
  Customer-id decryption outside the transaction, and no URL returned when
  ownership or claim authority changes.
- Run focused tests, the real-PostgreSQL owner/barrier suite, Web typecheck,
  scoped lint, Prisma validation, billing/docs/privacy/diff gates, exact-head CI,
  and a fresh full final ReviewGPT round.

## Progress

- [x] Record the required round-two retrospective and complete action-to-owner
  matrix in the PR body.
- [x] Reproduce the Direct Checkout claim-only owner-group omission.
- [x] Replace the partial Direct Checkout and broad Portal readers at existing
  owner boundaries.
- [x] Run focused and production-faithful proof: 299 focused tests, 32
  real-PostgreSQL lock/barrier tests, 906 broader compatibility tests, Web
  typecheck, scoped lint, Prisma validation, billing guard, docs drift, and docs
  gardening all pass.
- [ ] Commit, push, pass exact-head CI and the next full ReviewGPT round, merge,
  and retire the task worktree.
Completed: 2026-08-15
