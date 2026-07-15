# PR 679 round-3 wake ownership correction

## Goal

Preserve a future retry emitted by the current foreground assistant phase across
the complete invocation-local boundary-tail drain, while retaining bounded
pending-index repair for newly arrived foreground input whose only later wake
comes from post-checkpoint maintenance.

## Evidence

- ReviewGPT round 3 traced a reachable `INBOX_NOT_INITIALIZED` path where the
  first grouped pass preserves its 30-second retry, the immediate local tail
  pass loses the pass-local guard, and complete-index reconciliation replaces
  the phase retry with an unproven immediate wake.
- The outer runtime captured projection evidence for the original 30-second
  wake, so the replacement immediate wake cannot run before the production
  180-second dirty-checkpoint floor.
- The existing workspace-runner regression stops after the first pass and does
  not cover the outer local-tail loop.

## Decisions

1. A non-due assistant wake emitted by the current foreground phase is
   authoritative and pending-index liveness must not replace it.
2. Pending-index reconciliation may fill a missing assistant wake or replace a
   later post-checkpoint assistant wake when foreground work was observed.
3. The complete local boundary-tail drain remains one phase-owned wake interval;
   no new persisted owner, queue, scheduler, lease, or reconciliation path is
   justified.

## Plan

1. Delete the pass-local boundary-tail exception and encode the phase-vs-
   post-checkpoint wake-authority rule in the existing reconciliation function.
2. Add an entrypoint-level regression with a complete index, grouped all-pending
   prefix, boundary tail, real 30-second inbox-bootstrap retry, and the
   production 180-second checkpoint floor.
3. Keep the late-foreground post-checkpoint repair regression green.
4. Run focused and full affected verification, update exact bundle ratchets if
   measured output changes, close the plan, push, and run ReviewGPT round 4 with
   exact-head CI.

## Constraints

- Keep exact replyability and index compaction with their existing maintenance
  owner.
- Preserve product-critical reply, reminder, batching, and durability flows.
- Add no state owner, queue, scheduler, manager, or compatibility layer.
- Preserve unrelated working-tree and ledger changes.

## State

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
