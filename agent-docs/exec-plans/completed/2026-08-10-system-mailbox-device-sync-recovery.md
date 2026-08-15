# System-mailbox device-sync recovery

Status: completed
Updated: 2026-08-10

## Goal

Recover stranded hosted device-sync work by making `system_mailbox` a bounded,
model-free execution pass that checkpoints its deterministic result and then
rederives the next wake from remaining canonical work.

Success means:

- an imported or already-imported device-sync item can make deterministic
  progress without a provider/model turn;
- a successful checkpoint clears an inherited assistant wake when no current
  source rederives it, while preserving a real remaining device-sync retry;
- fresh conversation input always owns foreground admission and can preempt
  background work before every bounded unit;
- the companion Temporal artifact preserves only the existing pointer-level
  recovery hint until Web proves progress, with bounded backoff when the same
  pointer and workspace version do not advance; and
- the change adds no queue, scheduler, cursor, durable state owner, or
  synchronous hot-reply dependency.

## Evidence

- Current `system_mailbox` execution imports the system lane and returns before
  invoking the existing deterministic item lifecycle.
- Its initial checkpoint can retain the restored workspace wake, including a
  stale assistant reason, even after the system item that should own progress
  is already present in runtime state.
- Temporal clears the latest mailbox pointer as soon as processing is accepted,
  so an import-only run can remove the only recovery edge before deterministic
  work has checkpointed.
- The runtime already owns prepare, checkpoint, post-checkpoint record, retry,
  and foreground-yield primitives for system-mailbox items; these should be
  composed rather than replaced.

## Invariants

- No new read, await, initialization, checkpoint, reconciliation call, or
  diagnostic write is added to fresh conversation admission or provider start.
- Conversation lag and a newly arrived conversation signal outrank every
  deterministic or scheduled background pass.
- System-only processing must not start Codex, call a model provider, or consume
  AI usage.
- Each pass is finite, uses the existing foreground-yield hook, and leaves
  incomplete work retryable through canonical runtime state.
- Checkpoint publication precedes post-checkpoint acknowledgement or cleanup.
- Wake reasons retain their owning type; device retry work must never be
  reconstructed as a generic assistant wake.
- Temporal remains pointer-only and replay-compatible. Existing patch markers
  are not removed.

## Implementation

1. Inspect the exact-base public runtime and companion Temporal artifacts, then
   apply only the public runtime changes that target this repository.
2. In the public runtime, run one bounded existing-owner system-mailbox item
   lifecycle in `system_mailbox` mode, including already-imported items,
   checkpoint the prepared state, apply the post-checkpoint record, and publish
   a follow-up checkpoint when that record changes pending work or wake state.
3. Rederive the checkpoint wake from current canonical sources so an inherited
   assistant wake survives only when a current assistant source still owns it.
4. Preserve typed device-sync retry reasons across prepare and record failure
   paths.
5. Keep the companion Temporal artifact out of this repository: it targets the
   private orchestrator package, so this checkout can only document that
   cross-repository prerequisite.
6. Update the owning architecture/protocol/reliability documentation and add
   focused public regressions in this repository.
7. Push exact candidate heads, run preliminary specialist and final ReviewGPT
   gates concurrently with required CI, and resolve accepted findings.

## Verification

- Public runtime tests prove imported and already-imported device-sync items run
  model-free, checkpoint before acknowledgement, clear a stale assistant wake,
  retain typed retries, and yield to fresh conversation input.
- A direct foreground-priority proof shows the change adds no work to the hot
  reply branch and a retryable system item cannot starve real replies.
- The companion artifact's private workflow tests cover conversation-first
  ordering, due device-sync mode selection, pointer preservation until observed
  progress, bounded same-pointer/no-version-progress backoff, and
  continue-as-new carry-forward, but they are not runnable from this checkout.
- Run focused affected-package tests and typechecks, exact-head CI, privacy
  scans, and the required ReviewGPT stages for this repository.

## Deployment

Deploy the compatible Temporal admission/backoff change before the public
runtime execution change. An older runtime must remain safe under repeated
system-only admission; after the runtime deploy, re-signal affected pointer-only
work through the existing operator path and verify canonical workspace wake and
mailbox-lag convergence.
Completed: 2026-08-10
