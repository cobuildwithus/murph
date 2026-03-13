## Goal

Finish the CLI app-layer cutover to the generic entity model by switching the generic `show` and `list` paths to query's canonical entity APIs.

## Scope

- `packages/cli/src/vault-cli-services.ts`
- `packages/cli/test/health-tail.test.ts`

## Constraints

- User explicitly instructed this turn to finish the CLI cutover despite overlapping active ownership on `packages/cli/src/vault-cli-services.ts`.
- Keep dedicated noun-specific commands (`goal`, `condition`, `regimen`, `family`, `profile`, `history`, `intake`, etc.) on their existing descriptor-based behavior.
- Only generic read paths should move to `lookupEntityById()` / `listEntities()`.

## Plan

1. Update the generic `show` path to use `lookupEntityById()`.
2. Update the generic `list` path to use `listEntities()`.
3. Add/adjust a CLI regression test that proves generic reads return canonical entity data for non-health-specific generic flows.
4. Run the narrowest relevant CLI/query verification first, then repo checks as far as the shared tree allows.
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
