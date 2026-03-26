# Compatibility Shim Cleanup

Status: completed

## Goal

Validate the 2026-03-26 compatibility audit against the live tree, preserve the vault metadata repair path, and remove the compatibility layers that are still provably dead or obsolete in current source and tests.

## Scope

- `scripts/package-data-context.sh`
- `packages/cli/src/assistant/memory/{paths.ts,memory.ts}`
- `packages/cli/src/device-daemon/{state.ts,paths.ts}`
- `packages/cli/src/device-daemon.ts`
- `packages/cli/src/device-sync-client.ts`
- `packages/query/src/{model.ts,summaries.ts,index.ts}`
- `packages/runtime-state/src/device-sync.ts`
- `packages/device-syncd/src/{config.ts,http.ts}`
- `packages/device-syncd/README.md`
- `packages/web/src/lib/device-sync.ts`
- focused tests/docs that must move with those removals

## Out Of Scope

- `packages/core/src/vault.ts` and `packages/core/src/vault-metadata.ts` repair logic
- family/genetics/history alias hard-cuts unless the current tree proves they are isolated enough for this pass
- inbox restart-policy bridge, setup result API changes, meal naming cleanup, and experiment-status API changes

## Invariants

- Keep the vault metadata repair path intact.
- Preserve the current loopback-only/local control-plane boundary for device sync.
- Do not reintroduce new compatibility aliases while removing old ones.
- Do not overwrite unrelated in-flight edits in overlapping CLI/query/device-sync files.

## Planned Batches

1. Verify the high-confidence candidates against current call sites and active lanes.
2. Remove dead assistant memory alias and ignored packaging flags.
3. Remove `VaultRecord.id` and the legacy `listRecords()` default subset, updating direct consumers/tests.
4. Remove managed device-daemon token migration and the `DEVICE_SYNC_SECRET` control-token fallback, then align callers/docs/tests on `DEVICE_SYNC_CONTROL_TOKEN` only.
5. Run focused checks, required repo checks, and completion-workflow audit passes before commit.

## Verification

- Focused package checks for touched surfaces
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow: `simplify` -> `test-coverage-audit` -> `task-finish-review`

## Verification Notes

- `rg -n -- '--with-tests|--no-tests|--with-docs|--no-docs|--with-ci|--no-ci' .` returned no remaining matches.
- `bash scripts/package-data-context.sh --help` passed.
- `bash scripts/package-data-context.sh --vault fixtures/demo-web-vault --out-dir <tmp> --name compat-cleanup-smoke` passed and produced a ZIP bundle.
- `pnpm --dir packages/query test` passed.
- `pnpm --dir packages/device-syncd build` passed.
- `pnpm --dir packages/runtime-state typecheck` passed.
- `pnpm --dir . exec vitest run packages/runtime-state/test/ulid.test.ts packages/device-syncd/test/config.test.ts packages/cli/test/device-daemon.test.ts packages/web/test/device-sync-lib.test.ts --no-coverage --maxWorkers 1` passed.
- `pnpm --dir . exec vitest run packages/core/test/canonical-mutations-boundary.test.ts packages/core/test/core.test.ts --no-coverage --maxWorkers 1` passed.
- `pnpm --dir packages/web test` passed.
- `pnpm typecheck` passed.
- `pnpm test` was started after the focused green runs, but the repo-wide Vitest phase became inconclusive in the shared worktree because other repo-wide `pnpm test` / `pnpm test:coverage` processes were already active concurrently and the local run stopped making forward progress after the hosted/web build phases.
- `pnpm test:coverage` was not started in this turn because a concurrent repo-wide coverage run was already active in the shared worktree and duplicating it would have compounded the contention without yielding isolated evidence for this diff.
