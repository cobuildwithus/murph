# Expand package-local coverage readiness for `@murphai/murph`

Status: completed
Created: 2026-04-08
Updated: 2026-04-08
Completed: 2026-04-08

## Goal

- Make `packages/cli` package-local coverage-ready so the root coverage lane can later adopt broad package-wide patterns instead of curated file lists.
- Keep the existing split workspace project structure intact while ensuring every package-local CLI test file participates in the workspace run.
- Add the smallest high-value tests needed to cover the currently weak CLI entrypoint, command-contract, and schema seams.

## Success criteria

- `packages/cli/vitest.workspace.ts` still uses the current split bucket structure, but every `packages/cli/test/**/*.test.ts` file is assigned to a workspace project.
- `packages/cli` gains package-local coverage configuration based on broad package patterns rather than curated file lists.
- Existing or new tests cover the highest-value weak seams in `packages/cli`, especially CLI entrypoint helpers and package-local schema/command modules.
- Package-local verification runs cleanly, or any unrelated/pre-existing blockers are isolated precisely.
- Root integration needs are reported without editing root coverage files in this lane.

## Scope

- In scope:
- `packages/cli/vitest.config.ts`
- `packages/cli/vitest.workspace.ts`
- `packages/cli/test/**`
- package-local source files under `packages/cli/src/**` only when needed to support or stabilize tests
- Out of scope:
- root `vitest.config.ts`
- `config/**`
- other workspace packages
- unrelated CLI runtime refactors

## Constraints

- Preserve unrelated worktree edits.
- Prefer existing CLI helpers in `packages/cli/test/cli-test-helpers.ts` over new harness stacks.
- Keep package-local coverage patterns broad, with only necessary exclusions for generated or non-source artifacts.
- Do not commit from this lane.

## Risks and mitigations

1. Risk: Broad package coverage includes weakly tested entrypoint wrappers and generated files, causing noisy failures.
   Mitigation: Exclude generated artifacts explicitly and add focused entrypoint tests for the remaining real surfaces.
2. Risk: Workspace bucket edits accidentally change the current serial-safe structure.
   Mitigation: Keep the six existing bucket names and only rebalance missing test files into the nearest current bucket.
3. Risk: Package-local tests drift into cross-package behavior instead of covering CLI-owned seams.
   Mitigation: Prioritize CLI-owned entrypoint, schema, command registration, and package-export surfaces; treat other-package assertions as secondary.

## Tasks

1. Add package-local coverage configuration to the CLI Vitest setup without changing the split project topology.
2. Ensure all current CLI test files are included in workspace buckets.
3. Use disjoint subagents for the assistant/runtime entrypoint seam and the knowledge/memory/automation seam.
4. Integrate the package-local changes, then run focused `packages/cli` verification.
5. Hand off package-local results plus explicit root follow-up needs.

## Decisions

- Keep root coverage integration out of scope for this lane.
- Reuse the existing CLI workspace buckets instead of inventing a second package-local project layout.
- Favor direct tests for `cli-entry.ts`, `knowledge-cli-contracts.ts`, `automation.ts`, and `memory.ts` before adding broader speculative coverage.

## Verification

- Commands to run:
- `pnpm --dir packages/cli test`
- `pnpm --dir ../.. exec vitest run --config packages/cli/vitest.workspace.ts --coverage`
- `pnpm --dir packages/cli typecheck`
- Expected outcomes:
- The package-local CLI suite runs with coverage configuration in place, and any remaining failures are isolated as unrelated environment or pre-existing issues.
