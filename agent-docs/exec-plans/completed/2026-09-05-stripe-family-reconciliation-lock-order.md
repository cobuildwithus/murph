# Stripe Family reconciliation lock order

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Outcome and owner

Remove the reachable owner/beneficiary deadlock between Stripe Checkout expiry
and Family cancellation or account-deletion closure. The existing Stripe
reconciliation transaction boundary selects the first member from the frozen
purchase before acquiring locks. Canonical purchase state stays in PostgreSQL.

## Evidence and correction

PR #2883 round 1 correctly found that the outer Stripe wrapper locks the
beneficiary before the nested Family helper runs. Foreground closure locks the
owner then beneficiary, forming an opposing cycle. The user resumed remediation.
Derive the first lock from the existing frozen Family selector, then revalidate
that selection and the reconciliation version under the member locks. Preserve
beneficiary-first group sponsorship and financial reconciliation. Detached-payer
expiry replay retains its beneficiary owner.

No schema, dependency, queue, retry loop, or new transaction abstraction is
needed. Provider preparation remains outside the transaction; at most two
existing member rows are locked on one connection. Mixed versions retain the
same persisted contract; the deadlock fix takes effect when Web is updated.

## Proof and completion

- Add PostgreSQL proof composing the actual Stripe entrypoint and Family closure
  with independent clients and controlled database lock barriers.
- Assert provider-final release converges once and deletion readiness succeeds.
- Run focused unit tests, PostgreSQL regression, Web typecheck, scoped lint,
  complexity and privacy checks.
- Update the reliability owner, commit the scoped correction, push PR #2883,
  start ReviewGPT round 2 concurrently with required CI, and disposition results.

## Local results

- The two full Stripe/closure PostgreSQL races fail on the paused head with
  PostgreSQL 40P01 deadlock errors and pass with the boundary correction.
- Focused verification: 58 Stripe unit tests and three PostgreSQL concurrency
  scenarios passed. Tests include retryable payer detachment, unchanged release
  on event replay, and deletion readiness plus member/cleanup receipt commit.
- Web typecheck, scoped ESLint, diff/privacy inspection and complexity guard
  passed. The reconciliation owner remains below the complexity threshold.
- Exact-head ReviewGPT round 2 and required CI remain external PR gates.
Completed: 2026-09-05
