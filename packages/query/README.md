# `@murphai/query`

Workspace-private read-helper, filter, derived-retrieval, and export-pack surface over canonical vault state. Query code must not mutate canonical vault data. It owns the rebuildable local query projection at `.runtime/projections/query.sqlite`, which backs both canonical read materialization and lexical search.

Narrow health reads should query that projection by family/kind/date before
decoding records. In particular, blood-test list/show must not hydrate the full
projected vault; blood-specific classification and text matching run over the
filtered `event`/`test` candidate set.

The first retrieval milestone now lives here too: lexical `searchVault()` over the sparse read model plus `buildTimeline()` for descending journal/event/display-grade sample-summary context.

It also owns Murph's semantic wearable read model: deduplicated daily sleep, activity, recovery, body-state, source-health, compact metric points, and assistant-facing day summaries derived from imported wearable evidence. Dense provider telemetry stays in raw evidence or explicit sample-debug ledgers and is not hydrated by default `readVault()` or `readVaultTolerant()` calls. When `readVault().samples` is non-empty, those rows are display-grade `metric_sample` facts from `ledger/metric-samples/**`, not generic raw `ledger/samples/**` telemetry. Use `readVaultRawTolerant()` only for explicit repair/debug source hydration because it bypasses the default projection filters.

HRV projection preserves measurement ownership. The existing provider resolver
emits at most one selected daily `hrv-rmssd` point across WHOOP Recovery, Oura,
and other provider evidence. Apple HealthKit SDNN uses `hrv-sdnn`. The beta
companion estimate uses `whoop-ble-overnight-prv-rmssd` with no generic `hrv`
or biomarker alias, so it cannot silently alias or aggregate with provider HRV.

Root wearable summary APIs should use the runtime projection helpers such as `summarizeWearableLatestRuntime()` and `summarizeWearableActivityRuntime()`. The lower-level read-model helpers in `src/wearables.ts` are package-internal and expect a full raw/debug read model or an intentionally full source model, not the default `readVault()` projection.

Junction workout-stream facets are grouped by their internal hashed workout
identity during projection rebuild and stored inside the existing
provider-scoped activity summary rows. The runtime activity read stays
date/provider-filtered and never hydrates `query_entities` to answer workout
feature questions. Public power keys end in `Watts`, speed keys end in `Mps`,
and raw workout/source-instance identifiers remain projection-internal.

Meal nutrition has two intentionally separate reads. `readMealNutritionTotals()`
keeps the compact five-metric card contract, while `readMealNutrientTotals()`
returns water plus the bounded supported micronutrient catalog only when a
nutrient question needs it. The nutrient read emits every supported field in a
stable order with `null` for unavailable totals and a per-field contributing
meal count so callers can distinguish missing, partial, and explicit-zero data.
It does not infer unlogged meals or reproduce source-app targets or daily
percentages.

Shared query entity-family metadata now lives on the dedicated `@murphai/query/entity-families` subpath so CLI and contract callers do not need the full query root barrel just to validate record-family flags.

For health registry families, query now consumes the shared projection metadata exported from `@murphai/contracts` instead of maintaining a second per-kind taxonomy table locally.
