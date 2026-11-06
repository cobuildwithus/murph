# Reduce release-context complexity

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

Reduce concentrated branching in `scripts/release-helpers.mjs` while preserving accepted inputs, outputs, diagnostics, ordering and existing ownership.

## Evidence and owner

The repository analyzer at base `56b9f3751977b5b6745269f1a444559d5ef91ce0` reports validateReleaseContext at complexity 90. The existing module remains the implementation owner. No schema, authority, state or deployment contract changes are intended.

## Batch inventory

The fresh base scan covers 3,333 authored JS/TS paths using the repository's ESLint-classic analyzer and its existing generated/test exclusions. It has no parse errors: 855 functions exceed 20, total function complexity is 206,037, and excess-over-20 debt is 12,150. The prior batch's ten reductions are already present in this base.

The main remaining concentrations are Web (297), assistant engine (125), assistant runtime (97), core (49), Cloudflare (44), device-syncd (42), query (32), importers (25), scripts (21), CLI (20), vault-usecases (19), skill tooling (13), Health Commons (12), contracts (10), and hosted execution (10). The remaining smaller owners account for 39 hotspots. Counts indicate concentration, not a recommendation to merge distinct behavior into generic machinery.

This batch selects ten untouched normalization, reconciliation and validation hotspots: release context (90), supplement preview (94 maximum, with additional 87/79 hotspots), Commons catalog (70), Junction daily aggregation (74), WHOOP normalization (69), Oura normalization (55), execution context (85), device reconciliation (100), workout card parsing (56), and device settings (87). Selection favors meaningful removable repetition and independent owner boundaries over another small extraction from the already-refactored orchestration functions. Each PR records its own measured debt and total-complexity delta; no aggregate reduction is claimed before verification.

## Implementation approach

Inspect the implementation patch, prioritize deleted repetition and existing primitives, and use narrowly named same-file helpers only for real responsibilities. Preserve failure and retry behavior. Record both excess-over-20 debt and total complexity to distinguish factoring from branch deletion.

## Tasks

1. Inspect the proposed patch and callers; confirm behavior preservation.
2. Run focused owner tests, relevant typecheck, differential proof where useful, and the complexity guard.
3. Review the complete diff, close this plan in the scoped commit, and open a draft PR with concrete evidence.
4. Mark the stable candidate Ready; start final ReviewGPT concurrently with required exact-head CI and resolve the completion gates.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/release-verification-lanes.test.ts`: 10 tests passed.
- `node scripts/run-typescript.mjs package -p tsconfig.tools.json --pretty false`: passed.
- `node --check scripts/release-helpers.mjs` and `node scripts/verify-release-target.mjs --json`: passed.
- `pnpm complexity:diff --base 56b9f3751977b5b6745269f1a444559d5ef91ce0`: passed.
- `git diff --check`: passed.
- Parent inspected the complete source and regression-test diff; no private data, new dependencies or public API changes.

## Outcome

Release context validation mixed manifest, package, entrypoint and dependency checks in one 90-point function. Separate those existing responsibilities into private validators while preserving diagnostic order and the complete release summary.

validateReleaseContext 90 → 14; file maximum 90 → 14; excess-over-20 debt delta -70; total function complexity delta +9.

The changed responsibility now fits below the threshold; unchanged neighboring policies remain separately scoped. No functions above 20 remain in this source file.

Final ReviewGPT and exact-head CI are tracked in the PR after this scoped commit. Internal behavior-preserving refactor; no changelog or deployment contract change.

## Batch measurement

The ten inspected candidates reduce excess-over-20 debt by 493 points and total function complexity by 118 points using the repository analyzer. These are candidate measurements; completion and merge status remain separate PR gates.
Completed: 2026-09-14
