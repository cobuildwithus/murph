# `@healthybob/query`

Owns read helpers, filters, derived retrieval state, and export-pack generation over canonical vault state. Query code must not mutate canonical vault data. It may rebuild local `.runtime/` artifacts such as the optional SQLite search index at `.runtime/search.sqlite`.

The first retrieval milestone now lives here too: lexical `searchVault()` over the read model plus `buildTimeline()` for descending journal/event/sample-summary context.
