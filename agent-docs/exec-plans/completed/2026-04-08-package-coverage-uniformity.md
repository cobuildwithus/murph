# Finalize fully uniform package coverage policy

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Make package coverage policy fully uniform across the repo if the live tree can support it honestly.
- Remove the remaining package-specific threshold carve-out.
- Ensure every workspace package has a real package-local coverage command and that the root coverage lane exercises every package.

## Success criteria

- Every package under `packages/*` has an honest `test:coverage` command.
- Every package uses the canonical repo coverage thresholds from `config/vitest-coverage.ts`, with no package-local threshold overrides left.
- `packages/inbox-services` moves onto the shared Vitest coverage helper path so it follows the same threshold policy as the rest of the repo.
- Root package coverage wiring (`vitest.config.ts` and `scripts/workspace-verify.sh`) includes every package, not just the earlier rollout subset.
- Verification docs reflect the new all-packages package coverage lane.

## Scope

- In scope:
- `vitest.config.ts`
- `scripts/workspace-verify.sh`
- `packages/cli/**`
- `packages/inbox-services/**`
- any root/package coverage config or package manifest changes required to make the package coverage lane truly uniform
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/references/testing-ci-map.md`
- Out of scope:
- unrelated package runtime changes beyond the smallest truthful test/config updates needed for coverage uniformity
- lowering thresholds or narrowing `src/**/*.ts` coverage includes
- unrelated hosted-runner, hosted-web, or boundary-refactor work already active in the tree

## Current state

- The canonical thresholds remain `lines 85 / functions 85 / branches 80 / statements 85` with `perFile: true`.
- Every workspace package under `packages/*` now exposes both `test` and `test:coverage`.
- `packages/cli/vitest.workspace.ts` now inherits the canonical coverage thresholds through `createMurphVitestCoverage()` and uses `resolveMurphVitestMaxWorkers()`.
- `packages/inbox-services` now uses a package-local Vitest config backed by the shared coverage helper, so it follows the same threshold policy as the rest of the repo.
- The root package coverage lane in `scripts/workspace-verify.sh` now runs every package-local `test:coverage` entrypoint under `packages/*`.
- The remaining verification reds are honest package/runtime failures under the uniform policy, not policy carve-outs.

## Risks and mitigations

1. Risk:
   Expanding root coverage to every package could expose pre-existing package reds.
   Mitigation:
   keep the changes honest, capture exact failing packages, and only relax by reporting blockers rather than weakening policy.
2. Risk:
   Migrating `inbox-services` from `node:test` to Vitest could collide with active inbox package work.
   Mitigation:
   keep the change package-local, reuse the shared workspace-alias pattern already used across the repo, and avoid runtime source edits unless test import mechanics require them.
3. Risk:
   The root package coverage lane may become slower.
   Mitigation:
   reuse package-local `test:coverage` entrypoints rather than inventing another coverage path, and update docs to match the intentional tradeoff.

## Tasks

1. Register the lane and confirm the remaining non-uniform package coverage seams.
2. Remove the CLI threshold override and align it to the canonical helper defaults.
3. Move `packages/inbox-services` onto the shared Vitest coverage helper with a package-local `vitest.config.ts` and Vitest-backed tests.
4. Expand the root package coverage lane so it exercises every package-local `test:coverage` surface.
5. Run focused package-local coverage for the changed packages, then run the required repo verification.
6. Run the required final audit pass and finish with a scoped commit.

## Verification

- Focused:
  - `pnpm --dir packages/cli test:coverage`
  - `pnpm --dir packages/inbox-services test:coverage`
- Required repo commands:
  - `pnpm typecheck`
  - `pnpm test:coverage`

## Outcome

- `pnpm --dir packages/inbox-services test:coverage` runs on the shared Vitest helper and fails on canonical per-file thresholds, with package totals at `6.22 statements / 5.31 branches / 2.19 functions / 6.31 lines`.
- `pnpm --dir packages/cli test:coverage` now runs with the canonical thresholds and shared max-worker policy, then fails honestly on two existing test failures plus multiple per-file threshold misses such as `src/commands/model.ts`, `src/commands/inbox.ts`, and `src/review-gpt-runtime.ts`.
- `pnpm typecheck` still fails for unrelated workspace issues, currently led by `packages/assistant-engine/src/assistant/cron.ts` and `packages/cli/src/commands/automation.ts`.
- `pnpm test:coverage` still fails before the full all-packages coverage tail because `build:test-runtime:prepared` is already red from unrelated cross-package type/build drift in `query`, `vault-usecases`, `inbox-services`, `assistant-engine`, `assistant-cli`, and `setup-cli`.
Completed: 2026-04-08
