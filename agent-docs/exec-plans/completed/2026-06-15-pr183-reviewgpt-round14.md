# PR 183 ReviewGPT Round 14

## Goal

Fix the immediate wake/skip loop for idempotent sending rows owned by an older prepared batch.

## Scope

- `packages/assistant-engine/src/assistant/outbox.ts`
- `packages/assistant-engine/src/assistant/outbox/dispatch-state.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- Focused hosted/outbox tests

## Constraints

- Prepared dispatch ownership must be explicit.
- Provider dispatch must require the ownership token.
- Existing sending rows not owned by this batch should not be repeatedly classified as immediately due.

## Verification

- Focused assistant outbox/runtime tests
- `pnpm typecheck`
- `pnpm test:diff` for touched files
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
