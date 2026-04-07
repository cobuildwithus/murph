# Query Projection Greenfield Hard Cut

## Goal

Remove the remaining legacy-compatibility path from the query projection store so the projection is a true greenfield hard cut: one supported schema only, and unsupported local stores are discarded and rebuilt from canonical vault data.

## Why

- The query projection is rebuildable local state, so compatibility migrations are not worth the complexity cost before production.
- The long-term simplest architecture is one supported projection schema, one rebuild path, and no upgrade-era compatibility logic.

## Scope

- `packages/query/src/query-projection.ts`
- `packages/query/test/query.test.ts`
- `docs/contracts/03-command-surface.md`

## Non-goals

- No query feature work
- No change to tolerant read behavior
- No change to gateway ownership or hosted behavior
- No workflow-doc changes in this follow-up

## Target End State

- The current query projection schema is the only supported schema.
- Unsupported local projection stores are deleted and rebuilt from canonical vault sources instead of being migrated.
- Tests cover rebuild and read/search behavior against unsupported dev-era stores.

## Risks / Invariants

- The store remains rebuildable and machine-local only.
- Strict reads/search keep using the shared query projection.
- Unsupported local projection files must fail closed into rebuild, not partial reuse.

## Verification target

- Focused query typecheck and query tests
- Direct query projection rebuild/search scenario
- Required final completion audit

## Planned files

- `packages/query/src/query-projection.ts`
- `packages/query/test/query.test.ts`
- `docs/contracts/03-command-surface.md`

Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
