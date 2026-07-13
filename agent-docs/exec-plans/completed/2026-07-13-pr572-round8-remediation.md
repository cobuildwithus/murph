# PR 572 ReviewGPT round-8 remediation

Status: completed
Created: 2026-07-13

## Goal

Resolve the four substantive rollout and liveness findings from the superseded
exact-head audit without adding another work queue or preference lifecycle.

## Proven failures

- The gate-off web producer emits sparse tone/voice deltas while the supported
  old runtime coalesces preference events as complete snapshots, so a later
  sparse sibling can discard an earlier accepted field.
- The causal-sequence contract migration treats `consumed_at` as system-lane
  completion even though the authoritative completion fact is the lane
  counter's `consumed_seq`.
- The hosted prompt advertises personality commands while the runtime omits the
  accepted-input causal binding, so every advertised mutation fails at the
  bridge while the gate is off.
- A committed Settings mailbox row has no execution owner if its Temporal
  signal fails and the member performs no later action; the durable protocol
  currently documents this as future hardening.

## Scope

- Emit the legacy complete tone/voice snapshot while the web gate is off and
  switch to sparse deltas only after the compatible consumer rollout.
- Preflight legacy preference rows against the system lane watermark and add
  the new-write check `NOT VALID` so handled retained history does not block.
- Install accepted-input causal binding unconditionally in the compatible
  hosted runtime so every advertised conversation command is executable.
- Reuse the existing scheduled Temporal recovery command for a bounded sweep
  of pending preference handoffs. The mailbox row and lane counter remain the
  only work/completion truth.

## Constraints

- No new queue, persisted receipt, lifecycle manager, or wall-clock ordering.
- Preserve sparse causal application after rollout and legacy snapshot
  compatibility before it.
- Keep the recovery scan bounded, idempotent, privacy-safe, and scoped to the
  preference handoff introduced/extended by this PR.
- Do not modify the overlapping assistant prompt/planning lane.

## Verification

- Add focused reproductions for each failure and the corrected behavior.
- Run affected package tests/typechecks, scenario integrity where applicable,
  and serialized diff-aware verification.
- Push a corrected exact head, require green CI, and obtain a new substantive
  clean ReviewGPT audit because this remediation changes PR-specific code,
  tests, config, and durable docs.
Updated: 2026-07-13
Completed: 2026-07-13
