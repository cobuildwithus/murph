# 2026-03-29 Query Family Map

## Goal

Move `VaultReadModel` toward a family-map shape by adding `byFamily` as the canonical record grouping while keeping the existing convenience fields stable.

## Scope

- Refactor `packages/query/src/model.ts` so `readVault*` builds one `byFamily` map instead of manually fan-out filtering every family.
- Keep existing `VaultReadModel` convenience fields (`goals`, `conditions`, `currentProfile`, and peers) derived from `byFamily` to avoid unnecessary downstream churn.
- Update direct test fixtures that construct `VaultReadModel` objects by hand.

## Constraints

- Treat the payload-first schema move as already complete unless the query refactor proves otherwise.
- Do not change record ordering, identity semantics, or existing convenience-field names.
- Keep the change query-scoped; do not widen into export-pack or CLI refactors unless a type edge requires a minimal compatibility follow-up.

## Verification Plan

- Focused query package typecheck/build plus targeted query tests covering manual read-model fixtures.
- Required completion audit passes via spawned subagents:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`
- Required repo checks:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
