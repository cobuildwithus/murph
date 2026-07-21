# PR 817 current-main reconciliation

Status: completed
Created: 2026-07-20

## Goal

Compose PR 817's unit-provenance correction with the shared comparability and
projection-rebuild ownership that landed on `main` through PR 816.

## Success criteria

- Unitless `test-result` points fail closed before canonical, raw-unit, custom,
  goal, series, experiment, panel, or trend evaluation, including stale points
  that already carry an invented canonical pair.
- The existing shared `resolveComparableMetricPointValue` normalizer remains the
  one comparability owner; no selector-local duplicate survives the merge.
- Version-17 projections rebuild through the version-18 mechanism already on
  `main`, while raw lab history remains unchanged and visible.
- Unitless custom test results fail closed, while custom non-lab measurements,
  explicit equivalent raw units, and legacy schema-typed derived summaries keep
  their intended behavior.
- Owner coverage, exact-head CI, and ReviewGPT round 4 pass.

## Scope

- In scope: four current-main conflict resolutions, the shared comparability
  helper, focused stale/custom test-result coverage, and round-4 PR evidence.
- Out of scope: another projection version, source-vault rewrites, migration
  services, consumer-specific exclusions, new catalog ownership, or UI redesign.

## Tasks

1. Resolve the current-main overlaps by retaining PR 816's shared owner and PR
   817's stricter unit-equivalence and warning behavior.
2. Reject unitless test results before trusting either canonical or custom raw
   values, and route goals and series through the shared helper.
3. Add stale canonical-pair and unitless custom test-result regressions, then
   verify the existing version-17 to version-18 rebuild proof remains green.
4. Run owner coverage and diff-aware verification, close the merge plan, push,
   update the PR contract, and run ReviewGPT round 4 with CI.

## Evidence

- ReviewGPT round 3 on `ea826b602601fd8a73e37577d48e7d953b6ed312`
  returned one High finding: a stale unitless lab row with a populated canonical
  pair remained selectable, and custom unitless test results bypassed the
  catalog branch.
- Current `main` already increments the query projection schema to version 18
  and includes an unchanged-manifest version-17 rebuild regression, so no second
  bump or new migration owner is required.
- Reconciliation keeps `resolveComparableMetricPointValue` as the shared owner,
  rejects unitless test results before canonical or custom fallbacks, and routes
  anchored experiment fallback through the same comparable-value contract.
- `pnpm --filter @murphai/health-metrics typecheck` passed.
- `pnpm --filter @murphai/query typecheck` passed.
- `pnpm --filter @murphai/health-metrics test:coverage` passed: 7 files,
  65 tests.
- `pnpm --filter @murphai/query test:coverage` passed: 58 files, 567 tests.
- All 35 Murph Age tests, all 79 experiment-analysis tests, and the focused web
  lab-history suite (19 tests) passed.
- Scenario integrity passed with 204 scenarios, 11 sample inputs, and 28 golden
  directories.
- The required `coverage-write` re-audit found no remaining actionable proof
  gap and made no files changes.
- The prior broad diff lane completed guards and typechecks, then an unchanged
  assistant-engine worker exhausted Node's 4 GB heap after 168 files and 2,516
  passing tests; owner coverage above is the truthful scoped verification lane.
- Exact-head CI and ReviewGPT round 4 remain pending until the merge commit is
  pushed.
Updated: 2026-07-21
Completed: 2026-07-21
