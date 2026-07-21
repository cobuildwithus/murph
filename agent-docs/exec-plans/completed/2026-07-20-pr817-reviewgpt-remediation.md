# PR 817 ReviewGPT remediation

Status: completed
Created: 2026-07-20

## Goal

Keep lab-history unit normalization presentation-only and fail closed when the
source omits a unit or supplies clinically qualified reference-range text.

## Success criteria

- Unitless numeric lab results retain their raw value with no invented unit and
  are excluded from normalized comparisons, charts, change notes, and ranges.
- Structured reference bounds normalize only when accompanying text is an exact
  numeric representation of the same bounds and compatible unit.
- Calcium, total cholesterol, uric acid, and bilirubin conversions do not add
  global metric ownership, experiment support, goal semantics, or taxonomy.
- Focused owner coverage, web verification, CI, and a ReviewGPT correction round
  pass on the exact pushed head.

## Scope

- In scope: metric projection provenance guard, presentation range parser,
  conversion-only aliases, focused regressions, and PR intent documentation.
- Out of scope: canonical-record rewrites, new persisted provenance, global
  experiment/goal registration, or Health Commons identity changes.

## Tasks

1. Add failing regressions for unitless lab values and qualified or conflicting
   structured-plus-text reference ranges.
2. Implement the smallest fail-closed projection and parser corrections.
3. Remove the four global catalog definitions and unrelated health-area mapping
   while retaining conversion-only normalization rules.
4. Verify, commit, push, update the PR contract, and run ReviewGPT round 2 with
   CI concurrently.

## Evidence

- A production-shaped unitless Total Cholesterol result failed on the original
  PR head by presenting `5.2 mg/dL`; the corrected metric projection and
  presentation selector keep it unitless and out of comparisons, charts,
  change notes, and normalized ranges, including for a stale current-schema
  replica carrying old normalized fields.
- Structured bounds with exact equivalent text still normalize, while fasting,
  conflicting-unit, and conflicting-bound text stays exact and produces no
  chart band.
- All retained calcium, cholesterol, uric-acid, and bilirubin aliases convert
  through shared normalization without global metric definitions; focused
  coverage also proves uric acid remains outside the Kidney taxonomy.
- Private aggregate-only validation found 15 mixed-unit histories in 851 numeric
  results and zero mixed histories after the final normalization rules; no rows
  or direct identifiers were persisted.
- Health-metrics coverage passed 63 tests, query coverage passed 561 tests,
  scenario integrity passed 204 scenarios, and the hosted-web verifier passed
  5,938 tests with 148 skips, lint with zero errors, dev smoke, and production
  build. Coverage and frontend re-reviews returned no remaining findings.
Updated: 2026-07-20
Completed: 2026-07-20
