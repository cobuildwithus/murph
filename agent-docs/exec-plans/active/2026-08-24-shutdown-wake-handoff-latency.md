# Collapse Shutdown Wake Handoff Latency

Status: active
Updated: 2026-08-24

## Goal

Remove the fixed retry delay after an exact runner invocation rejects a wake
during container shutdown, while preserving snapshot completion, the single
write fence, fail-closed cleanup, and current-version replacement.

## Evidence

- A production immediate container rollout sent SIGTERM to a runner shortly
  after a foreground reply completed.
- The shutdown snapshot correctly remained non-preemptible and committed, but
  the exact rejected wake was collapsed into generic `active_child_rejected`.
- The generic 15-second retry fired several seconds after the invocation and
  checkpoint had already settled, delaying replacement startup with no added
  safety.
- `RunnerContainer` already owns the exact invocation result promise and can
  observe its settlement without another timer, protocol field, or state owner.

## Product UX Patch

- A member who messages during a deploy should enter replacement startup as
  soon as the old invocation releases its exact authority.
- Queued successor work and uncertain cleanup must remain fail-closed.
- Consent withdrawal and account deletion must retain exact stop authority and
  serialization.

## Constraints

- Do not let the old runner accept new work after SIGTERM.
- Do not interrupt the shutdown snapshot or clear its write fence early.
- Do not add a scheduler, queue, durable owner, retry protocol, or overlapping
  workspace writer.
- Reuse the existing invocation promise and existing no-child replacement path.

## Plan

1. Teach the exact explicit-rejection branch in `RunnerContainer.wakeRuntime`
   to await the already-owned invocation result within the existing command
   budget.
2. Return the existing no-active-child result only when coordination is empty
   after settlement; retain generic rejection for queued or fail-closed state.
3. Add focused tests for clean settlement and preserved uncertain ownership,
   plus a hosted-local shutdown-checkpoint E2E bound below the generic retry.
4. Run focused Cloudflare tests and typecheck, inspect the diff, then push a
   draft PR for the required specialist and final ReviewGPT gates plus CI.
5. Resolve accepted findings, mark the exact candidate ready, merge, and retire
   the task worktree.

## Verification

- Focused runner-container regression: passed (213 tests).
- Hosted-local shutdown-checkpoint latency scenario: passed; replacement start
  remained below the 10-second bound and the restored reply remained singular.
- Focused Cloudflare typecheck/test selection: passed.
- Preliminary and final ReviewGPT: pending.
- Required exact-head CI: pending.
