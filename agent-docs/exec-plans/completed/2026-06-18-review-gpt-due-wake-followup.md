# ReviewGPT Due-Wake Follow-Up

## Goal

Close the ReviewGPT findings against the hosted assistant due-wake fix without
adding a new scheduler layer.

Success criteria:

- Background automation scan saturation preserves a lane-owned future retry
  instead of synthesizing an immediate wake for the same deferred candidate.
- A dirty device-sync wake cannot mask an already-due assistant cron wake.
- A transient assistant cron-status read failure is not cached as authoritative
  "no wake" through post-checkpoint reconciliation.
- Assistant cron `nextRunAt` from running jobs is not treated as runnable due
  work when `dueJobs` is zero.
- Focused tests prove each behavior, and the standard repo verification for the
  touched package passes.

## Constraints

- Preserve the runtime invariant that foreground assistant work has priority
  over background device sync and system maintenance.
- Keep changes local to hosted runtime wake projection/phase merge code.
- Do not introduce a new queue, scheduler abstraction, or persisted state.
- Preserve unrelated working-tree edits and active ledger rows.

## Current Findings

- ReviewGPT found four high-severity issues in the previous due-wake fix:
  capped background scans could hot-loop, dirty device-sync could win an equal
  wake over due cron, failed cron-status reads were memoized, and aggregate
  `nextRunAt` was used as proof of runnable work even when only running jobs
  contributed it.

## Verification Plan

- Focused hosted runtime maintenance/workspace assistant phase tests.
- Assistant runtime package typecheck.
- Repo-required verification per `agent-docs/operations/verification-and-runtime.md`.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
