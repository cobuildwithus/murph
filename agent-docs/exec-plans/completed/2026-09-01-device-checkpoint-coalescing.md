# Hosted canonical checkpoint coalescing

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Reduce hosted control-plane checkpoint requests produced by background system-mailbox and device-maintenance canonical writes while preserving foreground durability and recovery guarantees.

## Success criteria

- Background canonical writes retain their ordered durable receipts while sharing bounded status checkpoints.
- Eight successful deferred writes force a checkpoint before more work is admitted.
- System-pass completion, yield or preemption, abort or shutdown, and workspace-ownership release flush any remaining committed progress.
- Foreground assistant canonical writes remain immediate.
- Device wake and cadence publication remain checkpoint-gated, and fresh conversation work still preempts background device work.

## Scope

- In scope: the existing hosted workspace checkpoint owner, its deferred canonical-write path, and focused assistant-runtime regressions.
- Out of scope: a second queue, time-based scheduler, schema change, receipt-log redesign, or foreground checkpoint deferral.

## Root-cause evidence

- Background device maintenance currently uses the ordinary canonical-write port, so every successful write performs a workspace status checkpoint even though the runner already owns pass and lifecycle flush boundaries.
- Mailbox import already demonstrates that canonical writes can retain durable receipt ordering while deferring the owning workspace checkpoint.
- The existing checkpoint owner and generation/CAS path are sufficient; request reduction needs a bounded policy at that boundary, not another state owner.

## Plan

1. Apply and parent-review ReviewGPT's bounded coalescing patch against the isolated task worktree.
2. Prove the eight-write bound, remainder and interruption flushes, foreground immediacy, and device wake/cadence behavior with focused tests.
3. Run package typecheck, complexity and diff checks, exact-head CI, final ReviewGPT, and merge.

## Deployment concerns

- The change is confined to the assistant runtime consumed by the Cloudflare runner.
- Old and new runners use the same checkpoint, receipt, and workspace schemas, so no coordinated Web deployment is required.
- Rollback restores per-write background checkpoints without a data or schema migration.

## Verification

- Passed: workspace-runner focused suite (124 tests).
- Passed: system-mailbox, preemption, and wake-gate focused suites (99 tests).
- Passed: assistant-runtime full package suite (2,630 tests passed, 5 skipped).
- Passed: assistant-runtime package typecheck, complexity diff, and `git diff --check`.
- Pending: exact-head required GitHub Actions, final ReviewGPT, and merge.
Completed: 2026-09-01
