# `@murphai/query`

Workspace-private read-helper, filter, derived-retrieval, and export-pack surface over canonical vault state. Query code must not mutate canonical vault data. It owns the rebuildable local query projection at `.runtime/projections/query.sqlite`, which backs both canonical read materialization and lexical search.

The first retrieval milestone now lives here too: lexical `searchVault()` over the sparse read model plus `buildTimeline()` for descending journal/event/display-grade sample-summary context.

It also owns Murph's semantic wearable read model: deduplicated daily sleep, activity, recovery, body-state, source-health, compact metric points, and assistant-facing day summaries derived from imported wearable evidence. Dense provider telemetry stays in raw evidence or explicit sample-debug ledgers and is not hydrated by default `readVault()` or `readVaultTolerant()` calls. When `readVault().samples` is non-empty, those rows are display-grade `metric_sample` facts from `ledger/metric-samples/**`, not generic raw `ledger/samples/**` telemetry. Use `readVaultRawTolerant()` only for explicit repair/debug source hydration because it bypasses the default projection filters.

Shared query entity-family metadata now lives on the dedicated `@murphai/query/entity-families` subpath so CLI and contract callers do not need the full query root barrel just to validate record-family flags.

For health registry families, query now consumes the shared projection metadata exported from `@murphai/contracts` instead of maintaining a second per-kind taxonomy table locally.
