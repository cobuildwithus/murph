# 2026-03-17 Current Profile Resolution Simplify

## Goal

Remove duplicated current-profile fallback logic in the query health package while preserving strict, tolerant, sync, and export-facing behavior exactly.

## Scope

- `packages/query/src/health/current-profile-resolution.ts`
- `packages/query/src/health/profile-snapshots.ts`
- `packages/query/src/health/canonical-collector.ts`
- Targeted query tests only if needed to preserve or prove unchanged behavior

## Constraints

- Preserve the latest-snapshot -> current markdown -> stale check -> fallback semantics.
- Keep strict parsing failures throwing and tolerant parsing failures collected exactly as they are now.
- Do not change `markdownByPath` population behavior.
- Keep the helper small; stop short if the abstraction starts requiring broad configuration.

## Plan

1. Extract a shared current-profile resolver around latest snapshot selection, stale detection, and fallback creation.
2. Reuse it from the query read path and the strict/tolerant/sync canonical collectors, and remove dead branches/wrappers left behind.
3. Run targeted query tests, required verification, completion-workflow audits, then commit only the scoped files.

Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
