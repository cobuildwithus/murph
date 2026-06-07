# Temporal History Idle Rollover

## Goal

Prevent hosted user runtime workflows with large Temporal histories from
parking indefinitely after consuming demand that leads to a signal-only wait.

## Scope

- `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
- Focused hosted user runtime workflow tests

## Constraints

- Keep Temporal workflow state pointer-only.
- Preserve existing patch markers unless a deployment-safe removal path is
  explicitly chosen.
- Do not add a new scheduler, service, or recovery owner.

## State

- `58d331e1c9384d86fdca7aad549b91631931e53d` added history-length
  Continue-as-New rollover plus an unread-demand bypass.
- Review found high-history + pending signal paths that could still park on
  idle or blocked `null` waits.

## Done

- Read required repo routing, hosted runtime, and Temporal docs.
- Confirmed no active Temporal row in the coordination ledger.
- Added a replay-patched post-demand pre-wait Continue-as-New check.
- Added focused regression coverage for idle/null, blocked/null,
  non-retryable Activity signal-only waits, patch-disabled old ordering, and
  post-demand `continueAsNewSuggested()`.
- Woke coalesced duplicate demand signals out of indefinite blocked waits while
  preserving finite blocked retry timers.
- Ran focused package verification successfully after the changes.
- Root smoke passed; root typecheck is blocked by an unrelated current-checkout
  `packages/cli` / `@murphai/exercise-library/runtime` resolution issue.

## Now

- Rerun required verification and follow-up audits after accepted deep-review
  findings.

## Next

- Run final completion review and close the plan with a scoped commit if the
  unrelated ledger row does not block safe staging.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
