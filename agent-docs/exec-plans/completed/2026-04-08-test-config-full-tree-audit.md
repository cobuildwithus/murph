# Remove file-whitelist test config from workspace runners

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Audit the repo's package and app test configs for hard-coded file whitelists.
- Make the active Vitest runners discover and execute the entire current test tree for each package or app instead of relying on curated filename lists.
- Widen any remaining package-local coverage includes that still enumerate specific source files so they cover the full package tree.

## Success criteria

- `packages/cli`, `apps/web`, and `apps/cloudflare` no longer depend on static filename lists to decide which tests run.
- New `*.test.ts` or `*.test.tsx` files in those trees are included automatically without manual config edits.
- Package-local coverage configs no longer enumerate a curated subset of source files where package-wide coverage is the intended contract.
- Required verification, required final review, and a scoped commit complete before handoff.

## Current state

- Added `config/vitest-test-buckets.ts` for filesystem-driven discovery and fail-closed bucket assignment.
- `packages/cli/vitest.workspace.ts`, `apps/web/vitest.workspace.ts`, and `apps/cloudflare/vitest.node.workspace.ts` now derive project membership from discovered test files instead of static filename whitelists.
- The shared helper now throws when a target tree discovers zero test files and uses repo-relative labels in errors instead of leaking absolute paths.
- Package-local coverage configs that still enumerated curated source files were widened to package-wide `src/**/*.ts` coverage where that is the package contract.
- `scripts/workspace-verify.sh` now runs `apps/cloudflare verify` so the Cloudflare app verification lane exercises the node and workers split configs instead of skipping them.

## Scope

- In scope:
- test-discovery and bucket-assignment config under:
  - `config/**`
  - `packages/cli/vitest.workspace.ts`
  - `apps/web/vitest.workspace.ts`
  - `apps/cloudflare/vitest.node.workspace.ts`
- package-local coverage include widening for:
  - `packages/assistant-engine/vitest.config.ts`
  - `packages/core/vitest.config.ts`
  - `packages/hosted-execution/vitest.config.ts`
  - `packages/importers/vitest.config.ts`
  - `packages/query/vitest.config.ts`
- Out of scope:
- adding or rewriting product/runtime tests
- changing runtime or app behavior outside test configuration
- unrelated active coverage rollout or hosted-web/runtime feature work

## Constraints

- Preserve unrelated worktree edits; the tree already has overlapping in-flight lanes.
- Keep the change limited to test/coverage configuration and shared config helpers.
- Preserve existing concurrency and special-case execution constraints where they still matter, but derive file membership from the filesystem and fail closed when unassigned tests remain.

## Risks and mitigations

1. Risk: replacing static file lists changes parallelism behavior and introduces flaky overlap.
   Mitigation: keep named buckets and per-bucket concurrency overrides where needed, but derive membership automatically and validate full coverage of discovered tests.
2. Risk: widening coverage includes to `src/**/*.ts` drops package coverage below existing thresholds.
   Mitigation: run the affected package/app verification lanes and only widen the packages that already have package-wide intent or can pass with the broader scope.
3. Risk: edits overlap with the active package-coverage rollout or hosted app lanes.
   Mitigation: stay scoped to config files listed above and preserve adjacent worktree changes.

## Tasks

1. Add a shared helper for filesystem-driven test discovery and fail-closed bucket assignment.
2. Replace static filename whitelists in the CLI, hosted-web, and Cloudflare workspace runners with derived bucket assignment.
3. Widen curated package coverage include lists to the full `src/**/*.ts` tree where package-wide coverage is intended.
4. Run required verification, complete the required final review, address findings, and commit the scoped result.

## Decisions

- Keep split workspace runners for performance and isolation, but remove static file-whitelist membership.
- Treat uncovered discovered tests as a config error rather than silently skipping them.
- Widen curated package coverage include lists only where the user request and current repo direction clearly call for package-wide coverage.

## Verification

- Required commands:
  - `pnpm typecheck`
  - `pnpm test:coverage`
- Focused proof to add during implementation:
  - direct inspection or script output showing every discovered test file is assigned to a workspace bucket for `packages/cli`, `apps/web`, and `apps/cloudflare`
- Results:
  - `pnpm --config.verify-deps-before-run=false typecheck` passed.
  - `pnpm typecheck` is currently blocked by an unrelated dirty-tree lockfile mismatch from `apps/cloudflare/package.json`.
  - `pnpm test:coverage` remains blocked by a pre-existing `build:test-runtime:prepared` guard failure: `Expected packages/cli/src to import required @murphai/assistant-cli subpaths: run-terminal-logging.`
  - Focused bucket-assignment proof showed current discovered coverage for the split runners:
    - `packages/cli`: 6 projects, 73 assigned test files.
    - `apps/web`: 5 projects, 101 assigned test files.
    - `apps/cloudflare` node workspace: 3 projects, 44 assigned test files.
  - `pnpm --config.verify-deps-before-run=false exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage` passed with 44 files and 405 tests.
Completed: 2026-04-08
