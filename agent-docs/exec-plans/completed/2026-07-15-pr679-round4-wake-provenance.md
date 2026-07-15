# PR 679 round-4 wake provenance correction

## Goal

Preserve the bounded pending-index repair wake when a foreground assistant pass
also carries an unrelated future workspace reminder, while retaining the
30-second inbox-bootstrap retry and the outer hot-wake optimization.

## Evidence

- ReviewGPT round 4 traced the regression to `postCheckpointWakeMerged`, which
  records only whether a wake changed and cannot prove that the selected wake
  belongs to the current foreground input.
- The foreground phase merges current-input retries with workspace reminders,
  cron, outbox, and cleanup wakes before the runner and outer runtime inspect
  the result.
- An incomplete pending index intentionally requires an inspect-only probe and
  a bounded 30-second maintenance wake; skipping that probe can strand an older
  accepted input until an unrelated reminder.

## Decisions

1. Carry one ephemeral current-input assistant wake through the existing phase
   result; do not infer ownership from wake equality or mutation.
2. Skip the foreground pending-index probe only when the selected non-due
   assistant wake matches that explicit current-input wake.
3. Feed the same provenance into the outer hot-wake gate so both decisions use
   one source of truth.
4. When the runner creates the pending-index repair wake, mark that selected
   wake as invocation-local so it can run before the idle checkpoint floor.

## Plan

1. Extend the runner regression with an incomplete index, a progressed fresh
   input, and an unchanged future reminder; prove the 30-second repair wins.
2. Add an entrypoint regression with older unindexed input A, fresh terminal
   input B, a future reminder, and the production 180-second checkpoint floor.
3. Replace `postCheckpointWakeMerged` and generic phase-wake capture with the
   explicit ephemeral wake provenance.
4. Run focused and full affected verification, bundle ratchets, required
   coverage review, scoped commit, exact-head CI, and ReviewGPT round 5.

## Constraints

- Add no durable state, scheduler, queue, lifecycle owner, or compatibility
  layer.
- Preserve reply, reminder, pending-input, batching, and checkpoint invariants.
- Preserve unrelated working-tree and ledger changes.

## State

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
