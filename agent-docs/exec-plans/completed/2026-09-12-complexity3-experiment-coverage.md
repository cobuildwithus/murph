# Simplify experiment coverage classification with Pro implementation

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal

Reduce the complexity of experiment coverage classification while preserving every public progress snapshot and recommendation. GPT-6 Pro implements the source and focused test changes; the parent session owns applying and independently reviewing the patch.

## Owner and evidence

`packages/query/src/experiments.ts` derives progress from canonical query evidence. At base `486a6595e51bff2a6cfa64beb4ee1a953854a8b6`, its measured complexity debt is 42 and maximum function complexity is 47; `buildCoverageSummary` combines structured evidence, numeric thresholds, and provider reporting. No product defect is asserted. Canonical evidence and existing contract helpers remain authoritative; this change adds no state or external effects.

## Scope and approach

- Change only `packages/query/src/experiments.ts` and focused existing experiment tests in `packages/query/test/`.
- Separate structured-review coverage from numeric status classification at meaningful internal boundaries, normalize repeated count/phase decisions, and preserve provider projection and status precedence.
- Avoid unrelated adherence, outcome analysis, browser-replica, contract, dependency, configuration, export, or documentation changes in the implementation patch. This plan is parent-owned process evidence.
- Keep helpers private, preserve public types and schemas, and avoid frameworks or complexity-threshold changes.

## Risks and proof

Coverage affects review and reminder recommendations. Preserve the legacy-only no-wearable classification, asymmetric 3/2 progress and 3/3 review thresholds, point-measurement 1/1 exception, canonical structured-evidence dates, and review/completed phase gate. Provider availability must not become evidence of numeric metric availability. Existing null fallbacks, ordered decisions, evidence observation cutoff, and output count ownership remain unchanged. No persisted schema, retry, deployment, or rollback contract changes are needed.

## Tasks

1. [x] Establish clean checkout/base, inspect owner docs, coverage source, and existing tests; prepare the ignored Pro implementation prompt.
2. [x] Parent sent the source snapshot and prompt to GPT-6 Pro and retrieved `complexity3-experiment-coverage.patch`; model, request, and attachment verified before application.
3. [x] Inspected all source/test hunks, applied the exact attachment safely, and passed focused proof and complexity comparison.
4. [x] Completed implementation handoff evidence for a scoped commit and draft PR. Parent retains final candidate review, Ready admission, exact-head external review, CI completion, and merge ownership.

## Verification

- `MURPH_VITEST_MAX_WORKERS=1 pnpm --filter @murphai/query test test/experiment-analysis.test.ts test/experiment-open-ended-outcomes.test.ts test/experiment-query-source.test.ts`
- `MURPH_TSC_PACKAGE_CHECKERS=1 pnpm --filter @murphai/query typecheck`
- `pnpm complexity:diff --base 486a6595e51bff2a6cfa64beb4ee1a953854a8b6`
- Require lower measured complexity debt with no changed/new helper above the guard threshold; inspect the actual source for reduced decision duplication. Required exact-head CI owns broad package coverage.

## Current evidence

- GPT-6 Pro implemented the complete source/test patch. Attachment SHA-256: `9eb935ec0a84349d88f3699c62e34a7caafbfcec07eafb5e9b5b10e843ec457e`. All three applied file blob hashes match its Git patch headers; no local source/test redesign was made.
- Focused tests: all 94 tests across the three named files passed. Cases cover asymmetric 3/2 and 3/3 thresholds by phase, supporting-only and missing primary data, planned versus observed point evidence, structured evidence phase gating, and canonical evidence observation dates.
- Query typecheck passed with one checker.
- Complexity guard passed: file debt 42 to 15; maximum 47 to 31. `buildCoverageSummary` is 8, `buildStructuredReviewCoverage` is 4, and `summarizeNumericMetricCoverage` is 20. Unchanged adherence (31) and session-field mapping callback (24) remain separate seams.
- Source review: observed primary anchors select the existing 1/1 review threshold; ordinary windows retain 3/3; progress retains 3/2; legacy missing-data precedence, canonical evidence cutoff, provider lists, and output count ownership remain unchanged. No new state, I/O, awaits, or public exports.
- Install succeeded with the frozen lockfile and default store; Frog listing succeeded. No repository-actionable friction required a new entry.
- Changelog is not applicable: internal behavior-preserving refactor with unchanged member-visible coverage and recommendation semantics.
- Implementation proof is complete; parent-owned final review and required exact-head CI remain pending at draft handoff.
Completed: 2026-09-12
