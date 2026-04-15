# Hosted Runtime Cleanup Follow-ups

## Goal

Land the remaining composability cleanups around hosted typing and runtime orchestration without changing behavior.

## Scope

- `packages/operator-config/src/telegram-runtime.ts`
- `packages/operator-config/test/runtime-helpers.test.ts`
- `packages/assistant-engine/src/assistant/channels/runtime.ts`
- `packages/assistant-engine/src/assistant/channels/types.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/artifacts.ts`
- `packages/assistant-runtime/src/hosted-runtime/typing.ts`
- Focused touched tests only

## Constraints

- Keep hosted Linq and Telegram typing behavior unchanged.
- Keep local Telegram channel behavior unchanged.
- Preserve unrelated in-flight worktree edits.
- Keep the refactor narrow to shared transport extraction and hosted runtime cleanup.

## Plan

1. Move the raw Telegram typing transport into a shared lower-level helper.
2. Switch assistant-engine and hosted-runtime typing to use that shared helper.
3. Extract the hosted artifact rematerializer helper from `hosted-runtime.ts`.
4. Verify focused tests and commit only the touched paths.

## Verification

- `pnpm verify:acceptance` (fails on unrelated `packages/inbox-services` baseline typecheck errors before reaching this task's surface)
- `pnpm --dir packages/operator-config build`
- `pnpm --dir packages/operator-config exec vitest run test/runtime-helpers.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-channels-runtime.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-runner.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-engine typecheck` (filtered to touched source files; no hits after the final type fix)
- `pnpm --dir packages/assistant-runtime typecheck` (filtered to touched source files and runner test; only pre-existing `test/hosted-runtime-runner.test.ts` baseline hits remain)
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
