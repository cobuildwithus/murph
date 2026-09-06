# Align Linq admission regression proof

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Outcome

PR #3008 CI exposed stale assertions in three suites outside the original focused suites:
an inactive-access proof required the deleted pre-lock read and repeated route
locks; home-binding proofs required both cleanup updates for empty conflict
sets. A lookup-version repair fixture now supplies a competing pending owner
so its single cleanup assertion exercises an actual conflict. Update only tests, preserving access refresh after the owner lock, ordering
before mailbox append, and the binding's persisted output assertions.

## Verification

Run all three complete affected suites, Web typecheck, diff/privacy checks, and CI.
The production tree remains byte-identical to ReviewGPT round 1's passed head.
Under the review runbook's non-substantive test-only rule, no new review round
is required; the first-reviewed head remains immutable in the PR body.

All 134 tests in the affected suites and Web typecheck pass. Parent review
confirms that the delta changes only regression proof and this plan.
Completed: 2026-09-06
