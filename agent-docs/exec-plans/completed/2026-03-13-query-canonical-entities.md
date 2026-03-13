# 2026-03-13 Query Canonical Entities

## Goal

Promote health records into the query package's canonical derived read model so search, timeline, list/show, and export-pack health context all consume the same rebuildable projection.

## Success Criteria

- `packages/query` defines a shared canonical entity shape that covers baseline vault records plus assessments, profile snapshots/current profile, goals, conditions, allergies, regimens, history, family, and genetics.
- `readVault()` materializes that canonical projection and keeps the legacy `VaultRecord`/family arrays available as compatibility views where needed.
- Query health list/read/show helpers read from the shared projection instead of independently scanning files.
- Search and timeline consume the same projection, and CLI search/timeline schemas accept the projected health families.
- Export-pack health context is derived from the same projection instead of re-reading health files through a parallel architecture.

## Constraints

- Keep the canonical projection derived/rebuildable only; do not introduce a new source of truth.
- Work around currently owned files: no edits to `packages/query/src/search-sqlite.ts`, `packages/query/test/query.test.ts`, `packages/cli/src/vault-cli-services.ts`, or other actively claimed surfaces.
- Preserve existing strict/tolerant read semantics where callers depend on them.
- Avoid broad behavioral churn outside the requested query/read surfaces.

## Planned Files

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-query-canonical-entities.md`
- `packages/query/src/canonical-entities.ts`
- `packages/query/src/index.ts`
- `packages/query/src/model.ts`
- `packages/query/src/search.ts`
- `packages/query/src/search-shared.ts`
- `packages/query/src/timeline.ts`
- `packages/query/src/export-pack.ts`
- `packages/query/src/export-pack-health.ts`
- `packages/query/src/health/assessments.ts`
- `packages/query/src/health/history.ts`
- `packages/query/src/health/profile-snapshots.ts`
- `packages/query/src/health/registries.ts`
- `packages/query/src/health/goals.ts`
- `packages/query/src/health/conditions.ts`
- `packages/query/src/health/allergies.ts`
- `packages/query/src/health/regimens.ts`
- `packages/query/src/health/family.ts`
- `packages/query/src/health/genetics.ts`
- `packages/query/test/health-tail.test.ts`
- `packages/cli/src/commands/search.ts`
- `packages/cli/src/query-runtime.ts`
- `packages/cli/test/search-runtime.test.ts`

## Notes

- The compatibility plan is additive first: canonical entities become the base projection, while existing `VaultRecord`-shaped APIs remain available as derived views for already-wired callers.
- Timeline may keep its current public entry envelope while sourcing event/journal/history rows from canonical entities.
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
