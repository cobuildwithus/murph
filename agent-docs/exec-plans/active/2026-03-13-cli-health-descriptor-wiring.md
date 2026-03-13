# Execution Plan: CLI Health Descriptor Wiring

## Goal

Tighten the health CLI descriptor method-name fields so descriptor tables are checked against real runtime/service interfaces, and split the integrated CLI service wiring into smaller local builders without changing command names, result envelopes, or noun/generic alignment.

## Scope

- In scope:
  - `packages/cli/src/health-cli-descriptors.ts`
  - `packages/cli/src/vault-cli-services.ts`
  - Targeted CLI tests that cover health read/write routing
- Out of scope:
  - CLI command renames
  - New plugin/runtime architecture
  - Behavior changes outside the health descriptor/service wiring

## Constraints

- Preserve noun-specific and generic command alignment exactly.
- Reduce casts only where the runtime/service interfaces can prove safety.
- Work on top of the current shared CLI tree without reverting other lanes.
- Avoid cursor-option/list-path symbols already claimed by the active cursor lane.

## State

completed

## Done

1. Derived health descriptor method-name unions from shared health runtime/service interfaces and applied them at descriptor definition time with `satisfies`.
2. Isolated dynamic indexing behind typed helper functions and reduced the remaining cast surface to the health core dynamic dispatch boundary.
3. Split `createIntegratedVaultCliServices()` into `createIntegratedCoreServices()`, `createIntegratedImporterServices()`, and `createIntegratedQueryServices()`.
4. Verified the scoped change with:
   - `pnpm --filter @healthybob/cli typecheck`
   - `pnpm build`
   - `pnpm exec vitest run packages/cli/test/health-tail.test.ts packages/cli/test/runtime.test.ts --no-coverage --maxWorkers 1`

## Verification Notes

- `pnpm typecheck` failed in an unrelated pre-existing workspace build path: `packages/core/src/indexing/persist.ts` reported `TS6305` against `packages/contracts/dist/index.d.ts`.
- `pnpm test` failed in unrelated built-CLI/runtime-package integration paths; the immediate runtime blocker is `Cannot find package '@healthybob/runtime-state' imported from packages/query/dist/search-sqlite.js`.
- `pnpm test:coverage` failed for the same unrelated built-CLI/runtime-package blocker and then surfaced a coverage temp-file `ENOENT` after the failing run.

## Next

- Hand off the scoped CLI refactor with the unrelated repo-wide verification blockers recorded.
