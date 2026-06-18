# PR 212 Idle Checkpoint CI

## Goal

Fix the repeated PR 212 `Telegram + idle checkpoint E2E` failure in the hosted
idle-checkpoint deferred-progress scenario.

## Constraints

- Keep the fix scoped to the PR's hosted runtime mailbox/checkpoint path.
- Preserve runtime-owned idle shutdown checkpoints and foreground wake priority.
- Avoid retry loops, broad timing changes, or new persisted state.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-import.test.ts`
- `apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts`

## Verification Plan

- Focused mailbox import unit test.
- Focused hosted local idle-checkpoint deferred-progress E2E.
- `pnpm test:diff`
- `pnpm typecheck`
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
