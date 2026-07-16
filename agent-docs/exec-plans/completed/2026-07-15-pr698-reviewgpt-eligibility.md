# PR 698 ReviewGPT Eligibility Fix

## Goal

Preserve the usage-notice deletion while restoring the live allowance-period
eligibility assertion that prevents a stale pre-upgrade notice from claiming
delivery after the member is no longer blocked.

## Constraints

- Do not restore `limitNoticeSentAt`, legacy notice-code keys, or any second
  durable dispatch owner.
- Validate the exact member-period row, current block, and attempted timestamp
  inside the existing serialized delivery-claim transaction.
- Keep current Linq and Telegram target-authority, retry, and provider-ambiguity
  behavior unchanged.
- Add no queue, repair pass, reconciliation loop, compatibility shim, or new
  persisted state.

## Working Set

- `apps/web/src/lib/hosted-execution/usage-limit-notice-claim.ts`
- `apps/web/test/hosted-execution-usage-limit-notice-claim.test.ts`
- `apps/web/test/hosted-onboarding-linq-participant-addition-concurrency.test.ts`
- PR intent/verification metadata

## Verification Plan

- Prove the stale-claim failure first with focused claim and PostgreSQL
  concurrency coverage.
- Run the focused usage-notice, allowance, Linq store, and migration-guard
  suites plus web typecheck and Prisma validation.
- Rerun the required coverage-write audit for the behavior-bearing review fix.
- Push the corrected head, run ReviewGPT correction round 2 concurrently with
  CI, and require a passing review with zero accepted findings.

## Outcome

- The authorized claim now locks and reads the exact allowance-period row and
  declines delivery unless it is still blocked and the attempt is inside the
  persisted half-open period.
- PostgreSQL proof covers a plan-change unblock, a retryable row that must stay
  untouched while ineligible, later genuine-block reuse, and both period
  boundaries.
- Focused verification passed: 244 tests across the affected usage/Linq suites,
  including five opt-in PostgreSQL concurrency cases; web typecheck, Prisma
  validation, migration guard, and diff checks also passed.
- The required coverage-write audit found and filled only the period-boundary
  proof gap; no unresolved actionable findings remain.
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
