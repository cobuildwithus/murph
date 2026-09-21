# Preserve system mailbox handoff during shutdown

Status: active
Created: 2026-09-21
Updated: 2026-09-21

## Outcome and invariant

Container shutdown must checkpoint accepted device work and return a recoverable
handoff without admitting optional projection work or acknowledging unfinished
work. Explicit host aborts and actual checkpoint failures must still fail.

## Architecture and evidence

The system-mailbox runtime already owns preparation, checkpointing, projection,
and recording. Its work-yield predicate omits the separate shutdown signal,
while projection requests use that signal and propagate cancellation as failure.
Correct admission and cancellation at this existing owner; retain the existing
mailbox, checkpoint, projection-stage ownership, and successor wake. Add no
scheduler, persisted state, dependency, or general cancellation abstraction.

## Product UX (Patch)

- Outcome: Device imports resume from saved work after runtime replacement.
- Reaches: System-mailbox device work interrupted before or during projection;
  normal completion, foreground priority, and explicit abort retain their contracts.
- Proof: Synthetic composed checkpoint/restore regression, existing shutdown and
  foreground projection suites, package typecheck, final review, and exact-head CI.

## Failure and compatibility

Do not swallow explicit host aborts or checkpoint errors. Drain owned projection
work before returning. Unfinished recording stays in the checkpoint for the next
invocation. No wire or persisted shape changes; old/new Web and runner remain
compatible, with the correction effective after the runner is replaced.

## Tasks

1. Reproduce shutdown during system-mailbox checkpoint/projection in focused tests.
2. Correct the existing admission/cancellation boundary and prove restored completion.
3. Update the durable contract and member changelog; review complexity and privacy.
4. Run focused tests and typecheck; open the scoped PR and run ReviewGPT with CI.

## Verification

Pending reproduction and implementation. Production rollout is outside this PR task.

### Candidate evidence

Three initial shutdown regressions failed before the fix with the synthetic
shutdown AbortError. Six shutdown cases now pass with and without notifications,
prove owned-work draining, restore checkpoints, finish once, and remain idle
on later restores. Four focused runtime suites pass 129 tests. Runtime typecheck
and complexity guard pass (debt 482, maximum 223, both unchanged). Changelog
validation, external review, and exact-head CI remain pending.
