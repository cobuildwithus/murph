# Clean up another batch of duplicated import and mock patterns across package tests

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Run a fourth package-scoped cleanup pass on remaining test files that still use repetitive dynamic imports, reset/mock/import boilerplate, or duplicated built-runtime loader helpers.
- Prefer direct imports when the seam is stable and test-local helpers when lazy imports are still required.

## Success criteria

- The targeted `cli` and `vault-usecases` tests become simpler without changing behavior.
- Any helper introduced is package-local and test-only.
- Focused verification passes for the touched package scopes.

## Scope

- In scope:
- `packages/cli/test/**` for selected import-cleanup files
- `packages/vault-usecases/test/**` for selected import-cleanup files
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-test-import-hacks-cleanup-pass-4.md}`
- Out of scope:
- files already modified in the dirty worktree by other lanes
- runtime source changes beyond the minimum seam needed for test cleanup
- unrelated package coverage work in progress elsewhere

## Current state

- `packages/cli/test/canonical-write-lock.test.ts` still repeats mocked runtime-loading imports inside nested helper runs.
- `packages/cli/test/cli-entry.test.ts` still uses duplicated reset/mock/unmock flows around CLI entry imports.
- `packages/cli/test/inbox-cli.test.ts`, `packages/cli/test/cli-expansion-inbox-attachments.test.ts`, and `packages/cli/test/canonical-mutation-boundary.test.ts` repeat built-runtime import helpers that may be consolidatable.
- `packages/vault-usecases/test/record-service-coverage.test.ts` still lazy-loads multiple public barrels in one contract seam test.
- `packages/vault-usecases/test/runtime.test.ts`, `packages/vault-usecases/test/workout-coverage.test.ts`, and `packages/vault-usecases/test/query-helper-coverage.test.ts` still have leftover reset/mock/import boilerplate that may be reducible.

## Risks and mitigations

1. Risk:
   Breaking mock timing by importing too early.
   Mitigation:
   Only switch to direct imports when mocks are stable and do not vary per test.
2. Risk:
   Colliding with unrelated in-flight work.
   Mitigation:
   Use only clean, currently untouched test files and keep worker ownership disjoint.
3. Risk:
   Hiding test intent behind helpers.
   Mitigation:
   Introduce helpers only when they remove a real repeated pattern without obscuring what the test is doing.

## Tasks

1. Register the fourth cleanup pass in the coordination ledger.
2. Spawn five high-reasoning workers across disjoint file clusters.
3. Integrate the worker diffs and finish any remaining local cleanup.
4. Run focused verification plus the required final review audit.
5. Commit the scoped result.

## Verification

- focused package-local test and typecheck commands for the touched files
- `pnpm typecheck` if still green for the workspace
Completed: 2026-04-08
