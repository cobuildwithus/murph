# Diagnose repeated checkpoints with a stale assistant wake

Status: completed
Created: 2026-09-17
Updated: 2026-09-18

## Outcome and invariant

Explain and reproduce repeated idle checkpoints that retain a past assistant
wake despite a future automation deadline. Preserve real queued assistant work,
mailbox receipt ownership, and durable checkpoint ordering. Do not clear a wake
merely because it is old.

## Approach

Use synthetic entrypoint fixtures to isolate pending-wake replacement and
checkpoint rebasing. Inspect candidate sources before changing behavior. If
existing diagnostics cannot distinguish a required queued wake from a retained
projection, extend metadata at the current logger boundary without private
payloads, new state ownership, or unbounded work.

## Verification and completion

Regression proof before correction; focused scheduling/checkpoint tests,
assistant-runtime typecheck, documentation and complexity checks, candidate
review, required ReviewGPT with exact-head CI, and protected deployment proof.
The independent snapshot-resource correction is already merged.

## Bounded investigation result

The synthetic scheduling probe started with a past assistant wake and an empty
mailbox, then returned a future assistant deadline with canonical progress. The
existing entrypoint replaced the wake, checkpointed the future deadline, and
terminated without repeated assistant passes. The focused Vitest probe passed.
It did not reproduce a scheduling defect, so the temporary probe was removed
instead of being presented as a regression fix.

Reading the composed owner shows that the automation deadline is only one wake
candidate. System-mailbox asks, delivery, cleanup, and checkpoint ordering can
retain an earlier obligation. The existing pass log records whether a system
wake exists, but does not identify which candidate wins or whether a checkpoint
barrier retains it. A future reproduction must include those owners; clearing a
past wake solely by age would risk losing valid queued work.

No scheduler, logger, or production state was changed by this investigation.
The independent reviewed snapshot proxy correction addresses a separately proven
failure. The synthetic evidence narrows this follow-up without claiming that
the production wake behavior is repaired. Production rows and identifiers are
excluded from this record.

## Validation and disposition

The temporary scheduling probe passed before any implementation change. The final
tree has no code or configuration delta, so typecheck and complexity checks are
not applicable to this documentation-only closeout. Close the exploratory plan;
retain the unresolved wake-candidate provenance as the next diagnostic question.
Completed: 2026-09-18
