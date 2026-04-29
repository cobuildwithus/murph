# Cloudflare Warm Runner Simplification

## Goal

Remove the avoidable hosted Linq/iMessage lag where a user sends another
message a few seconds after Murph replied and the runner pays a fresh
container-start path.

Success criteria:

- Successful hosted workspace invocations keep the outer Cloudflare runner
  container shell warm until the configured idle lifecycle expiry.
- Each workspace invocation still gets fresh child-process isolation, a fresh
  outbound proxy token, and fresh invocation-local cache/temp roots.
- Failed invocations, failed outbound-handler cleanup, stale warm health, deploy
  smoke, and explicit cleanup still destroy the warm shell.
- The documented target architecture keeps Cloudflare thin: Cloudflare
  supervises the per-user runner and signed callback proxy; local runtime owns
  mailbox import, assistant turns, outbox, and checkpoints.

## Current Problem

`RunnerContainer` configures a 5-minute idle sleep, but the successful invoke
path calls `stopWarmContainer()` in `finally`. That clears the warm control
state and calls `destroy()`, so normal back-to-back messages cold-start the
container despite `sleepAfter = 300s`.

The follow-up architecture problem is separate: when a nudge arrives while a
workspace invocation is active, Cloudflare records a pending nudge and schedules
another alarm instead of signaling the already-running local runtime that
mailbox rows are available.

## Phase 1 Implementation

Scope:

- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- `apps/cloudflare/README.md`
- `agent-docs/operations/verification-and-runtime.md`

Planned behavior:

1. On successful invocation and successful outbound-handler expiration, leave
   the outer runner container running.
2. Continue expiring the invocation outbound proxy mapping after every run so a
   stale child cannot call worker callbacks after completion.
3. Destroy the container when invocation fails, result validation fails,
   outbound proxy expiration fails, warm health is stale, deploy smoke finishes,
   explicit `destroyInstance()` is called, or the Cloudflare container lifecycle
   fires `onActivityExpired()`.
4. Update focused container lifecycle tests from "destroy each successful shell"
   to "reuse successful warm shell, destroy on expiry/failure."

## Phase 2 Target Shape

This is intentionally not part of Phase 1.

Target flow:

```text
iMessage webhook
-> web appends encrypted mailbox row
-> web nudges Cloudflare
-> Cloudflare ensures the per-user warm container is running
-> Cloudflare signals mailbox available
-> local runtime inside the container imports immediately
-> local assistant run-loop handles grouping / active turn / reply
-> local runtime checkpoints encrypted workspace
-> container stays warm until idle lifecycle expiry
```

Cloudflare should not own assistant idle/budget semantics, mailbox import
progress, assistant cursors, outbox truth, or active-turn checkpoints. Those
stay inside the restored local runtime and the encrypted workspace checkpoint.

## Constraints

- Do not add complexity to `packages/assistant-runtime` or
  `packages/assistant-engine` for this Phase 1 hotfix.
- Do not edit the active `apps/cloudflare/src/user-runner.ts` nudge-recovery
  lane in this task.
- Preserve one active workspace invocation per runner container.
- Preserve supervisor-only control token and lease-scoped outbound worker proxy
  behavior.
- Do not log plaintext message content, provider payloads, secrets, local paths,
  or direct personal identifiers.

## Verification Plan

- Focused `RunnerContainer` tests covering warm reuse, activity expiry cleanup,
  failed outbound proxy expiration cleanup, stale warm health cleanup, and
  explicit destroy.
- `pnpm --dir apps/cloudflare test -- runner-container.test.ts`
- `pnpm --dir apps/cloudflare verify`
- `git diff --check`

## Verification Results

- Pass: `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts`
- Pass: `git diff --check -- apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/README.md agent-docs/operations/verification-and-runtime.md agent-docs/exec-plans/active/2026-04-29-cloudflare-warm-runner-simplification.md`
- Pass: `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.workers.config.ts --no-coverage --passWithNoTests`
- Blocked, unrelated: `pnpm --dir apps/cloudflare verify` stops in shared
  Health Commons generation with `Unexpected object indentation` before the
  Cloudflare verification lane.
- Blocked, unrelated: `pnpm --dir apps/cloudflare typecheck` currently stops in
  active assistant-engine provider cleanup fields outside this task.
- Partial, blocked unrelated: the full Cloudflare Node Vitest lane has one
  Health Commons runner-bundle artifact failure from the same indentation
  blocker; the focused runner-container suite passes.
- Review: required security/privacy review and task-finish review found no
  functional blockers.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
