# Clean up duplicated hacky import and mock patterns across package test files

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Review multiple package test suites for repeated hacky dynamic-import and mock-reset patterns.
- Replace unnecessary lazy imports with direct imports where no mocking is involved.
- Consolidate repeated `vi.resetModules()` plus `vi.doMock()` plus `await import(...)` flows behind clearer package-local test helpers where that improves readability.

## Success criteria

- `packages/vault-usecases/test/**` uses a shared helper for repeated mocked import flows instead of bespoke wrappers per file.
- Multiple package tests stop using ad hoc dynamic imports when direct imports are sufficient.
- The cleanup stays test-scoped or test-helper-scoped unless a tiny source seam is strictly required.
- Required verification passes for the touched package scopes.

## Scope

- In scope:
- `packages/vault-usecases/test/**`
- selected test files under `packages/{gateway-local,cloudflare-hosted-control,runtime-state,operator-config}/test/**`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-test-import-hacks-cleanup.md}`
- Out of scope:
- unrelated runtime behavior changes
- app test cleanup
- coverage policy or config changes

## Current state

- `packages/vault-usecases/test/{runtime,query-helper-coverage,workout-coverage,record-service-coverage,public-entrypoints}.test.ts` repeat variants of the same reset/mock/import pattern.
- `packages/gateway-local/test/package-boundary.test.ts`, `packages/cloudflare-hosted-control/test/barrel-contracts.test.ts`, `packages/runtime-state/test/package-boundary.test.ts`, and selected `packages/operator-config/test/**` files use dynamic imports or repeated mocked-import loaders that can be made clearer without changing behavior.
- The repo worktree is already dirty, so this lane must stay tightly scoped and preserve adjacent edits.

## Risks and mitigations

1. Risk:
   Moving an import too early could break mock timing.
   Mitigation:
   Only convert imports that have no mocking dependency; keep mocked seams behind shared helpers.
2. Risk:
   Over-abstracting tests into unreadable helper layers.
   Mitigation:
   Add helpers only when the pattern repeats materially, especially in `vault-usecases`.
3. Risk:
   Colliding with existing active lanes in the same packages.
   Mitigation:
   Keep worker ownership disjoint by file cluster and preserve adjacent changes.

## Tasks

1. Register the cleanup lane and confirm the repeated patterns.
2. Spawn worker lanes for `vault-usecases` and a small-package cleanup cluster.
3. Integrate the worker changes and finish any remaining local cleanup.
4. Run required verification.
5. Run the required final review audit, address findings, and finish with a scoped commit.

## Verification

- `pnpm typecheck`
- targeted Vitest runs for touched package tests
Completed: 2026-04-08
