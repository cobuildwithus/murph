# Idle checkpoint T-minus-60 lifecycle hardening

Status: completed
Created: 2026-05-10
Updated: 2026-05-10

## Goal

- Make idle-shutdown checkpoints a true near-shutdown maintenance path: they should run only around T-minus 60 seconds before the intended warm-container shutdown window.
- Ensure fresh user input always wins over idle checkpoint work and can never be blocked behind checkpoint cleanup, stale warm-shell control tokens, or container restart bookkeeping.

## Success criteria

- Default idle checkpoint scheduling uses a 60 second safety margin.
- Foreground runtime results do not control idle checkpoint scheduling.
- Deferred foreground progress does not create a 1 second idle checkpoint path.
- A pending or newly arriving nudge clears/defers idle checkpoint work and schedules immediate mailbox drain.
- Idle checkpoint work is interruptible by fresh input before commit, and input runs immediately after any already-entered non-cancellable commit section.
- Warm-shell validation/restart before the workspace request is not recorded as active user work and does not produce `container stopped during active work`.
- Stale control-token or failed warm-health cleanup cannot strand `pending_nudge` with no prompt retry.
- Focused Cloudflare unit tests cover nudge during idle checkpoint scheduling, nudge during checkpoint cleanup, warm-shell 401 restart, and failed destroy/restart recovery.

## Diagnosis

- `HOSTED_EXECUTION_IDLE_SHUTDOWN_CHECKPOINT_SAFETY_MARGIN_MS` defaulted to `0`, so the normal schedule was `runnerIdleTtlMs - 0`.
- `cf:deploy:immediate` now passes `runner_idle_ttl_ms=300000`, so default hosted production behavior is a 5 minute idle checkpoint window.
- `scheduleIdleShutdownCheckpointIfCurrent()` had a deferred-progress fast path that could schedule a checkpoint after `DEFERRED_CHECKPOINT_DRAIN_DELAY_MS` (`1000ms`) when `deferredCheckpointRequired` and an existing workspace wake preempted the normal idle window.
- `deferredCheckpointRequired` was introduced as a dirty-state signal after foreground work intentionally skipped a full/base checkpoint. It became scheduler state, which made quiet maintenance compete with incoming user work.
- Older hard-cut planning already identified `deferredCheckpointRequired` as state that should not survive as a first-class lifecycle concept. The simpler durable rule is to checkpoint every quiet warm container near shutdown rather than ask the runtime whether scheduling is required.
- `RunnerContainer.invokeHostedExecution()` installs active operation state before `ensureContainerReady()`. If warm readiness sees a stale control token or HTTP 401, the restart path aborts the just-recorded active operation and reports active-work container stop before the workspace request began.
- Idle checkpoint cleanup can preserve a stale control token after failed destroy. The next nudge then sees a running shell, fails warm control health, restarts, and can trigger the active-work failure path above.

## Intended invariants

- Idle checkpoint is not a foreground progress mechanism. It is interruptible shutdown-adjacent maintenance.
- Foreground messages never checkpoint.
- After any foreground workspace run leaves a warm container alive and quiet, the Durable Object schedules exactly one idle checkpoint for `container shutdown time - 60s`.
- Runtime foreground results do not report or schedule checkpoint requirements. The DO lifecycle owns checkpoint timing from the warm-container idle TTL.
- At T-minus-60, the DO invokes the runtime with `reason: idle_shutdown_checkpoint`; the runtime snapshots whatever local workspace state exists.
- User input outranks idle maintenance at every point: alarm selection, checkpoint preflight, runtime liveness, snapshot cancellation boundaries, container cleanup, and failure recovery.
- If input arrives before checkpoint starts, cancel/defer checkpoint and run the message.
- If input arrives during checkpoint preflight, restore, or liveness checks, stop the checkpoint path and run the message.
- If input arrives during snapshotting, abort when safe. If the checkpoint already entered a non-cancellable commit section, finish only that section and immediately drain the message afterward.
- If input arrives during cleanup or destroy, pending input owns the next wake and cleanup becomes best-effort.
- Container readiness/cleanup before sending `/internal/workspace-invocation` is startup work, not active workspace work.
- Durable Object state must never require a fresh user message to wait for stale active invocation timeout when no workspace request is actually running.

## Implemented shape

