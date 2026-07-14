# Fresh Hosted Input Starvation Fix

## Goal

Ensure a newly accepted hosted conversation message is the causal input for its foreground turn and cannot be starved by older pending backlog.

## Evidence

- Production traces show new messages accepted, signaled, imported, and listed as eligible candidates, followed by `deliveryEffectCount: 0` and no provider start.
- The foreground selector merges old same-conversation pending inputs with fresh inputs, sorts oldest-first, and keeps only one.
- The selected old input already has terminal reply evidence, so the scanner skips it while the fresh input remains pending.

## Constraints

- Keep one causal input per foreground turn.
- Preserve pending backlog for background processing.
- Add no new state, queue, scheduler, service, dependency, or fallback owner.
- Keep current mailbox, write-fence, and provider-claim invariants unchanged.

## Plan

1. Delete foreground pending-backlog merging and select only the oldest fresh input from the current wake.
2. Update focused selector tests to prove old pending input cannot displace a fresh input.
3. Run focused runtime tests, affected typecheck, required reviews, commit to `main`, and immediately redeploy.

## Verification

- Focused hosted turn-input tests.
- Focused hosted workspace assistant-phase tests where practical.
- Assistant-runtime typecheck and `git diff --check`.
- Production trace after deploy showing provider start and accepted delivery for a new message.

## State

Active.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
