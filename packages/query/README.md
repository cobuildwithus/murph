# `@murphai/query`

Workspace-private read-helper, filter, derived-retrieval, and export-pack surface over canonical vault state. Query code must not mutate canonical vault data. It may rebuild local projection artifacts such as the optional SQLite search index at `.runtime/projections/search.sqlite`.

The first retrieval milestone now lives here too: lexical `searchVault()` over the read model plus `buildTimeline()` for descending journal/event/sample-summary context.

It also owns Murph's semantic wearable read model: deduplicated daily sleep, activity, recovery, body-state, source-health, and assistant-facing day summaries derived from imported wearable evidence.

For health registry families, query now consumes the shared projection metadata exported from `@murphai/contracts` instead of maintaining a second per-kind taxonomy table locally.
