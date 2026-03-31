# Add workspace package dependency cycle guard

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Add a fast repo-owned guard that detects workspace package dependency cycles before they can slip into the package graph.
- Wire that guard into the normal repo verification flow so operators get it automatically during existing `pnpm` checks, without a separate manual step.

## Success criteria

- `node scripts/check-workspace-package-cycles.mjs` reports success on the current workspace graph and fails with actionable cycle output when given a cyclic graph in test coverage.
- The guard is reachable through a root package script and runs as part of the shared repo verification flow used by `pnpm typecheck` and `pnpm test`.
- Durable verification docs and focused test coverage describe the new guard truthfully.

## Scope

- In scope:
  - Root verification scripts and package scripts
  - A focused test covering guard behavior and wiring
  - Durable verification docs that describe the added check
- Out of scope:
  - File-level import cycle detection
  - Broad release-workflow refactors
  - Cross-package dependency reshaping beyond reporting existing cycles

## Constraints

- Technical constraints:
  - Preserve unrelated dirty-tree edits in existing script and package files.
  - Keep the guard fast and static so it fits the current repo verification lane.
- Product/process constraints:
  - Repo code work needs coordination-ledger coverage, an execution plan, required verification, and the standard final review audit.
  - Do not expose personal identifiers in plan notes, diffs, or handoff text.

## Risks and mitigations

1. Risk: The guard could report false positives if it treats non-workspace dependencies as internal edges.
   Mitigation: Only follow dependencies that resolve to workspace package names declared under `packages/*` and `apps/*`.
2. Risk: The repo may already contain tolerated cycles, which would make the new guard fail immediately.
   Mitigation: Probe the current graph before wiring the check into `pnpm` flows and keep the implementation deterministic.

## Tasks

1. Implement a dedicated workspace package cycle-check script plus a root npm entrypoint.
2. Wire the guard into the shared repo verification flow used by existing root checks.
3. Add focused test coverage for guard behavior and wiring.
4. Update durable verification docs, run required checks, complete the mandatory final audit, and commit the exact touched paths.

## Decisions

- Count workspace edges across `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies` because repo policy forbids cyclic workspace package dependencies regardless of declaration bucket.
- Keep the guard separate from the existing workspace-boundary script so operators can run it directly when triaging package-graph issues.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - The new cycle guard passes on the current repo and is exercised by focused tests plus repo verification.
- Actual outcomes:
  - `node scripts/check-workspace-package-cycles.mjs` passed.
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/release-script-coverage-audit.test.ts --no-coverage` passed.
  - `pnpm typecheck` passed.
  - `pnpm test` passed on rerun after an unrelated hosted-web verify flake in the first attempt.
  - `pnpm test:coverage` passed.
  - Required final audit review returned no findings; residual risk was limited to not having a temp-workspace end-to-end failure test for a forced cycle.
Completed: 2026-04-01
