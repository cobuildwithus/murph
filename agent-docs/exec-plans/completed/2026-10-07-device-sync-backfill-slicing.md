# Classify bounded device import yields

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Goal and invariant

Distinguish receipt-capacity yields from foreground preemption in device import
telemetry. Preserve receipt durability bounds, immediate conversation admission,
shutdown, timeouts, and retained work.

## Evidence and owner

Code tracing identifies the workspace system-work owner: its device drain receives
the base runner's canonical receipt-capacity predicate, not the broader system
mailbox completion predicate. The existing cancellation logger calls every
cooperative stop foreground. Private production evidence stays outside this plan.

## Scope and decisions

Carry a finite optional cooperative yield reason alongside the existing predicate
through the system-work, mailbox, event, and device maintenance boundaries. Keep
foreground as the compatibility default. No scheduler, persisted state, threshold,
Temporal, hosted-local scenario, or alert changes. Reuse the existing cancellation
and log owners; add no dependencies or state owner. Additive diagnostic strings
are compatible with existing readers and rollback. No member-facing changelog:
this is internal diagnostic classification only.

## Tasks

1. Completed bounded read-only aggregate diagnosis and cost/backlog assessment.
2. Reproduced the incorrect label in focused synthetic tests.
3. Carried the correct reason from the receipt-capacity owner and updated its docs.
4. Ran focused cancellation/foreground proof, typecheck, drift and complexity.
5. Reviewed the diff and privacy boundaries; archive with the index entry and local commit.

## Verification

- Regression before implementation: the five-case long-backlog test had one
  failure, receiving `foreground` instead of `canonical_receipt_capacity`.
  After implementation all five pass, preserving default foreground, outer
  invocation preemption, timeout, and normal completion behavior.
- The composed live receipt-pressure test passes. Removing only the reason from
  the runtime owner reproduces the same label failure; restoring it passes.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts
  test/hosted-runtime-maintenance.test.ts
  test/hosted-runtime-workspace-entrypoint-system-preemption.test.ts --no-coverage`:
  182 passed, four existing projection failures. Running those four cases with
  all seven changed source files restored to the unchanged base reproduces all
  four failures (two missing projection boundaries and two 60-second timeouts).
  They are logged in Frog `20261007124010-system-mailbox-projection`.
- The focused system-preemption selection `labels live system device receipt
  pressure|checkpoints restored cumulative receipt pressure|foreground wake during
  the initial system fetch|foreground input during a blocked system pass|system
  mailbox admits a due assistant cron` passes all six cases after source restore.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `bash scripts/check-agent-docs-drift.sh`: passed.
- `pnpm complexity:diff`: passed, zero debt or maximum-complexity increase in
  all seven source files. Existing hotspots are untouched apart from diagnostic
  value plumbing; broader refactoring is not justified for this change.
- `git diff --check` and authored-content privacy review: passed.

Local-only delivery excludes push, PR, hosted ReviewGPT, deployment and production
mutations. The broader owner suite remains red for reproduced baseline failures.
No hosted-local E2E scenarios or Temporal behavior changed; murph-cloud release
integration was not run. No model behavior or provider-visible input changed,
so deterministic cancellation and runtime proof are the relevant boundaries.

## Outcome and remaining limits

The observed slicing follows the existing receipt safety bound; the defect fixed
is its misleading foreground label. The alert recommendation is to distinguish
checkpoint-confirmed progressing imports from stalled or failing work, without
blanket-excluding device sync. No alert behavior changed. Exact backlog completion
time and complete Web request cost are unavailable from the inspected aggregate
surfaces. Private evidence and the detailed investigation remain in an ignored
local report, never in this public plan.
Completed: 2026-10-07
