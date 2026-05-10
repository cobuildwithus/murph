# Hosted iMessage Reply Reliability

Status: active
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
  - Use Cloudflare docs MCP for current Cloudflare behavior; DB Hub MCP is unavailable in this session unless it appears later.
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
- Treat DB Hub MCP as unavailable until a callable MCP server/tool appears in this session.
- Keep the fix in the Cloudflare runner scheduling layer: foreground nudges now abort idle-shutdown checkpoint work instead of waiting behind it, while normal hosted reply handling still flows through the existing mailbox/runtime/outbox path.
- Align the native container `sleepAfter` with `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` so the existing `runnerIdleTtlMs - safetyMarginMs` checkpoint schedule is the actual default T-minus-60 lifecycle point.

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
- The test-only stuck invocation route now supports an explicit workspace invocation reason and uses the same abortable active-invocation plumbing as real runner work, so foreground preemption can be exercised without waiting for the production stale timeout.
- `pnpm hosted-local e2e stuck-invocation-recovery --no-bundle` passed after the fix, covering real signed Linq webhook ingress, persisted/container-cleanup preemption, foreground nudge preemption of an active idle-shutdown checkpoint, mailbox drain, one assistant provider request, and one outbound reply.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir apps/cloudflare test user-runner-alarm.test.ts` passed all 142 tests.
- `pnpm typecheck` passed.
- `pnpm test:diff` passed the affected `apps/cloudflare` verify lane: 71 test files and 1015 tests.
- `git diff --check` passed.
