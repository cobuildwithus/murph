# Hosted Linq Typing Indicator

## Goal

Add immediate Linq typing feedback for hosted inbound Linq messages so users see activity while assistant work is still running, without widening the hosted execution design.

## Scope

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-runner.test.ts`

## Constraints

- Keep the implementation extremely narrow and simple.
- Do not add new persisted state, webhook side-effect kinds, or queue behavior.
- Preserve unrelated in-flight worktree edits.
- Treat Linq typing start/stop as best-effort only.

## Plan

1. Start a Linq typing handle only for hosted `linq.message.received` runs.
2. Keep the handle open across hosted dispatch execution plus post-commit reply draining.
3. Stop the handle in a best-effort `finally` path.
4. Add focused hosted-runtime tests for start/stop behavior and failure tolerance.

## Verification

- Focused `packages/assistant-runtime` Vitest coverage for the hosted runtime runner path
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-runner.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-runtime typecheck`
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
