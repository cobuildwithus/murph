# Recover safely from transient database disconnects

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal and scope

Extend the existing Web database retry owner to recover from a transient closed
connection without replaying a possible write. No new retry layer, pool,
configuration, dependencies, schema, or durable state.

## Product UX

- Outcome: eligible reads and transaction setup recover from one brief disconnect.
- Reaches: Web reads and hosted background work using the shared Prisma owner.
- Proof: real local PostgreSQL disconnects, successful readback, and no replay
  after callback entry or a potentially committed write.

## Safety decisions

- Match the driver's exact untyped disconnect message in the existing bounded
  classifier; log only the existing allowlisted metadata.
- Reuse the two-attempt limit, jitter, and local-pressure suppression.
- Allow closed-connection replay only for explicit model read operations outside
  transactions and interactive setup before callback entry.
- Exclude raw SQL, model writes, batch transactions, and reads inside transaction
  scope. Carry that scope through the existing transaction wrapper.

## Tasks

1. Add failing regression cases for recovery and replay boundaries.
2. Extend the existing classifier and retry policies; update the owning contract.
3. Run focused unit and real PostgreSQL proof, Web typecheck, and complexity review.
4. Review the final diff, record results, close the plan, and make a scoped commit.

## Verification

- Before implementation, 19 new cases failed on missing disconnect recovery or
  classification; the existing suite passed.
- Focused candidate proof: 89 Prisma owner tests, 11 real PostgreSQL tests,
  and 10 changelog page tests passed (110 total).
- The real adapter/pool recovered startup and established-socket reads, ran an
  interactive callback once after a startup disconnect, and preserved failed
  transaction scope and mixed-batch atomicity. Independent readback proved an
  acknowledged-by-storage write was not replayed after its response was lost.
- Web typecheck and focused ESLint passed. A test-only Promise API mismatch was
  corrected using the repository's existing deferred-promise pattern.
- Complexity guard passed: classifier maximum 34 to 24 and debt 14 to 4.
  The remaining bounded traversal belongs in this owner; another extraction
  would not reduce concepts or improve the current change.
- Product UX: Ready for the bounded recovery promise. No presentation or
  provider-input changes. Public changelog describes recovery without private
  incident details. Production behavior still requires deployment.
- Parent review: no new pool, dependency, configuration, retry layer, or durable
  state; one async transaction scope preserves the public Prisma boundary.
  Existing operation timing, backpressure, retry delay, and attempt bounds remain.
- Implementation is committed in PR #3295. Final PR review and exact-head CI
  remain separate completion gates; no production deployment was performed.
Completed: 2026-09-11
