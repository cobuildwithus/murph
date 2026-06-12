# Junction Tier-2 Summary Resources: profile, menstrual_cycle, electrocardiogram, meal micros

Status: completed
Owner: Claude (murph-junction-tier2-summaries worktree, stacked on `junction-hrv-rr-vo2max-daily` / PR #138)

## Goal

Land the remaining sparse Junction SUMMARY resources as normalized vault records per the
companion-app data-capture posture (sparse/daily/event-grain data always lands; raw bulk never does):

1. `profile`: fill the current no-op handler; promote from opt-in to default. Map height plus
   birth date / biological sex / wheelchair use (Junction `ClientFacingProfile`:
   `height` int cm, `birth_date` date, `sex`/`gender` enums, `wheelchair_use` const-true|null).
2. `menstrual_cycle`: promote from raw-only to a real default mapping
   (Junction `ClientFacingMenstrualCycle`): per-cycle period/cycle length observations plus
   dated facets from `menstrual_flow`, `basal_body_temperature`, `ovulation_test`,
   `home_pregnancy_test`, and `detected_deviations` sub-arrays. Skip `is_predicted` cycles
   (no probabilistic upstream state as certainty). ~13 cycles/yr; tiny volume.
3. `electrocardiogram`: add to the default summary allowlist with a per-recording
   `measurement` event: classification + inconclusive_cause qualifiers, mean heart rate,
   voltage sample count, `session_start` timestamp. Do NOT touch `electrocardiogram_voltage`
   (excluded raw waveform). Junction ECG summary requires date-format `start_date`, so the
   device-syncd client adds it to the date-only summary set.
4. meal micronutrients: extend `pushMealSummary` to land the documented `micros`
   minerals/trace-element/vitamin keys (bounded, skip null/zero) plus `macros.water` grams on
   the existing meal event nutrition. Requires an additive contracts extension:
   `nutritionDataSchema.waterGrams` and `mealNutritionSchema.micros` (strict, documented keys only).

## Scope

- `packages/importers/src/device-providers/junction-resources.ts` (SUMMARY allowlist arrays only;
  a sibling agent owns the timeseries arrays/descriptor region)
- `packages/importers/src/device-providers/junction.ts` (summary dispatch/handlers region only)
- `packages/contracts/src/zod.ts` (+ exports) for water/micros nutrition extension
- `packages/core/src/nutrition.ts` so the public addMeal path does not drop schema-valid micros/water
- `packages/device-syncd/src/providers/junction-client.ts` date-only summary set
- Tests in `packages/importers/test/device-providers-junction.test.ts` and touched-owner tests

## Verification

- `pnpm test:diff packages/importers packages/device-syncd` (plus contracts/core fanout via diff lane)
- Required audits: security-privacy-review (reproductive-health + ECG persisted surfaces),
  coverage-write, task-finish-review.

## Notes

- PR is stacked: base `junction-hrv-rr-vo2max-daily`, never merge.
- Schema claims verified against docs.junction.com/api-reference/data/* and the Junction OpenAPI spec.
Updated: 2026-06-12
Completed: 2026-06-12
