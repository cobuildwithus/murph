# Family usage-credit lock ordering

## Outcome

Make every Family usage-credit checkout path acquire the Family owner member
before a distinct beneficiary, matching Family subscription reconciliation, so
the two protocols cannot form a PostgreSQL member-row deadlock.

## Root cause

Family subscription reconciliation locks the owner and then the active roster.
Usage-credit checkout admission and terminal reservation release currently use
the generic beneficiary-first purchase protocol. A checkout for a distinct
Family member can therefore hold the beneficiary while waiting for the owner as
reconciliation holds the owner while waiting for that beneficiary.

## Scope

- Preserve beneficiary-first ordering for hosted-group sponsorship purchases.
- Use owner-first ordering for Family purchase admission and every reservation
  release path that locks both Family member rows.
- Derive terminal-path ordering from the immutable server-built Family target
  marker without adding a database field or a new state owner.
- Add unit order assertions and a real-PostgreSQL opposing-writer regression.
- Update the durable Family billing lock-order contract.

## Load and complexity

The change adds no query fanout, persisted state, retry loop, or dependency.
Each affected transaction still locks at most the same two member rows; only
their acquisition order changes. Family subscription reconciliation remains
bounded by the existing maximum roster size.

## Risks

1. Applying owner-first order to hosted-group sponsorship could create a new
   inversion with its beneficiary-owned ledger protocol. Keep target-kind
   selection explicit and test both branches.
2. A terminal release path could infer a different target than admission.
   Derive the order from the frozen Family return marker and keep malformed or
   legacy non-Family rows on their existing ordering.
3. A mock-only test could miss a real lock cycle. Interleave both transactions
   against PostgreSQL with bounded lock and statement timeouts.

## Verification

- [x] Focused usage-credit and Family unit tests (524 passed).
- [x] Real-PostgreSQL opposing lock-order regression (1 passed).
- [x] Web typecheck and scoped lint.
- [x] Complexity/diff/privacy checks.
- [ ] Exact-head GitHub checks and final ReviewGPT pass.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
