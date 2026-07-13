# PR 585 Join-Offer Transaction Atomicity

## Goal

Make a changed or revoked join-offer effect fail without committing any group,
join-link, membership, grant, display-name, or join-policy mutation.

## Scope

- Keep group/link preparation and stable-effect preparation inside one existing
  Prisma transaction in `handleHostedRuntimeGroupPostJoinOffer`.
- Add a handler regression that models transaction rollback and proves a
  rejected changed-intent replay leaves the pre-existing authority state intact.
- Preserve provider dispatch and offer binding after the preparation transaction.

## Constraints

- Reuse the current group/offer owners and locks.
- Add no table, queue, scheduler, manager, retry state, or cancellation flow.
- Preserve successful same-intent replay and legacy missing-effect compatibility.

## Verification

- Focused hosted group-tool Vitest.
- Hosted web typecheck and truthful affected verification.
- Required post-fix coverage and security/privacy reviews.
- Final exact-head ReviewGPT round after push.

## Progress

- [x] Reproduced the split-transaction authority mutation from the reviewed path.
- [x] Reordered the existing transaction boundary and added changed-intent and
  revoked-effect rollback coverage.
- [x] Ran focused and owner verification plus fresh coverage and
  security/privacy audits; both audits are clear after one accepted coverage
  finding added the revoked-effect regression.
- [ ] Commit, push, and complete the final ReviewGPT loop.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
