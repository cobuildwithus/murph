# 2026-03-29 Query Link Normalization

## Goal

Normalize query-internal entity relationships into a consistent `links[]` shape while keeping current `relatedIds`-based outward surfaces stable.

## Scope

- Add a canonical query link type/model in `packages/query/src/canonical-entities.ts`.
- Parse registry, profile, event, journal, and other query entity relationships into normalized links.
- Thread links through `CanonicalEntity` and `VaultRecord`.
- Keep `relatedIds` as a compatibility projection derived from links.
- Update the narrow query consumers and tests that construct records/entities manually.

## Constraints

- Do not rewrite vault markdown/frontmatter formats.
- Preserve existing outward query record shapes and `relatedIds` behavior unless the normalized model proves a real existing inconsistency.
- Respect the active non-exclusive profile-snapshot hard-cut lane touching `packages/query/src/canonical-entities.ts`; keep this pass limited to relationship normalization.

## Verification Plan

- Focused query package build/typecheck.
- Focused query tests covering registry projection, record projection, timeline/search compatibility, and manual fixture helpers.
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
