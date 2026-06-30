# PR 335 Stale Assistant Wake

## Goal

Fix the remaining PR 335 `Linq scheduled reminder E2E` CI failure by preventing a consumed hosted assistant wake from being persisted again after post-checkpoint delivery.

Success criteria:

- The scheduled reminder wake can run after the idle checkpoint and clear when the reminder is delivered.
- Future assistant wakes and explicit cron/outbox/system/provider cleanup wakes are still preserved.
- The fix stays in the smallest owner boundary and does not add a scheduler, queue, or runner-level special case.
- Focused assistant-runtime tests, typecheck, diff verification, and PR CI are green on the pushed head.

## Constraints

- Keep architecture simple and composable; no new state owner or reconciliation loop.
- Preserve post-checkpoint effect invariants: side effects that consume a pending wake must replace stale wake/status before the next durable checkpoint.
- Preserve unrelated working-tree edits and active ledger rows.

## Plan

1. Confirm the failure path from CI logs and local code.
2. Patch assistant post-delivery wake selection to drop only the consumed workspace assistant wake echo.
3. Update focused regression tests for consumed vs explicit wakes.
4. Run focused tests, typecheck, `test:diff`, and diff hygiene.
5. Commit with `scripts/finish-task`, push, and recheck PR CI before restarting ReviewGPT.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts -t "consumed assistant wake|post-delivery cron status|near-due workspace assistant wake echo|due assistant cron wake"` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts -t "services a checkpoint-blocked projected assistant wake after idle checkpointing|post-checkpoint projected wakes wait for the idle checkpoint"` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` passed, including `packages/assistant-runtime` tests and `apps/cloudflare verify`.
- `pnpm typecheck` passed.
- `git diff --check` passed.
Status: completed
Updated: 2026-06-29
Completed: 2026-06-29
