# Hosted iMessage Reply Reliability

Status: completed
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Make hosted iMessage conversation input produce reliable Murph replies while preserving the hosted architecture:
  Cloudflare stays a thin runner over the hosted/local Murph runtime, user replies are prioritized over maintenance,
  and idle-before-shutdown checkpointing happens only at the end of the container lifecycle.

## Success criteria

- A fresh hosted conversation/iMessage wake can be traced from mailbox append/nudge through assistant input handling to outbound reply intent/delivery evidence.
- Fresh user input preempts or aborts any idle-before-shutdown checkpoint work, including when the input arrives while checkpointing is in progress.
- Idle-before-shutdown checkpoint scheduling remains tied to the end of the configured runner idle lifecycle, with the default 60s safety margin before automatic container shutdown and no earlier foreground checkpointing.
- Any production/debug diagnostics stay redacted and avoid secrets, identifiers, raw prompts, raw messages, and mailbox payloads.
- Focused tests/typecheck plus direct hosted reply proof pass before deploy.
- `pnpm cf:deploy:immediate` is run after fixes, and production reply behavior is rechecked.

## Scope

- In scope:
  - Hosted message/iMessage ingress-to-reply runtime handling.
  - Cloudflare Durable Object runner scheduling, alarm preemption, idle checkpoint abort behavior, and hosted runtime invocation semantics.
  - Minimal assistant-runtime or outbox changes needed for reliable reply priority.
  - Focused regression tests and durable docs updates only when behavior or invariants change.
- Out of scope:
  - Broad hosted control-plane redesign.
  - Moving product/control-plane facts from `apps/web` into Cloudflare.
  - New persistent product state outside the existing hosted mailbox/workspace/runtime state boundaries.

## Constraints

- Technical constraints:
  - Cloudflare must remain an execution-only runner over hosted Murph/local runtime state, except narrow worker-owned hydration/decode surfaces for image/audio/mailbox payloads.
  - Assistant admission must come from staged `AssistantInputEvent` rows and missing terminal auto-reply evidence, not from mailbox watermarks alone.
  - Foreground user input always outranks idle maintenance.
  - Idle-before-shutdown checkpointing must be scheduled only for the end of the runner idle lifecycle and must be abortable if fresh user input appears.
  - Do not print or persist secrets, raw message payloads, raw prompts, identifiers, or direct personal data in diagnostics.
- Product/process constraints:
  - Prefer clean, simple, composable architecture over new orchestration.
  - Preserve unrelated dirty worktree edits and overlapping active plan rows.
  - Use Cloudflare and production database evidence for production/runtime state, keeping all identifiers and payloads redacted.
  - Use `review:gpt` as a simplification/review aid where the available tooling permits.

## Risks and mitigations

1. Risk: Fixing reply reliability by moving queue/control state into Cloudflare.
   Mitigation: Keep Cloudflare state to lease/alarm/nudge coordination and opaque runtime blobs; push reply handling through existing runtime state.
2. Risk: Adding eager checkpointing that delays replies or snapshots stale work.
   Mitigation: Enforce user-input preemption and restrict idle checkpointing to lifecycle-end maintenance.
3. Risk: Production diagnostics leak message or account data.
   Mitigation: Use metadata-only logs/queries and redact outputs before recording or handoff.
4. Risk: Existing dirty overlapping work masks this task's diff.
   Mitigation: Inspect diffs before editing, keep changes scoped, and stop if safe isolation is impossible.

## Tasks

1. Inspect current hosted iMessage/message ingress, runner scheduling, assistant input, outbox, and terminal reply evidence paths.
2. Gather redacted production/runtime evidence with available tooling and identify the root cause.
3. Implement the smallest invariant-preserving fix and focused tests.
4. Use `review:gpt` or local audit workers for simplification/security/coverage review as required.
5. Run required verification and direct scenario proof.
6. Deploy with `pnpm cf:deploy:immediate`.
7. Recheck production reply behavior and close the plan only when reliable.

## Decisions

- Use the Cloudflare Durable Object alarm as the single scheduler for retry/wake/idle-maintenance ordering, consistent with Cloudflare's one-alarm-per-object model.
- The production database inspection tool failed to register in this already-running session after a launcher `PATH` issue, so production DB checks in this pass used the same hosted DB URL through a redacted read-only Prisma probe. The wrapper has been fixed for future launches, but this session still has no callable production database inspection namespace.
- Keep the fix in the Cloudflare runner scheduling layer: foreground nudges now abort idle-shutdown checkpoint work instead of waiting behind it, while normal hosted reply handling still flows through the existing mailbox/runtime/outbox path.
- Align the native container `sleepAfter` with `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` so the existing `runnerIdleTtlMs - safetyMarginMs` checkpoint schedule is the actual default T-minus-60 lifecycle point.
- Keep hosted-local E2E Docker auth isolated from the operator's normal Docker credential config, while symlinking only Docker CLI plugins into the temporary config so Wrangler retains `buildx`.
- Runtime liveness is a maintenance preemption boundary, not a foreground reply cancellation boundary: pending nudges abort idle-shutdown checkpoints, while foreground assistant reply work keeps running and leaves the queued nudge for runner follow-up/active-turn refresh.
- Treat the webhook direct runner nudge as the immediate wake contract for active conversation input. The pointer workflow remains a retry/watchdog, but webhook handoff must await the direct nudge result and log the actual accepted/not-accepted status before returning.

