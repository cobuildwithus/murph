# Profile Current Generated View

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Keep `bank/profile/current.md` as a generated human-facing view of the latest profile snapshot instead of a second near-canonical source, while letting repair rebuild it and letting query reads synthesize it from snapshots when it is stale or missing.

## Success criteria

- Core current-profile materialization lives behind one shared helper instead of duplicated renderer logic.
- `repairVault` recreates or refreshes `bank/profile/current.md` when profile snapshots exist and the generated page is missing or stale.
- Query-side current-profile reads and tolerant collectors synthesize generated markdown/body from the latest snapshot when the materialized page is stale or missing, without writing through query.
- Durable docs and CLI copy describe `bank/profile/current.md` as generated/materialized output owned by rebuild or repair.
- Focused core/query tests cover the repaired/synthesized paths.

## Scope

- In scope:
- shared current-profile materialization helper used by core and query
- `packages/core` current-profile repair/materialization wiring
- `packages/query` stale/missing current-profile synthesis behavior
- focused docs/copy updates for generated-view ownership
- targeted tests in `packages/core` and `packages/query`
- Out of scope:
- changing profile snapshot authority or schema
- promoting query reads into canonical writes
- broader health read-model refactors

## Constraints

- Preserve snapshot ledger authority; `ledger/profile-snapshots/**` remains the durable truth.
- Keep query read-only relative to canonical vault writes.
- Preserve malformed-current tolerant fallback behavior; missing or stale generated files should no longer degrade user-facing reads.
- Preserve orphan current-profile handling: no snapshots still means no current profile.

## Risks and mitigations

1. Risk: shared materialization drifts between core writes and query fallback rendering.
   Mitigation: use one shared helper and update tests on both sides to assert the same generated content shape.
2. Risk: repair starts mutating healthy vaults unnecessarily.
   Mitigation: only rebuild when the expected generated markdown differs or the file is missing.
3. Risk: tolerant collectors accidentally keep treating the current-profile file as authoritative when it is stale.
   Mitigation: continue latest-snapshot staleness checks and retain generated fallback only when the document is current.

## Tasks

1. Register the lane and inspect current profile materialization, repair, and query fallback paths.
2. Add the shared current-profile materializer and rewire core to use it.
3. Make query synthesize generated current-profile markdown/body from snapshots when the page is stale or missing.
4. Update docs/copy to describe the page as generated output owned by rebuild/repair.
5. Run focused verification, mandatory review, and finish with a scoped commit.

## Decisions

- Prefer a shared pure materializer over query-local duplication so the generated page shape has one owner.
- Keep on-disk writes in core (`rebuildCurrentProfile` / `repairVault`) and keep query regeneration in-memory only.

## Verification

- Planned commands:
- `pnpm --dir packages/contracts test`
- `pnpm exec vitest run packages/core/test/profile.test.ts packages/core/test/core.test.ts packages/query/test/health-tail.test.ts --no-coverage`
- `pnpm typecheck`
Completed: 2026-04-07
