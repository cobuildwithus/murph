Goal (incl. success criteria):
- Extend the Junction timeseries descriptor seam (PR #138) with the tier-1 default resources: body_temperature_delta, body_temperature, basal_body_temperature, caffeine, water, mindfulness_minutes, heart_rate_recovery_one_minute, sleep_breathing_disturbance, afib_burden, glucose, and blood_pressure.
- All single-value resources land through the bounded daily-aggregate path only (one compact `junction.timeseries_daily_aggregate.v1` artifact per day per resource); glucose (CGM, up to 288 samples/day) must never land raw samples.
- Extend the descriptor statistic seam minimally with `sum` (caffeine/water/mindfulness daily totals) and `max` (glucose daily max).
- blood_pressure is sparse paired data; land each reading as one `measurement` event (systolic + diastolic mmHg entries) with one bounded compact raw artifact per reading.
- Tests mirror the #138 patterns (per-resource normalization + allowlist + size-bounding); seam comment documents per-resource size budget.

Constraints/Assumptions:
- Junction resource slugs and payload field names verified against docs.junction.com (wearables/providers/resources; api-reference/data/timeseries/*): interval resources use start/end + value; glucose/blood_pressure are discrete (timestamp); blood_pressure uses `systolic`/`diastolic` fields in mmHg; glucose is normalized by Junction to mmol/L; caffeine documented "Measured in grams"; water "Measured in milliters" (ml); body_temperature(/-delta/basal) in degC, delta may be negative.
- TIMESERIES side only; summary-resource handlers (menstrual_cycle/profile/electrocardiogram) are owned by a sibling agent and must not be touched.
- Raw cost stays bounded: ~430 B/day/resource for daily aggregates; per-reading BP artifacts are sparse (10s-100s/yr).
- Stacked branch: based on `junction-hrv-rr-vo2max-daily` (PR #138); PR opens with that base.

Key decisions:
- All eleven resources become defaults (sparse/daily/event-grain always lands; permission breadth decoupled from import volume; allowlist + bounded mappings are the size gate).
- Glucose converts mmol/L -> mg/dL at import (x18.0182, matching `packages/health-metrics` glucose canonical unit), plausibility window 1-35 mmol/L on input; emits glucose (mean), lowest-glucose (min), highest-glucose (max).
- Blood pressure uses the canonical `measurement` event kind (paired `measurements` entries flow through `buildMeasurementMetricCandidates`); requires systolic > diastolic and per-field plausibility windows (60-260 / 30-160 mmHg). Reading identity (externalRef + artifact role) includes the paired values so same-second readings never collapse.
- The wearable metric catalog (`packages/importers/src/device-providers/metric-catalog.ts`) gains entries for all new metric keys so the wearables candidate path surfaces them (simplify-audit finding, accepted and fixed).
- Metric keys reuse catalog keys/conventions where they exist (`temperature`, `temperature-deviation`, `glucose`, `systolic-blood-pressure`, `diastolic-blood-pressure`); uncataloged keys follow the existing slug convention (`caffeine`, `water`, `mindfulness-minutes`, `heart-rate-recovery-one-minute`, `sleep-breathing-disturbance`, `afib-burden`, `basal-body-temperature`), mirroring the `stress-level` precedent.

State:
- Implementation + tests landed; verification and audits green; ready for finish-task commit and stacked PR.

Done:
- Junction docs verified for all eleven slugs and payload shapes.
- Descriptor entries, sum/max statistic seam, normalizers, blood-pressure handler, allowlist updates, seam budget comment.
- Tests extended in packages/importers + device-syncd default-resource expectations.
- pnpm test:diff packages/importers packages/device-syncd green; typecheck green.
- security-privacy-review, simplify, coverage-write, task-finish-review run; findings resolved.

Now:
- finish-task commit, push, open stacked PR with per-resource size table.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/importers/src/device-providers/junction-resources.ts
- packages/importers/src/device-providers/junction.ts
- packages/importers/src/device-providers/metric-catalog.ts
- packages/importers/test/device-providers-junction.test.ts
- packages/importers/test/metric-catalog-coverage.test.ts
- packages/device-syncd/src/providers/junction.ts (redundant glucose literal only)
- packages/device-syncd/test/junction-provider.test.ts (defaults expectations)
- pnpm test:diff packages/importers packages/device-syncd
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
