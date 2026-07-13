# PR 572 deferred assistant input wake

Status: completed
Created: 2026-07-13

## Goal

Preserve one-input-per-provider-turn causal isolation while ensuring a sibling
input left pending after successful delivery receives a subsequent assistant
wake.

## Evidence

- PR CI reproduced the Telegram completion timeout on the original run, the
  failed-job rerun, and a serialized single-job rerun.
- Each failure showed successful delivery and zero mailbox lag, followed by an
  idle workspace whose persisted assistant wake was already in the past.
- The canonical input selector intentionally admits only one input, while the
  post-delivery wake path only re-reads pending input after a terminal delivery
  failure.

## Scope

- Add a focused regression covering a successful delivery with a sibling input
  still pending after the current input terminalizes.
- Reconcile the canonical pending-input index after every post-checkpoint
  delivery drain, preserving the resulting wake alongside existing cron,
  system-mailbox, outbox, and provider-cleanup candidates.

## Constraints

- Keep the one-input selector and causal owner unchanged.
- Add no queue, manager, reservation, wall-clock ordering, or lifecycle state.
- Preserve non-stale siblings, mailbox terminal handling, and existing wake
  candidate precedence.

## Verification

- Demonstrate the focused regression fails before the runtime correction.
- Run the focused assistant-runtime tests and typecheck, then diff-aware
  verification before commit and push.
- Require a new substantive exact-head ReviewGPT audit after the corrected head
  is pushed because this is a PR-specific source/test change.
Updated: 2026-07-13
Completed: 2026-07-13
