# Hosted Runtime Typing Split

## Goal

Extract the hosted channel typing lifecycle out of `packages/assistant-runtime/src/hosted-runtime.ts` so the runtime entrypoint stays focused on orchestration instead of channel transport details.

## Scope

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/typing.ts`
- `packages/assistant-runtime/test/hosted-runtime-runner.test.ts`

## Constraints

- Keep the behavior unchanged for hosted Linq and Telegram typing.
- Keep the refactor narrow to code movement and cleanup only.
- Preserve unrelated in-flight worktree edits.
- Avoid widening the public API surface unless clearly required.

## Plan

1. Move hosted typing start/stop orchestration into a dedicated helper module.
2. Leave `hosted-runtime.ts` responsible for high-level run sequencing only.
3. Keep the existing runner coverage green with minimal test churn.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-runner.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-runtime typecheck`
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
