# PR 225 ReviewGPT Round 2

## Goal

Fix accepted ReviewGPT round 2 findings for PR 225 while preserving the simple hosted/local delivery boundary:

- Identity-less explicit email automation targets are valid only when a hosted queue-only runtime can deliver through its injected email transport.
- Local/default cron validation still requires an email identity for explicit email delivery.
- Legacy queued hosted email thread replies with a persisted subject replay successfully by dropping the stale subject at dispatch.

## Constraints

- Keep the validation surface small and composable.
- Do not add a new queue, sender registry, durable state owner, or compatibility framework.
- Preserve strict subject rejection for new/manual thread-reply delivery intents.
- Preserve unrelated active-plan rows and working-tree changes.

## Files

- `packages/assistant-engine/src/assistant/cron/targets.ts`
- `packages/assistant-engine/src/assistant/cron/execution.ts`
- `packages/assistant-engine/src/assistant/outbox.ts`
- `packages/assistant-engine/test/assistant-cron-runtime.test.ts`
- `packages/assistant-engine/test/assistant-cron-channels-branches.test.ts`
- `packages/assistant-engine/test/assistant-outbox-runtime.test.ts`
- `packages/cli/test/assistant-cron.test.ts`

## Verification Plan

- Focused cron runtime/channel tests.
- Focused outbox runtime test.
- Focused CLI cron test.
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/cli typecheck`
- `pnpm test:diff` scoped to changed files if practical.
- Repo-required audit/review loop as applicable.
Status: completed
Updated: 2026-06-19
Completed: 2026-06-19
