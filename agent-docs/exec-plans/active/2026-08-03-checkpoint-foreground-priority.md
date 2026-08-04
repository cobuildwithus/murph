# Checkpoint foreground priority

## Goal

Prevent an unresolved runtime wake from allowing an expired idle checkpoint
deadline to start another snapshot before fresh conversation input is admitted.

Success criteria:

- Reproduce the interrupt, empty foreground probe, retry snapshot ordering.
- Keep the correction inside the existing assistant-runtime checkpoint owner.
- Emit metadata-only evidence when a pre-checkpoint foreground probe finds no
  runnable work.
- Preserve shutdown, provider handoff, and ordinary idle checkpoint behavior.

## Constraints

- The mailbox remains durable truth; runtime wakes remain notifications only.
- Add no queue, scheduler, persisted state, or new cross-service owner.
- Keep diagnostics bounded, redacted, and free of message contents or direct
  identifiers.
- Preserve the hard foreground-reply priority and 180-second quiet window.

## Approach

1. Add focused regression coverage for an interrupted snapshot whose first
   foreground probe finds no conversation work.
2. Re-arm the existing idle checkpoint timer when that unresolved wake is
   retained, using the current timer owner rather than a new retry mechanism.
3. Record one structured, metadata-only probe outcome that identifies the
   request kind, conversation work result, and checkpoint deferral decision.
4. Run focused assistant-runtime tests and typecheck, then complete the normal
   PR review and CI gates.

## State

Implementation complete. Focused reproduction, adjacent checkpoint invariants,
both package typechecks, and the full assistant-runtime and hosted-execution
test suites pass. PR review and exact-head CI remain.
