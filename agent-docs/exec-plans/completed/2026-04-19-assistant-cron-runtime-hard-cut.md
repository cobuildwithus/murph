## Goal

Remove the legacy assistant cron runtime-state compatibility layer from `packages/assistant-engine` so the cron path only operates on canonical runtime records.

## Why

- The user confirmed this is a greenfield codebase, so preserving old cron runtime-store shapes is no longer required.
- The current cron flow mixes canonical scheduling/execution with legacy automation and food migration helpers, which obscures the real state machine.

## Scope

- `packages/assistant-engine/src/assistant/cron.ts`
- `packages/assistant-engine/src/assistant/cron/runtime-state.ts`
- Focused `packages/assistant-engine/test/**` updates only where the removed compat surface is covered directly

## Invariants

- Keep the canonical cron runtime-store schema and behavior intact.
- Do not widen the change into unrelated assistant-engine runtime behavior.
- Preserve overlapping worktree edits outside this narrow cron-runtime seam.

## Verification

- `pnpm typecheck`
- `pnpm --dir packages/assistant-engine test:coverage`
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
