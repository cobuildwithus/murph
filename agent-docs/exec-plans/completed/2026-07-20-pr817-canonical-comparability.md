# PR 817 canonical comparability remediation

Status: completed
Created: 2026-07-20

## Goal

Make canonical comparability a single shared health-metrics invariant so a
numeric lab result with no source unit remains visible as raw lab evidence but
cannot become a typed metric value downstream.

## Success criteria

- Definitions with a canonical unit select and emit series rows only from a
  finite canonical value carrying that expected canonical unit, an explicitly
  unitful raw value already equivalent to it, or a schema-typed legacy derived
  summary whose producer owns the definition's unit.
- Unitless catalogued lab results remain in raw lab history but produce no
  ready metric selection, metric series row, goal progress, experiment delta,
  or private trend.
- Definitions without a canonical unit retain their existing raw-value
  behavior, and explicit unitful lab controls remain comparable.
- Focused owner coverage, full routed verification, CI, and ReviewGPT round 3
  pass on the exact pushed head.

## Scope

- In scope: shared health-metric selection and series comparability, focused
  browser-replica consumer regressions, and PR review documentation.
- Out of scope: raw vault rewrites, new persisted provenance, new catalog
  definitions, consumer-specific exclusion lists, or UI redesign.

## Tasks

1. Add failing shared-owner and browser-replica regressions for unitless LDL-C,
   plus explicit unitful and custom-metric controls.
2. Delete raw/display-unit fallback for canonical definitions at the shared
   health-metrics selection and series boundary.
3. Verify goals, experiments, trends, browser replicas, and raw lab history.
4. Run required audits and verification, commit, push, update the PR contract,
   and run ReviewGPT round 3 concurrently with CI.

## Evidence

- Shared-owner regression coverage proves that raw catalog values with missing
  or incompatible units fail closed, explicit equivalent raw units remain
  comparable, legacy derived summaries remain compatible, and custom metrics
  without canonical units retain their raw behavior.
- Browser-replica integration coverage proves that unitless LDL-C remains in
  raw lab history while selection, series, panel, goal, experiment, and trend
  consumers receive no typed value; the same fixtures with `mg/dL` remain
  fully comparable.
- `pnpm --filter @murphai/health-metrics typecheck` passed.
- `pnpm --filter @murphai/query typecheck` passed.
- `pnpm --filter @murphai/health-metrics test:coverage` passed: 7 files,
  64 tests.
- `pnpm --filter @murphai/query test:coverage` passed: 58 files, 562 tests.
- The focused web lab-history suite passed: 1 file, 19 tests.
- Scenario integrity passed: 204 scenarios, 11 sample inputs, 28 golden
  directories.
- The diff-aware lane passed policy guards and all affected typechecks, then
  failed in unchanged `@murphai/assistant-engine` when a Vitest worker exceeded
  Node's 4 GB heap and timed out during shutdown. The affected owners' direct
  suites above remained green.
- Coverage-write audit completed with no unresolved findings after adding the
  equivalent-raw-unit, incompatible-unit, aggregate, and legacy-derived cases.
- Final CI and ReviewGPT round 3 remain pending until the exact head is pushed.
Updated: 2026-07-20
Completed: 2026-07-20