1. Change the worker-env default for `HOSTED_EXECUTION_IDLE_SHUTDOWN_CHECKPOINT_SAFETY_MARGIN_MS` from `0` to `60000`.
2. Update deploy docs/tests to describe T-minus-60 as the default invariant.
3. Schedule idle checkpoint after quiet foreground completion by the normal lifecycle rule: one alarm at `runnerIdleTtlMs - safetyMarginMs`.
4. Delete the deferred-progress 1 second checkpoint path.
5. Remove `deferredCheckpointRequired` as scheduler state. Keep the protocol/storage field as an ignored compatibility bridge for now, clear it on foreground completion, and stop projecting it into status.
6. Stop persisting new `deferred_checkpoint_required` lifecycle decisions. Leave old columns inert until a follow-up schema/protocol cleanup.
7. On nudge, clear pending idle checkpoint metadata before choosing the next wake, and force the next wake to immediate/short nudge retry rather than the checkpoint alarm.
8. During idle checkpoint preflight, stale workspace checks, and due-wake checks, re-check pending input and return/schedule foreground work instead of continuing checkpoint work.
9. During snapshotting, add a clear cancellation boundary: abort if safe; after commit begins, finish the minimal commit section and then schedule immediate message drain.
10. If idle checkpoint cleanup sees pending work after destroy failure, preserve pending nudge and schedule immediate nudge recovery without waiting for stale lease timeout.
11. Keep the workspace invocation abort controller available during startup cancellation, but move `workspaceInvocationActiveOperation`, active-operation storage writes, and runner activity renewal until after `ensureContainerReady()` and outbound handler install succeed.
12. Make warm-shell HTTP 401/control-health failure restart the shell without recording container-stopped active work when no runner request has been sent.
13. Invalidate or avoid reusing ambiguous stale control-token state after failed destroy attempts so the next nudge does not repeat the same warm-health failure path.
14. Do not read web workspace status on the checkpoint scheduling hot path; use the foreground result workspace version as the scheduling fence and validate the workspace/CAS again at due-time preflight.

## Test plan

- `apps/cloudflare/test/env.test.ts`: default safety margin is `60000`.
- `apps/cloudflare/test/deploy-automation.test.ts`: deployment summaries and immediate deploy expectations stay aligned with T-minus-60.
- `apps/cloudflare/test/user-runner-alarm.test.ts`:
  - idle checkpoint due time is `runnerIdleTtlMs - 60000` by default.
  - foreground completion schedules the quiet T-minus-60 checkpoint without consulting runtime dirty-state output.
  - deferred checkpoint progress does not schedule a 1 second checkpoint.
  - nudge clears/deprioritizes pending idle checkpoint and starts/queues nudge drain.
  - nudge during checkpoint preflight/restore/liveness cancels checkpoint and runs foreground work.
  - nudge during idle checkpoint cleanup preserves work and schedules immediate recovery.
- `apps/cloudflare/test/runner-container.test.ts`:
  - warm control-health 401 before runner request restarts shell without active-work stop reporting.
  - failed destroy with stale token does not leave the next nudge stuck behind active invocation recovery.
- If implementation touches `packages/assistant-runtime`, add focused hosted runtime tests for removing/deprecating `deferredCheckpointRequired` and for input arriving during idle checkpoint cancellation boundaries.

## Verification

- Completed:
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-platform --no-coverage test/env.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-platform --no-coverage test/user-runner-alarm.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-platform --no-coverage test/user-runner-status.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-runner --no-coverage test/runner-container.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-deploy --no-coverage test/deploy-automation.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-platform --no-coverage test/env.test.ts test/user-runner-alarm.test.ts test/user-runner-status.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-runner --no-coverage test/runner-container.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-deploy --no-coverage test/deploy-automation.test.ts`
  - `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/hosted-execution-worker-env.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/README.md apps/cloudflare/test/env.test.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/user-runner-status.test.ts apps/cloudflare/test/deploy-automation.test.ts agent-docs/references/hosted-runtime-protocol.md agent-docs/exec-plans/active/2026-05-10-idle-checkpoint-tminus60.md`
    - selected full `apps/cloudflare verify`: 71 test files, 1006 tests passed.
- Because this touches runtime lifecycle and user-message reliability, complete the repo-required completion audit path before final handoff.

## Open questions

1. Resolve in follow-up: remove `deferredCheckpointRequired` from runtime protocol/types after all deployed callers ignore it.
2. Resolve in follow-up: drop `deferred_checkpoint_required` storage columns after protocol cleanup.
3. Runtime cancellation boundary: idle checkpoint can abort before the commit phase; once bundle/CAS commit starts, finish only that critical section and then immediately drain pending input.
4. Resolved: invalidate the container control token whenever destroy is attempted, even if destroy confirmation fails, to avoid reusing a token for an ambiguous shell.
5. Optional follow-up: add a deploy/env guard that rejects production safety margin below `60000` unless an explicit emergency override is set.

## Coordination

- Overlaps active Cloudflare runner work in `apps/cloudflare/src/user-runner.ts`, `apps/cloudflare/src/runner-container.ts`, and Cloudflare tests.
- Existing ledger has a missing-plan row for idle checkpoint deferred progress and a ledger-only active row for hosted nudge container-stop recovery. Coordinate before implementation.
Completed: 2026-05-10
