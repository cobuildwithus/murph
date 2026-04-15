# Get `packages/cli` green and above package-local coverage thresholds

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Make `packages/cli` pass its package-local verification on top of the live tree.
- Raise honest CLI package coverage above a package-local threshold policy without hiding real code behind broad excludes.

## Success criteria

- `pnpm --dir packages/cli typecheck` passes.
- `pnpm --dir packages/cli test:coverage` passes on the current tree.
- Coverage proof stays honest for the newly exercised command and runtime surfaces.

## Scope

- In scope:
- `packages/cli/{src/**,test/**,package.json,vitest*.ts}`
- this active plan and the coordination ledger row for the lane
- package-local verification evidence for `packages/cli`
- Out of scope:
- shared/root coverage helper changes beyond the package-local Vitest override consumed by `packages/cli`
- unrelated runtime/package lanes outside what `packages/cli` directly needed to pass its own scripts

## Current state

- `packages/cli` is green on its package scripts.
- The package now uses package-local CLI coverage thresholds in `packages/cli/vitest.workspace.ts` with `perFile: false`.
- The final package-local verification run passed with all tests green and package totals above threshold.

## Risks and mitigations

1. Risk: this lane overlaps active uncommitted `packages/cli` work.
   Mitigation: preserve adjacent edits, keep source changes narrow, and favor additive deterministic tests.
2. Risk: coverage is "fixed" by hiding real logic.
   Mitigation: cover real runtime/command files directly and keep `src/foreground-terminal-logging.ts` included in coverage.
3. Risk: built-runtime tests fail because prepared artifacts are stale or missing.
   Mitigation: verify through the real `test:coverage` script, which rebuilds prepared runtime artifacts before running Vitest.

## Tasks

1. Measure the current package-local failures and coverage gaps on the live tree.
2. Split disjoint CLI seams across parallel subagents.
3. Integrate deterministic test additions and the minimal package-local coverage config needed for honest proof.
4. Re-run package-local verification.
5. Run the required final audit review and land a scoped commit.

## Decisions

- Keep this as a narrow `packages/cli` lane even though a broader coverage-policy lane also exists.
- Prefer deterministic test additions over source edits unless verification exposes a real runtime defect.
- Use package-local coverage thresholds for `packages/cli` rather than the repo-default per-file policy because the user asked to get this package green above its package-local thresholds.

## Verification

- Required commands:
  - `pnpm --dir packages/cli typecheck`
  - `pnpm --dir packages/cli test:coverage`
- Observed results:
  - `pnpm --dir packages/cli typecheck` passed.
  - `pnpm --dir packages/cli test:coverage` passed with `80` test files, `992` tests, and coverage totals of `92.5` statements, `78.26` branches, `91.7` functions, and `92.61` lines.
  - Focused coverage slices for the newly added tests also passed while the lane was being integrated.
Completed: 2026-04-08
