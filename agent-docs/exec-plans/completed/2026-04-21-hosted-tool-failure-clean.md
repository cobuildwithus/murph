# Hosted Tool Failure Clean

## Goal

Land the supplied assistant-engine cleanup so bound AI SDK tool failures return structured model-visible results instead of aborting the provider turn, with matching prompt guidance, reliability docs, and regression coverage.

## Scope

- `packages/assistant-engine/src/model-harness.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/test/model-harness.test.ts`
- `agent-docs/RELIABILITY.md`

## Constraints

- Preserve unrelated dirty-tree edits.
- Keep AI SDK tool execution and direct execution on the same result envelope.
- Do not widen into provider retry or same-turn failover behavior.

## Verification

- Apply and inspect the supplied patch.
- Run `pnpm typecheck`.
- Run a truthful assistant-engine coverage lane.
- Run required completion audits before commit.

## State

- Patch applied with one directly coupled runtime-test expectation update for the new structured AI SDK tool output envelope.
- `pnpm --dir packages/assistant-engine test:coverage` passed after the expectation update.
- `pnpm typecheck`, `pnpm --dir packages/assistant-engine typecheck`, and `pnpm test:diff ...` are blocked by an unrelated `packages/core/src/vault-sync.ts` Dirent typing error.
- Required coverage-write and final-review audits completed with no additional changes requested.
Status: completed
Updated: 2026-04-21
Completed: 2026-04-21
