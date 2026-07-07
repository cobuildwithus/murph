# Linq Typing Continuity

## Goal

Keep hosted Linq typing indicators visible until the outgoing reply supersedes
them. End-of-turn local timer cleanup must always run, but provider typing-stop
must be skipped when the turn has delivered or queued a message to the current
audience. Failed or skipped queued Linq deliveries should best-effort clear the
provider typing indicator.

## Constraints

- No new queue, scheduler, config flag, env var, or channel toggle.
- Preserve delivery egress guards, authority checks, outbox machinery, and
  dispatch modes.
- No `as any` or broad type assertions.
- Leave changes uncommitted in the working tree.

## Plan

1. Trace assistant-engine typing session handles, final delivery outcome kinds,
   and notification/exact-text paths.
2. Add a minimal `providerStop` option that reuses existing teardown logic.
3. Map delivered/sent/queued outcomes to local release without provider stop;
   keep all failed, abandoned, no-reply, and reaction-only outcomes on provider
   stop.
4. Add one hosted-runtime Linq failure/skip cleanup seam for queued deliveries.
5. Extend focused engine/runtime tests and run scoped verification.

## Verification

- `pnpm vitest run --root packages/assistant-engine --config vitest.config.ts --no-coverage test/channel-helpers.test.ts test/assistant-channels-runtime.test.ts test/assistant-delivery-service.test.ts test/assistant-local-service-runtime.test.ts test/assistant-notification-turn-runtime.test.ts` passed.
- `pnpm vitest run --root packages/assistant-runtime --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-callbacks.test.ts` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed after workspace declarations were prepared.
- `pnpm --dir packages/assistant-runtime typecheck` passed after workspace declarations were prepared.
- `pnpm --dir packages/assistant-engine test` failed only in
  `test/assistant-codex-scripted-runtime.test.ts` with `listen EPERM:
  operation not permitted 127.0.0.1`; other files passed.
- `pnpm --dir packages/assistant-runtime test` hit unrelated CLI bridge/runtime
  startup failures, then hung with async rejection warnings and was interrupted.
- `pnpm build:workspace:incremental` prepared declarations, then failed in the
  importers `tsx` helper with sandbox `listen EPERM` on a local IPC pipe.

## State

Implementation complete in dedicated worktree; no commit by user request.
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
