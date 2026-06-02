# Junction Stress Timeseries Aggregate

## Goal

Correct Junction stress-level ingestion so stress stays reachable in wearable recovery summaries as one daily aggregate per provider/day, without treating dense provider samples as summary observations.

## Scope

- Reclassify Junction `stress_level` as a timeseries resource.
- Remove generic `stress_level` summary observation mapping.
- Add importer-owned daily aggregate observations for stress timeseries.
- Update focused importer and device-sync tests.

## Non-Goals

- No repair/tombstone path for already-polluted local vaults.
- No query-side special case or aggregation framework.
- No broad Junction provider refactor.

## Verification

- Focused importer and device-sync tests for Junction stress resource behavior.
- `pnpm typecheck`.
- Scoped/diff verification if available.
Status: completed
Updated: 2026-06-01
Completed: 2026-06-01
