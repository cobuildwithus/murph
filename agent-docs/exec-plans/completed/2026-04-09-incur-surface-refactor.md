# Incur Surface Refactor

## Goal

Refactor the recent Incur command-surface descriptor cleanup so the code is easier to read, compose, and maintain without changing command behavior, generated artifacts, or verification outcomes.

## Scope

- `packages/cli/scripts/{incur-config-schema.ts,verify-package-shape.ts}`
- Recent command-surface files under `packages/cli/src/commands/**`
- `packages/assistant-cli/src/commands/assistant.ts`
- `packages/operator-config/src/vault-cli-contracts.ts`
- Directly related regression tests under `packages/cli/test/**` and `packages/assistant-cli/test/**`

## Constraints

- Preserve existing behavior and generated output unless a change is needed to keep generation deterministic.
- Do not revert or absorb unrelated in-flight worktree edits outside this lane.
- Prefer extracting small local helpers or shared constants over widening abstraction layers.
- Keep the final diff proportional to readability and composability gains.

## Plan

1. Inspect the recently landed generator and descriptor code to identify the highest-complexity hot spots.
2. Simplify those hot spots with behavior-preserving helpers and clearer structure.
3. Regenerate any affected artifacts and run the truthful verification lane.
4. Run the required audit passes, land any review-driven cleanup, and commit only the scoped files.

## Verification

- `pnpm typecheck` ✅
- `pnpm test:diff packages/cli packages/assistant-cli packages/operator-config` ❌
  - Scoped CLI verification passed, including `packages/cli` package-shape verification, CLI workspace Vitest, and `packages/assistant-cli` test/typecheck coverage.
  - The lane still fails in unrelated pre-existing dirty `packages/assistant-engine/test/assistant-automation-runtime.test.ts` assertions outside this task scope.

## Audit

- GPT-5.4 high audit pass 1: no generator-integrity regressions found; asked to record final verification proof and remove one dead verifier import.
- GPT-5.4 high audit pass 2: no behavior regressions found in the assistant/journal/model refactor; suggested keeping `queryRecordTypeDescription` file-local, which this task applied.
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
