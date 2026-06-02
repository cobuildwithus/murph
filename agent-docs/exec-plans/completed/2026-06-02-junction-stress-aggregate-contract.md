# Junction Stress Aggregate Contract

## Goal

Fix Junction Garmin `stress_level` imports so compact daily stress facts pass the
canonical event contract and reach the wearable recovery summary without
admitting dense timeseries into the default read model.

## Success Criteria

- Junction stress timeseries remains retained as raw evidence.
- The importer emits one compact daily observation per provider/source/day using
  the existing `summary` observation grain.
- Importer/core proof shows the normalized stress payload can be written through
  `importDeviceBatch`.
- Query proof shows the written fact is reachable as `stressLevel`.
- No new tables, projections, background workers, or schema expansion.

## Constraints

- Preserve foreground assistant priority; do not add device-sync work to the
  reply path.
- Do not log or fixture raw provider payloads from live local data.
- Keep provider-specific behavior inside the Junction importer/device-sync
  seams.
- Preserve unrelated dirty files and active ledger rows.

## Plan

1. Confirm Junction docs and local code agree that `stress_level` is high
   frequency timeseries.
2. Replace the invalid stress aggregate event fields with the existing compact
   observation shape.
3. Add focused importer/core/query regression coverage for stress import
   contract and recovery-summary reachability.
4. Run focused tests, typecheck as available, required audits, and close the
   plan through the repo commit workflow if the overlapping dirty tree allows it.

## Verification

- Focused importer/core/query tests for Junction stress aggregate import.
- `pnpm typecheck`.
- Runtime proof in hosted-local dev after reset or dirty-state clear if needed.
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
