# Raise `@murphai/assistant-cli` top-level runtime seam coverage

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Raise honest package-local coverage for the owned top-level assistant CLI seams without changing runtime behavior.
- Reuse the existing assistant CLI coverage tests and helpers already present in the shared worktree.
- Keep scope limited to `packages/assistant-cli/src/{commands/assistant.ts,run-terminal-logging.ts,index.ts,assistant-runtime.ts,assistant-chat-ink.ts}` plus related tests.

## Success criteria

- `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli typecheck` passes.
- Focused assistant CLI tests covering the owned seams pass locally.
- `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli test:coverage` improves or passes without narrowing `coverage.include`.

## Scope

- In scope:
- `packages/assistant-cli/src/{commands/assistant.ts,run-terminal-logging.ts,index.ts,assistant-runtime.ts,assistant-chat-ink.ts}`
- `packages/assistant-cli/test/**` as needed for those seams
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-assistant-cli-top-level-coverage.md}`
- Out of scope:
- `packages/assistant-cli/src/assistant/ui/**` except `assistant-chat-ink.ts` only if strictly required for seam coverage
- `packages/assistant-cli/src/assistant-daemon-client.ts`
- root config and other packages

## Current state

- Existing shared-worktree coverage tests already target these seams, including untracked `assistant-command-coverage.test.ts` and `assistant-package-surface.test.ts`.
- Known package-wide misses called out by the task are `run-terminal-logging.ts`, `commands/assistant.ts` branch line 216, and zero-coverage entrypoints `assistant-chat-ink.ts` and `index.ts`.
- The package has unrelated dirty test edits that must be preserved.

## Plan

1. Extend the existing command coverage test to hit the remaining owned command branches and outputs.
2. Extend the existing logging and package-surface tests to cover the top-level barrel, runtime re-exports, and logging branches.
3. Keep edits test-only unless a barrel seam proves impossible to exercise without a no-op source touch.
4. Run package-local typecheck plus focused tests and, if practical, package-local coverage.
5. Review the diff for scope safety, then close the plan and commit only the touched paths.

## Verification

- `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli typecheck`
- Focused `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli exec vitest run --config vitest.config.ts ...`
- `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli test:coverage`
Completed: 2026-04-08
