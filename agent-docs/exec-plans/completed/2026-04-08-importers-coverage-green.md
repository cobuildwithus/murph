# Get packages/importers green and above package-local coverage thresholds

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Make `pnpm --dir packages/importers test:coverage` pass honestly.
- Keep `packages/importers` green under its existing package-local coverage thresholds without weakening shared/root coverage policy.
- Prefer targeted deterministic tests over source refactors unless a tiny source fix is the more truthful repair.

## Success criteria

- `pnpm --dir packages/importers test` passes.
- `pnpm --dir packages/importers test:coverage` passes.
- The final package coverage stays above the existing thresholds with no shared threshold reductions.
- Required repo verification for `packages/importers` work is recorded before handoff.

## Scope

- In scope:
- `packages/importers/src/**`
- `packages/importers/test/**`
- `packages/importers/package.json`
- `packages/importers/vitest.config.ts`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-importers-coverage-green.md}`
- Out of scope:
- root/shared coverage threshold changes
- unrelated package coverage cleanup outside `packages/importers/**`
- broad runtime refactors in sibling packages

## Current state

- `packages/importers` already exposes package-local `test` and `test:coverage` scripts.
- The package-local fix landed as focused deterministic tests covering the importer factory/core/assessment seams, Garmin/provider helper seams, and Oura fallback branches.
- `pnpm --dir packages/importers test` now passes with 85 tests.
- `pnpm --dir packages/importers test:coverage` now passes with package totals at `97.60%` statements, `85.97%` branches, `98.99%` functions, and `97.63%` lines.
- There is an active broader package-coverage cleanup lane that overlaps `packages/importers` at the command and reporting level, so this task should stay tightly scoped to the package.
- Required repo verification outside the package is mixed but appears unrelated to the importers diff:
- `pnpm typecheck` fails in `packages/contracts/src/current-profile.ts` with `TS2366`.
- `pnpm test:packages` fails in existing `packages/contracts` tests (`test/public-entrypoints.test.ts`, `test/registry-entities.test.ts`).
- `pnpm test:smoke` passes.

## Risks and mitigations

1. Risk:
   Overlap with the existing dirty worktree and the broader package-coverage cleanup task.
   Mitigation:
   Keep edits inside `packages/importers/**` plus this plan and ledger, read current file state first, and preserve adjacent edits.
2. Risk:
   Coverage gaps may span many files, tempting threshold changes.
   Mitigation:
   Add focused deterministic tests first and only touch source when a test cannot reach a truthful branch without contrivance.
3. Risk:
   Package-local green may still leave required repo verification red for unrelated reasons.
   Mitigation:
   Run the required commands for package work, isolate any unrelated failures, and record the evidence precisely.

## Tasks

1. Capture the exact package-local coverage failures for `packages/importers`. Done.
2. Split the failing surface into independent subagent lanes. Done.
3. Integrate the smallest truthful fixes on top of the shared dirty worktree. Done.
4. Run package-local and repo-required verification. Done.
5. Run the required final audit review, then finish with a scoped commit. Next.

## Verification

- `pnpm --dir packages/importers test`
- `pnpm --dir packages/importers test:coverage`
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
Completed: 2026-04-08
