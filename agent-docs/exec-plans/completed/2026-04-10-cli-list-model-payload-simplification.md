# CLI List And Model Payload Simplification

## Goal

Reduce redundant model-facing CLI payload volume by removing list-item markdown from shared list surfaces and by making the `vault.cli.run` executor return one parsed JSON result instead of both raw JSON text and a parsed copy.

## Scope

- `packages/operator-config/src/vault-cli-contracts.ts`
- `packages/vault-usecases/src/usecases/shared.ts`
- `packages/assistant-engine/src/assistant-cli-tools/capability-definitions.ts`
- targeted tests under `packages/cli/test/**`, `packages/vault-usecases/test/**`, and `packages/assistant-engine/test/**`
- coordination/plan artifacts for this lane

## Verification

- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/vault-usecases test -- query-helper-coverage.test.ts record-service-coverage.test.ts`
- `pnpm exec vitest run --config vitest.workspace.ts --no-coverage test/supplement-wearables-coverage.test.ts test/cli-expansion-workout.test.ts test/assistant-cli.test.ts test/assistant-service.test.ts` from `packages/cli`

## Notes

- `pnpm --dir packages/assistant-engine typecheck` is currently red for unrelated pre-existing startup-recovery errors in that package.
- `pnpm --dir packages/assistant-engine test -- assistant-cli-tools-capabilities.test.ts execution-adapters.test.ts` still fanned into unrelated startup-recovery failures in the current branch, so the focused behavioral proof for this lane relies on the package-local capability test update plus the green CLI integration slice above.

## Constraints

- Keep `show` surfaces rich; only slim shared `list` outputs by default.
- Preserve existing human CLI behavior outside the list item field removal.
- Keep the provider-turn CLI executor JSON-first for normal commands while preserving text output for builtin text surfaces and fallback cases.

## Working Hypotheses

1. Most model-facing redundancy comes from shared list items carrying `markdown` plus nested `data` for every row.
2. Removing `markdown` from list items is a low-risk shared improvement because detailed reads still go through `show`.
3. Returning parsed JSON directly from `vault.cli.run` will materially reduce model context waste without changing the underlying CLI command execution path.
Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
