## Goal

Extract the assistant cron food auto-log cluster out of `packages/assistant-engine/src/assistant/cron.ts` into `packages/assistant-engine/src/assistant/cron/food-auto-log.ts` without changing the public cron exports.

## Why

- `cron.ts` currently mixes generic cron authoring/projection with the food-specific projection and execution path.
- The repo seam guidance already identifies the food auto-log cluster as the smallest safe first extraction from this file.
- Smaller scheduling changes should not need to widen into food runtime loaders and executor details.

## Scope

- `packages/assistant-engine/src/assistant/cron.ts`
- `packages/assistant-engine/src/assistant/cron/food-auto-log.ts`
- Focused `packages/assistant-engine/test/**` updates only if the seam move requires them

## Invariants

- Keep the existing public assistant cron exports and behavior unchanged.
- Preserve the current canonical runtime-store hard-cut already in flight in this worktree; do not reintroduce legacy runtime compatibility.
- Avoid widening the change into unrelated assistant-engine runtime or delivery behavior.

## Verification

- `pnpm typecheck`
- `pnpm --dir packages/assistant-engine test:coverage`
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
