# Hosted Mailbox Replay Budget

## Goal

Fix hosted mailbox replay recovery so retained consumed replay rows cannot starve fresh conversation mail after snapshot rollback, and simplify consume-ack bookkeeping by replacing per-row conversation coverage with a session-level assistant-input flag.

## Scope

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- Focused assistant-runtime tests for mailbox import, workspace runner, and workspace entrypoint behavior.

## Constraints

- Preserve foreground conversation priority and fail-closed checkpoint semantics.
- Count every imported mailbox row against the existing bounded budget.
- Do not add a second queue, scheduler, persisted state shape, or compatibility layer.
- Keep consume-ack logic tied to durable local watermarks plus existing pending-input and reply-failure gates.

## Plan

1. Remove the budget `countItem` callback and consumed-row bypass.
2. Replace `conversationCoverage` result/session state with a boolean that records whether any import result produced assistant input ids.
3. Update tests that currently assert replay rows are budget-free.
4. Add regression proof that more than one budget of consumed replay rows checkpoints progress before the fresh tail is processed.
5. Add a checkpoint barrier so replay-only budget progress is durably saved before foreground active-turn wakes can import the fresh tail.
6. Run focused assistant-runtime verification, required audits, final review, and a scoped local commit without pushing or merging.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-mailbox-import.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint.test.ts` passed.
- `pnpm test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/test/hosted-runtime-mailbox-import.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test:smoke` passed.
- Security/privacy review found no medium-or-higher findings.
- Coverage-write found no unresolved proof gaps before the active-wake barrier.
- Deep-review found an accepted active-wake checkpoint-barrier gap; fixed with a replay-only budget-progress early checkpoint and a runtime-entrypoint regression.
- `pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-workspace-entrypoint.test.ts -t "replay budget"` passed after the barrier.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-mailbox-import.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint.test.ts` passed after the barrier.
- `pnpm test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/test/hosted-runtime-mailbox-import.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts` passed after the barrier.
- `pnpm typecheck` passed after the barrier.
- `pnpm test:smoke` passed after the barrier.
- Final coverage-write rerun found no unresolved proof gaps.
- Final deep-review rerun found an accepted budget-boundary replay gap: a consumed replay row that tripped the budget could be skipped without import. Fixed by keeping budget-deferred consumed replay rows pending instead of advancing the watermark, and tightened the e2e regression to prove every consumed replay row is staged before the fresh tail.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts -t "replay budget"` passed after the budget-boundary fix.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-mailbox-import.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint.test.ts` passed after the budget-boundary fix.
- `pnpm test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/test/hosted-runtime-mailbox-import.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts` passed after the budget-boundary fix.
- `pnpm typecheck` passed after the budget-boundary fix.
- `pnpm test:smoke` passed after the budget-boundary fix.
- `git diff --check` passed and the diff privacy scan found no identifier or secret-token matches.
Status: completed
Updated: 2026-06-19
Completed: 2026-06-19
