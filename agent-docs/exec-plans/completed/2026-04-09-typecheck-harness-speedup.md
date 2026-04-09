# Typecheck Harness Speedup

Last updated: 2026-04-09

## Goal

Speed up the default local verification loop by making the root workspace TypeScript build actually incremental on warm runs and by removing duplicated local typecheck proof where the harness currently proves both workspace emit-build health and package/app no-emit health in the same command.

## Scope

- Root verification/build tooling: `package.json`, `scripts/workspace-verify.sh`, `scripts/release-check.sh`
- Root and package TypeScript build configs that participate in the workspace `tsc -b` graph
- The affected package-local `build` scripts whose clean-build semantics depended on `tsBuildInfoFile` living under `dist`
- Durable verification docs that describe `pnpm typecheck`, `pnpm build:workspace:incremental`, and release-check semantics

## Success Criteria

- Local `pnpm build:workspace:incremental` no longer deletes the TypeScript incremental metadata needed for warm runs.
- The repo exposes an explicit clean workspace-build command for CI/release semantics.
- `pnpm typecheck` no longer pays for both the workspace build proof and the package/app no-emit typecheck pass on every local run.
- Durable verification docs match the new command meanings.

## Constraints

- Keep the change scoped to verification/build tooling and TypeScript configs; do not broaden into unrelated CLI/web coverage tuning in this lane.
- Preserve the repo's existing clean-build path for release-grade proof.
- Preserve unrelated worktree edits and existing in-flight ledger scopes.

## Verification

- `pnpm typecheck`
- `pnpm build:workspace:clean`
- `pnpm test:diff -- package.json scripts/workspace-verify.sh scripts/release-check.sh agent-docs/operations/verification-and-runtime.md agent-docs/references/testing-ci-map.md`

## Notes

- The highest-confidence first-order win is moving workspace-build `tsBuildInfoFile` outputs out of `dist/` so the warm local build can reuse them.
- Release-grade build proof should remain available through an explicit clean build lane rather than the default local typecheck loop.
- Follow-up direct proof exposed one regression in package-local build scripts that deleted only `dist`; this lane fixes the non-`--force` package builds to delete the new root `.tsbuildinfo` as well.
- Current repo-wide verification remains blocked by unrelated in-flight work outside this lane, including `packages/cli/test/profile-protocol-command-coverage.test.ts`, `packages/query/src/health/**`, `packages/vault-usecases/src/**`, and `packages/assistant-engine/src/assistant/{cron,vault-overview}.ts`.

## Status

- In progress
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
