Goal (incl. success criteria):
- Land daily-grain HRV, respiratory rate, and VO2 max for Junction wearable members.
- Enable the `hrv` and `respiratory_rate` timeseries resources by default and add `vo2_max` end-to-end (known + default timeseries resource) so Apple HealthKit relay members get nightly HRV/RR and sparse VO2 max observations.
- Normalize all three to daily observations through the existing compact daily-aggregate path (mirror `blood_oxygen`/`stress_level`), keeping raw artifacts bounded (~430 B/day/resource, measured on a live member's blood_oxygen artifacts).
- Keep intraday `heartrate` and `hypnogram` excluded from defaults and document why at the defaults seam.

Constraints/Assumptions:
- Junction classifies `hrv` and `respiratory_rate` as discrete timeseries and `vo2_max` as an interval timeseries (docs.junction.com/wearables/providers/resources; api-reference/data/timeseries/{hrv,respiratory-rate,vo2-max}).
- Raw volume must stay bounded: only compact `junction.timeseries_daily_aggregate.v1` artifacts, no raw intraday sample dumps.
- Env overridability of resource lists (JUNCTION_*_RESOURCES env CSV) must be preserved; no new env keys.
- `body` already has an observation mapping (BODY_METRICS); the live member's HealthKit relays `body: []`, so no importer change needed there.
- Preserve unrelated worktree edits and active ledger rows.

Key decisions:
- Wire the three resources as defaults (same lane as `blood_oxygen`), not opt-in, because the user requires them to land for all members.
- Reuse `buildJunctionDailyTimeseriesAggregates`; add per-resource value paths + plausibility normalizers and a shared daily observation pusher instead of three bespoke copies.
- Emit metrics through the existing catalog keys: `hrv` (ms), `respiratory-rate` (breaths_per_minute), `estimated-vo2-max` (ml/kg/min).

State:
- Complete; pending finish-task commit and PR.

Done:
- Research + empirical raw-size calibration (blood_oxygen compact artifacts: 216 files, mean 431 B/day).
- Resource sets + descriptor-driven importer normalization + tests landed.
- pnpm test:diff full fanout green; security-privacy-review (clean), simplify (3 low findings applied), coverage-write (no gaps), task-finish-review run.

Now:
- finish-task commit, push branch, open PR.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/importers/src/device-providers/junction-resources.ts
- packages/importers/src/device-providers/junction.ts
- packages/importers/test/device-providers-junction.test.ts
- packages/device-syncd/test/junction-provider.test.ts (expectation updates only if defaults are asserted)
- pnpm test:diff packages/importers packages/device-syncd
Status: completed
Updated: 2026-06-11
Completed: 2026-06-11