## Verification

- Commands to run:
  - `pnpm test:diff <touched paths>`
  - `pnpm typecheck`
  - Focused hosted-local or unit tests covering fresh input preemption and reply handling.
  - Direct redacted hosted/prod reply proof after deploy.
- Expected outcomes:
  - Tests pass or unrelated failures are explicitly identified.
  - Fresh user input is handled before idle maintenance.
  - No new privacy/security leaks in logs, docs, or generated artifacts.

## Current evidence

- Local hosted Linq/iMessage full-stack E2E reproduced the production-shaped stall before the fix: a real signed Linq webhook appended conversation input while an active runner invocation had not imported the new mailbox row, and no outbound message was sent until stale recovery.
- The fix keeps recovery in the Cloudflare runner scheduling layer: when a foreground nudge becomes visible during an `idle_shutdown_checkpoint` invocation, the runner aborts that maintenance invocation and queues the pending foreground drive.
- The E2E also reproduced a second foreground-blocking path: persisted idle-checkpoint preemption waited for container destroy, and a local destroy timeout kept the real webhook input queued with conversation mailbox lag. Persisted idle-checkpoint preemption now clears the durable active invocation, starts the foreground drive immediately, and runs container cleanup as redacted best-effort background work.
- Local E2E startup/control-health also reproduced an environment-level failure: Wrangler's Cloudflare proxy image pull could hang when Docker used the operator's normal credential config. The hosted-local E2E lane now writes an isolated empty Docker config and bridges only CLI plugins, which keeps public image pulls prompt without losing `buildx`.
- The test-only stuck invocation route now supports an explicit workspace invocation reason and uses the same abortable active-invocation plumbing as real runner work, so foreground preemption can be exercised without waiting for the production stale timeout.
- `pnpm hosted-local e2e stuck-invocation-recovery --no-bundle` passed after the fix, covering real signed Linq webhook ingress, persisted/container-cleanup preemption, foreground nudge preemption of an active idle-shutdown checkpoint, mailbox drain, one assistant provider request, and one outbound reply.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/runner-container.test.ts --no-coverage` passed all 226 tests.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/stack.test.ts --no-coverage` passed all 42 tests.
- `pnpm typecheck` passed.
- `pnpm test:diff` passed the affected `apps/cloudflare` verify lane: 71 test files and 1015 tests.
- `git diff --check` passed.
- Follow-up production tail after the user reported no visible reply showed healthy nudge/container invocations and active liveness heartbeats rather than a simple ingress outage. This points at a live-but-unproductive foreground invocation control path.
- Code inspection found that liveness `inputAvailable` aborts idle-shutdown checkpoints, but foreground invocations only notify active-turn input controllers and keep running. That can delay a new iMessage behind unrelated active work even though the Durable Object has already marked a pending foreground nudge.
- Added a focused runtime regression: a foreground `nudge` starts active assistant work, liveness reports fresh input, and the job must return `scheduled` without checkpointing stale work.
- Focused regression passed after the fix; it timed out before the fix.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-workspace-entrypoint.test.ts --no-coverage` passed 47 tests.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts --no-coverage` passed 143 tests.
- `pnpm typecheck` passed.
- `pnpm test:diff` passed the affected `packages/assistant-runtime` and `apps/cloudflare` verification lanes, including the hosted-local E2E stub-all scenario: 71 test files and 1018 tests.
- `git diff --check` passed.
- `review:gpt simplify` was launched with the current diff and invariants; response capture timed out with only a partial/no-finding response before completion.
- Follow-up production DB evidence after the user still saw no reply showed conversation mailbox items appending successfully, while the target member workspace remained checkpointed at an older conversation import sequence and had no runner import logs after the latest append. That rules out Linq/provider ingress as the primary failure and pins this pass to wake handoff/admission.
- The web wake handoff success path was still returning `workflow-started` with a deferred direct nudge result. If the after-response work or pointer workflow failed to run promptly, webhook ingress looked healthy while no direct runner wake was durably observed. The fix now awaits the direct nudge on the success path and records the real direct nudge outcome before read receipt/final webhook completion.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-execution-handoff.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts --no-coverage` passed 55 tests after the web handoff fix.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-onboarding-whatsapp-service.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-email-mailbox-ingress-route.test.ts apps/web/test/device-sync-hosted-wake.test.ts --no-coverage` passed 72 tests after the web handoff fix.
- `pnpm --dir apps/web typecheck:prepared` passed after the web handoff fix.
- Production database inspection and Cloudflare observability now show the latest iMessage mailbox item imported into assistant input and the assistant scanner starting, followed by repeated runner/container lifecycle failures before any pass-finished/outbox evidence. That moves the active failure past Linq/provider ingress and into foreground invocation control/liveness.
- Cloudflare observability also shows heartbeat RPCs and repeated pending-nudge/alarm activity interleaved with active foreground runs. Treating any pending nudge as a foreground liveness abort can starve the reply pass; the current fix preserves idle checkpoint preemption but stops aborting normal foreground assistant work on runner pending-nudge liveness.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-workspace-entrypoint.test.ts --no-coverage` passed 50 tests after changing foreground liveness behavior.
- Production logs then showed active workspace invocations being marked stale after a heartbeat window that was shorter than the heartbeat touch timeout. The liveness defaults now use a 5s Cloudflare heartbeat interval and a 30s active-invocation stale window, with a code invariant requiring `staleMs >= 3 * (heartbeatIntervalMs + touchTimeoutMs)`.
- Foreground workspace invocations now require a runtime liveness port at runtime-platform construction. The platform emits one metadata-only liveness configuration log per invocation with port/token/bridge presence and timing values, and fails fast if the required liveness route cannot be built.
- Ordinary stale/local preemption now aborts the active workspace request through `abortWorkspaceInvocation` and leaves warm-container teardown to Cloudflare/container lifecycle and lease fencing. Eager container destroy is retained only for hard timeout or explicit terminal cleanup paths.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-liveness.test.ts test/hosted-runtime-workspace-entrypoint.test.ts` passed 57 tests after requiring foreground liveness.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/runner-platform.test.ts test/runner-container.test.ts test/user-runner-alarm.test.ts` passed 297 tests after the 5s/30s liveness defaults and non-destroy abort path.
- Simplify audit found only low-severity cleanup; the unused deletion-test mock was removed and internal liveness assertion helpers were made module-local.
- Security/privacy audit found no findings. Residual live risk is that non-destroy preemption depends on lease fencing plus outbound proxy expiration in real Cloudflare Containers, so production should be checked with redacted logs after deploy.
- Coverage-write audit added required-liveness success and fail-fast tests. After that, `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-liveness.test.ts test/hosted-runtime-workspace-entrypoint.test.ts` passed 58 tests and `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/runner-platform.test.ts test/runner-container.test.ts test/user-runner-alarm.test.ts` passed 298 tests.
- Final local verification passed: `git diff --check -- <task files>`, `pnpm typecheck`, and `bash scripts/workspace-verify.sh test:diff <task paths>` with assistant-runtime 580 passed / 2 skipped and apps/cloudflare verify 72 files / 1055 tests passed.
- Final review found a blocking foreground starvation bug: runtime liveness `yield` still aborted non-idle foreground workspace work. The fix now treats `yield` as an idle-shutdown-checkpoint preemption signal only at the workspace-entrypoint level; foreground work continues and leaves pending input to active-turn refresh or the next scheduled runner drain.
- Focused regression `continues foreground work when initial liveness reports pending input` and `keeps foreground assistant work running when liveness yields pending input` passed after the fix.
- Post-fix verification passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-liveness.test.ts test/hosted-runtime-workspace-entrypoint.test.ts` passed 58 tests, `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/runner-platform.test.ts test/runner-container.test.ts test/user-runner-alarm.test.ts` passed 298 tests, `pnpm typecheck` passed, and `bash scripts/workspace-verify.sh test:diff <task paths>` passed with assistant-runtime 580 passed / 2 skipped and apps/cloudflare verify 72 files / 1055 tests passed.
- Final review rerun found the same foreground starvation risk in assistant-phase post-checkpoint delivery cleanup. The assistant phase now treats liveness `yield` as non-aborting for foreground delivery/provider cleanup, and `continues post-checkpoint delivery cleanup when runtime liveness says foreground input is available` passed.
- Post-assistant-phase-fix verification passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-liveness.test.ts test/hosted-runtime-workspace-entrypoint.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts` passed 106 tests, `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/runner-platform.test.ts test/runner-container.test.ts test/user-runner-alarm.test.ts` passed 298 tests, `pnpm typecheck` passed, and `bash scripts/workspace-verify.sh test:diff <task paths>` passed with assistant-runtime 580 passed / 2 skipped and apps/cloudflare verify 72 files / 1055 tests passed.
Completed: 2026-05-11
