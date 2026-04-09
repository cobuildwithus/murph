# Auto-Reply Startup Recovery Plan

## Goal

Recover retry-safe failed assistant auto-replies once when automation starts, without changing the main scan cursor semantics or adding a persistent retry queue.

## Scope

- Add a bounded startup recovery sweep for recent failed auto-reply captures.
- Restrict recovery to cases that are safe to retry and skip ambiguous delivery cases.
- Add focused tests for startup recovery behavior and non-retry cases.

## Constraints

- Keep `autoReplyScanCursor` meaning "consumed" for the normal scan loop.
- Do not introduce new durable retry state or repurpose channel backlog state.
- Avoid duplicate outbound sends by excluding captures with delivery evidence or deferred/completed handling.
- Preserve unrelated dirty worktree edits.

## Verification

- `pnpm --filter @murphai/assistant-engine test -- assistant-automation-runtime.test.ts`
- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm --filter @murphai/assistant-engine test -- assistant-automation-runtime.test.ts -t "retries a recent retry-safe failed auto-reply once on startup"`

## Outcome

- Added `packages/assistant-engine/src/assistant/automation/startup-recovery.ts` to retry only retry-safe failed auto-replies once per automation start.
- Kept the main `autoReplyScanCursor` semantics unchanged and limited recovery to captures at or behind the saved cursor.
- Excluded ambiguous delivery failures, including `delivery.failed` receipt evidence, from automatic recovery.
- Added focused startup-recovery and run-loop tests covering safe replay, unsafe delivery skips, and cursor-boundary protection.

Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
Completed: 2026-04-09
