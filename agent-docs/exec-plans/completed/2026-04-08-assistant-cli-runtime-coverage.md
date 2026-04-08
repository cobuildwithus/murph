# Raise owned `@murphai/assistant-cli` assistant runtime seam coverage

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Raise honest package-local coverage for the owned assistant runtime seam files without changing runtime behavior.
- Keep package coverage scoped to `src/**/*.ts` and avoid root/shared coverage-config changes.
- Preserve the current dirty `packages/assistant-cli/test/**` worktree, especially the existing untracked seam tests already in progress.

## Success criteria

- Add focused package-local tests for the owned uncovered seams:
  - `packages/assistant-cli/src/assistant-daemon-client.ts`
  - `packages/assistant-cli/src/assistant/daemon-client.ts`
  - `packages/assistant-cli/src/assistant/runtime.ts`
  - `packages/assistant-cli/src/assistant/stop.ts`
- `pnpm --dir packages/assistant-cli typecheck` passes.
- Focused assistant-cli Vitest runs for the new tests pass.
- Coverage for the owned files improves materially from the current baseline while leaving runtime behavior unchanged.

## Scope

- In scope:
- `packages/assistant-cli/src/assistant/{daemon-client.ts,runtime.ts,stop.ts}`
- `packages/assistant-cli/src/assistant-daemon-client.ts`
- new or narrowly edited `packages/assistant-cli/test/**` files for those seams
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-assistant-cli-runtime-coverage.md}`
- Out of scope:
- `packages/assistant-cli/src/assistant/ui/**`
- `packages/assistant-cli/src/commands/assistant.ts`
- `packages/assistant-cli/src/run-terminal-logging.ts`
- root config or other packages

## Current state

- Existing package-local untracked tests already cover several assistant-cli seams, but they must be preserved because this is a shared worktree.
- User-reported baseline gaps remain in `assistant-daemon-client.ts`, `assistant/daemon-client.ts`, `assistant/runtime.ts`, and function coverage in `assistant/stop.ts`.
- The package-level run is currently red on unrelated UI test assertions around `Key` objects, so verification should stay focused on the owned seams plus package typecheck.

## Plan

1. Add a small barrel-focused test for `assistant/daemon-client.ts` and `assistant/runtime.ts`.
2. Add deterministic `assistant-daemon-client.ts` edge-case tests for non-covered fetch/parse/early-return branches.
3. Add narrow `assistant/stop.ts` tests for normalization/default-path branches not already exercised.
4. Run focused assistant-cli tests and typecheck.
5. Run the required final audit review, then commit only the touched paths.

## Verification

- `pnpm --dir packages/assistant-cli typecheck`
- `pnpm --dir packages/assistant-cli exec vitest run --config vitest.config.ts packages/assistant-cli/test/...`
Completed: 2026-04-08
