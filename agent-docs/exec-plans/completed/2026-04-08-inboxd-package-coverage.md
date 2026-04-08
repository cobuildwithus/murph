# Inboxd package coverage readiness

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Make `@murphai/inboxd` package-local tests and Vitest config ready for package-wide root coverage inclusion.
- Keep all implementation inside `packages/inboxd/**` and package-local test helpers only.

## Success criteria

- `packages/inboxd/vitest.config.ts` has package-local coverage configuration in the repo’s existing style.
- Existing inboxd tests plus new deterministic tests cover the highest-value untested seams well enough for package-wide root coverage patterns.
- Shared inboxd test scaffolding is reused rather than duplicated across connector and runtime tests.
- Package-local verification passes, and any root integration requirement is reported instead of edited here.

## Scope

- In scope:
  - `packages/inboxd/vitest.config.ts`
  - `packages/inboxd/src/**`
  - `packages/inboxd/test/**`
- Out of scope:
  - Root `vitest.config.ts`
  - `config/**`
  - Other packages
  - Commits

## Constraints

- Preserve unrelated worktree edits.
- Keep tests deterministic and local.
- Reuse connector or kernel helpers where practical.
- Spawn GPT-5.4 high subagents for disjoint inboxd seams and keep write ownership disjoint.

## Planned seams

1. Connectors and normalization helpers:
   - email parsed and normalize helpers
   - generic chat message and poll behavior
   - webhook connector edge cases not already covered
2. Kernel, runtime, and indexing helpers:
   - runtime exports and SQLite mutation helpers
   - daemon restart-policy edges
   - canonical-record builders or persistence helpers
3. Parser/shared-runtime/contracts helpers:
   - parsed inbox pipeline
   - runtime barrel and shared helper coverage
   - small contract and export seams

## Verification

- Package-local iteration:
  - `pnpm --dir packages/inboxd typecheck` ✅
  - `pnpm --dir packages/inboxd exec vitest run --config vitest.config.ts test/inboxd-connectors-coverage.test.ts test/inboxd-runtime-kernel-coverage.test.ts test/inboxd-parsers-shared-coverage.test.ts --no-coverage` ✅
  - `pnpm --dir packages/inboxd exec vitest run --config vitest.config.ts --coverage --exclude test/linq-connector.test.ts` ⚠️ only the Linq connector/normalize thresholds remain red in this sandbox-supported run
  - `pnpm --dir packages/inboxd test` ⚠️ existing Linq listener tests fail in this sandbox with `listen EPERM: operation not permitted 127.0.0.1`
- Required repo-scoped baseline for this package lane:
  - `pnpm typecheck` ⚠️ unrelated existing root workspace build/type errors in `packages/core` and `packages/assistantd`
  - `pnpm test:packages` ⚠️ blocked in this sandbox before reaching inboxd by an unrelated `tsx` IPC `listen EPERM` failure in `packages/contracts`
