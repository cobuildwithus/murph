# 2026-03-17 Query Helper Simplify

## Goal

Remove duplicated pure helper logic in `packages/query` without changing exported query or export-pack behavior, and delete `recordToCanonicalEntity` only if it remains unused.

## Constraints

- Preserve ordering exactly for assessment and history sorts.
- Preserve string-array trim, empty-filter, and dedupe semantics exactly.
- Do not change exported query shapes or normalization results.
- Stop and report instead of deleting `recordToCanonicalEntity` if a local reference appears while the task is in flight.

## Scope

- `packages/query/src/export-pack-health.ts`
- `packages/query/src/health/assessments.ts`
- `packages/query/src/health/history.ts`
- `packages/query/src/canonical-entities.ts`
- `packages/query/src/model.ts`

## Plan

1. Extract minimal shared internal helpers for the duplicated comparators and string-array normalization.
2. Repoint callers to those helpers without widening types or adding behavior-changing casts.
3. Delete `recordToCanonicalEntity` only if it is still unreferenced after the refactor.
4. Run query-targeted tests plus required repo checks and completion-workflow audit passes.
Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
