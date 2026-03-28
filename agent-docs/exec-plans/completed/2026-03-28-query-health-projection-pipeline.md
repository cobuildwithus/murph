# Query Health Projection Pipeline

## Goal

Unify the `@murph/query` read-side health projection for assessments, history, profile snapshots, and current profile around one internal family-entity pipeline plus shared selectors/mappers, while preserving strict-vs-tolerant behavior and canonical file-native sources.

## Scope

- `packages/query/src/model.ts`
- `packages/query/src/export-pack-health.ts`
- `packages/query/src/health/{canonical-collector.ts,assessments.ts,history.ts,profile-snapshots.ts,blood-tests.ts}`
- one or more new internal shared modules under `packages/query/src/health/`
- focused `packages/query/test/{health-tail,query}.test.ts`

## Invariants

- Keep `readVault` strict and `readVaultTolerant` tolerant.
- Keep dedicated narrow readers strict only for their own canonical sources; do not make `listAssessments` or `listHistoryEvents` fail on unrelated health-family files.
- Keep current-profile fallback behavior for malformed or missing `bank/profile/current.md` in the narrow profile reader and tolerant export path.
- Keep sort order, filter semantics, ids, field names, and markdown/body passthrough stable.
- Keep foods out of scope unless a tiny shared helper requires no behavioral expansion.

## Plan

1. Extract shared family entity readers that both the canonical collector and the dedicated narrow readers can reuse.
2. Extract shared selector/mapping helpers for assessments, history, profile snapshots, and current profile.
3. Rewire `readVault`, narrow readers, and export-pack health reads onto those shared helpers without widening failure surfaces.
4. Add parity and regression tests for collector alignment, current-profile fallback, and unrelated-file failure isolation.
5. Run required verification and completion-workflow audit passes, then close the plan.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
