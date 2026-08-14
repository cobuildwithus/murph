# junction-default-timeseries-remediation

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Ship Junction's five newly default-on timeseries resources without making
  companion reconnects skip renewed weight history or allowing the larger
  sequential collection fanout to restart forever at the hosted runtime budget.

## Success criteria

- Native exact-source reconnect clears only that source's current weight-history
  coverage in the existing connection mutation transaction.
- Default reconcile/backfill work makes durable bounded progress across the 22
  timeseries resources while preserving the existing job owner, source fences,
  closed-day windows, and last-sync watermark.
- Stale alias tests match the new default resource contract.
- Focused tests, affected package typechecks, exact-head ReviewGPT, and required
  GitHub checks pass.

## Scope

- In scope: the accepted ReviewGPT round-8 reconnect and bounded-progress
  findings, their focused regression tests, the two stale CI assertions, and
  the durable architecture/reliability wording needed by the behavioral fix.
- Out of scope: a new queue/scheduler/state owner, raw dense sample retention,
  unrelated provider pagination redesign, or configurable per-member resource
  selection.

## Constraints

- Technical constraints: keep provider collection sequential; preserve source
  admission and transaction fences; reuse the existing device-sync job and
  continuation contracts; retain compact hourly/daily import shapes; avoid
  network work inside database transactions.
- Product/process constraints: ReviewGPT authors the remediation patch; the
  parent inspects and verifies every hunk; the exact pushed head must clear the
  final PR review gate concurrently with CI.

## Risks and mitigations

1. Risk: a reconnect clears sibling or newer coverage.
   Mitigation: reset inside the exact-source epoch mutation only after the
   already-connected early return and through the existing durable-state fence.
2. Risk: solving the 45-second budget adds another work owner or excessive job
   fanout.
   Mitigation: keep progress in the existing Junction job payload and use a
   deterministic bounded slice with focused abort/retry proof.
3. Risk: partial resource imports incorrectly advance full-sync freshness.
   Mitigation: keep the current full-job continuation watermark behavior and
   test the intermediate and terminal states.
4. Risk: resource-level progress multiplies provider and queue fanout.
   Mitigation: process eight sequential resources per attempt. With the eight
   ordinary summary calls, provider inventory, optional profile request, and
   one timeseries call approaching its 15-second timeout, the ordinary path
   remains below the 45-second hosted budget while reducing continuation jobs
   by roughly eight times versus single-resource progress.

## Tasks

1. Validate the review findings against production configuration and CI output.
2. Ask ReviewGPT for the smallest patch that fits the existing owners.
3. Inspect the patch and adjust only proven correctness or repository-contract
   issues.
4. Run focused tests/typechecks, commit with `scripts/finish-task`, push, and
   update PR #1698.
5. Run the exact-head ReviewGPT gate and required GitHub checks; resolve any
   accepted findings before handoff.

## Decisions

- Production uses the checked-in 45-second runner commit timeout; no production
  environment variable or secret overrides it.
- Round 8's native reconnect finding is accepted: the companion `connect` path
  creates a source epoch without the browser path's weight-coverage reset.
- The CI failure is two stale alias expectations caused by making weight,
  active calories, and distance configured defaults; it is not a coverage
  threshold failure.
- A broad scheduler or second retry owner is rejected. The remediation must
  compose with the existing Junction job continuation and durable import path.
- The resource cursor names the next canonical configured resource. Missing or
  invalid cursors restart the current day idempotently at the first resource;
  the cursor remains outside job dedupe identity.
- Full jobs process at most eight configured resources for one closed UTC day
  per attempt. Continuations are immediately available through the injected
  job clock, and partial full jobs preserve `lastSyncCompletedAt`.

## Verification

- Completed local proof: 454 focused Junction provider/config/service/runtime
  tests; 180 companion reconnect and hosted-runtime authority tests; 49
  changelog tests; device-syncd and Web typechecks; `git diff --check`; and a
  changed-file privacy scan.
- Remaining proof: exact-head ReviewGPT and required PR checks.
- Expected outcomes: deterministic progress under the tested budget, precise
  source-scoped reset, no stale alias failures, no type errors, zero accepted
  review findings, and green required checks.
Completed: 2026-08-12
