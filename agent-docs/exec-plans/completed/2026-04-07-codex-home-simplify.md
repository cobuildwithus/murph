# Simplify Codex-home and model-helper composition after the explicit Codex-home landing

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Reduce duplicated helper logic introduced by the explicit Codex-home landing without changing user-facing behavior.

## Success criteria

- `packages/cli/src/commands/model.ts` reuses the existing shared setup-default helper module instead of duplicating assistant-default conversion and summary logic.
- Focused typecheck and Vitest coverage still pass after the cutback.

## Scope

- In scope:
- `packages/setup-cli/**`
- `packages/cli/src/commands/model.ts`
- focused tests if needed
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- this active plan
- Out of scope:
- new Codex-home behavior changes
- concurrent `packages/assistant-engine/src/assistant-codex.ts` / `assistant-codex-events.ts` extraction worktree edits
- unrelated hosted/runtime worktree changes

## Constraints

- Reuse existing public setup-cli/package surfaces rather than adding another package just for helper sharing.
- Keep package boundaries clean; avoid cross-package helper extraction that creates brittle TS/package-surface problems.
- Preserve the existing Codex-home behavior and direct proof expectations.

## Tasks

1. Reuse shared setup assistant-default helpers from `setup-cli` inside `murph model`.
2. Run focused checks, close the plan, and commit only the cleanup lane.

## Verification

- `./node_modules/.bin/tsc -p packages/setup-cli/tsconfig.typecheck.json --pretty false`
- `./node_modules/.bin/tsc -p packages/assistant-cli/tsconfig.typecheck.json --pretty false`
- `./node_modules/.bin/tsc -p packages/cli/tsconfig.typecheck.json --pretty false`
- `cd packages/cli && ../../node_modules/.bin/vitest run --config vitest.config.ts test/assistant-cli.test.ts test/setup-cli.test.ts test/assistant-codex.test.ts`
- Results:
- All three typecheck commands passed.
- Focused Vitest passed: 3 files, 119 tests.
- Final review found one low issue about importing the wizard from the root `@murphai/setup-cli` barrel; fixed by switching back to the dedicated `setup-assistant-wizard` subpath.
Completed: 2026-04-07
