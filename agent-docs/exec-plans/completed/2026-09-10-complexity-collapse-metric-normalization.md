# Collapse metric normalization dispatch complexity

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Make health metric conversion routing readable by deleting redundant exact-unit cases and expressing conversion exceptions as typed data.

## Success criteria

- Preserve aliases, ordinary versus lab-result catalog scope, conversion factors and rounding, missing/nonfinite values, source units, and warning text.
- Reduce the target function's cyclomatic complexity and source size; pass focused tests, package typecheck, and the complexity guard.

## Scope

- In scope: `packages/health-metrics/src/normalize.ts`, focused normalization proof, and this plan.
- Out of scope: catalog changes, new units or formulas, public APIs, persistence, assistant prompts, and UI.

## Constraints

- Technical constraints: retain the health-metrics read-side owner and existing unit converters. Introduce no dependencies, state, external effects, or generic conversion framework.
- Product/process constraints: internal behavior-preserving refactor; parent owns candidate acceptance and final review/CI after draft PR creation.

## Risks and mitigations

1. Replacing exact-unit cases with declared-unit fallback can change missing-unit output where display and canonical units differ, or when the lab-only catalog treats a body key as custom. Keep explicit percent routing for those exceptions and prove both scopes against the baseline.
2. Dispatch data can omit aliases or select prototype properties. Keep conversion-only keys explicit, use `Map` lookup, and cover arbitrary custom metric names.

## Tasks

1. Inspect current conversion helpers, catalogs, and behavior tests.
2. Replace repeated routing with private typed conversion maps and remove proven redundant cases.
3. Add focused boundary proof and compare synthetic baseline/head normalization results.
4. Run focused tests, package typecheck, complexity guard, and full diff/privacy review.
5. Close the plan, commit, push, open a draft PR, and hand off exact-head evidence to the parent.

## Decisions

- The catalog already owns canonical units for exact-unit conversions. Reuse its declared-unit fallback where missing-unit display semantics agree.
- Keep body-percentage converters for custom lab-result keys and percent converters for the two lab metrics whose display unit is `%`.
- Preserve separate ordinary and lab-result definition resolution before conversion dispatch.
- No changelog: the change is internal and preserves member-visible behavior.
- No deploy skew: no persisted format, protocol, or package API changes.

## Verification

- `pnpm --dir packages/health-metrics test test/index.test.ts test/normalize.test.ts`
- `pnpm --dir packages/health-metrics typecheck`
- `pnpm complexity:diff --base b2a559812972d70644cffb2bf43923fc9211047d -- packages/health-metrics/src/normalize.ts`
- Expected outcomes: focused behavior and type proof pass; file maximum and debt decrease with no new hotspot above 20.

## Results

- Focused suite: 62 tests passed across the existing package index and five new boundary tests.
- Synthetic baseline/head differential: 957,564 results were identical across 794 metric keys and aliases, 67 source units, nine missing/finite/nonfinite values, and both normalization scopes. Baseline: `b2a559812972d70644cffb2bf43923fc9211047d`. The matrix included null/empty/unknown/incompatible units, custom property-like keys, signed zero, both infinities, and large finite values.
- Package typecheck: passed; no public entrypoint, dependency, or import-boundary change.
- Complexity guard: passed. Target `normalizeMetricValueForScope` decreased from 55 to 8; file maximum decreased from 55 to 21 and debt above 20 decreased from 36 to 1.
- The remaining `resolveComparableMetricPointValue` hotspot is unchanged at 21. Its source-evidence validity rules are separate from conversion routing; simplifying it would widen this refactor without helping the demonstrated repetition.
- Source change: 56 added / 81 deleted lines, a net reduction of 25. No new external effects, asynchronous work, persisted state, or provider-input changes.
- Frog: installed ordinary frozen dependencies, then inspected existing entries; no task-owned friction entry was needed.
Completed: 2026-09-10
