# `@murphai/query`

Workspace-private read-helper, filter, derived-retrieval, and export-pack surface over canonical vault state. Query code must not mutate canonical vault data. It owns the rebuildable local query projection at `.runtime/projections/query.sqlite`, which backs cross-family, aggregate, derived, and lexical-search reads.

Stale projection readers acquire the existing reentrant canonical write lock,
recheck freshness, and rebuild only when needed. Source capture and publication
stay inside that boundary. Ordinary fresh indexed reads take no lock (the
source-health snapshot exception is below). Do not coalesce rebuilds
with a separate pending promise: a lock owner could join a reader waiting for
that same lock. The `query-wait` timing span measures acquisition;
`query-rebuild` measures actual rebuilding.

Exact and family-local reads must not rebuild or hydrate that shared projection.
Use core-owned exact readers when the canonical owner exposes one, or use
`resolveCanonicalEntityInFamily()` / `readCanonicalEntityFamilySource()` for a
bounded query-shaped family read. Alias resolution stays inside the selected
family, and exact canonical ids retain precedence over aliases. Collection
reads that still need projection freshness should use filtered APIs such as
`listCanonicalEntities()` rather than materializing the complete vault model.

Narrow health collection reads should query that projection by family/kind/date
before decoding records. Exact blood-test and immunization lookups use the
bounded event-family source reader so a stale projection cannot turn one-record
lookup into a whole-vault rebuild.

The first retrieval milestone now lives here too: lexical `searchVault()` over the sparse read model plus `buildTimeline()` for descending journal/event/display-grade sample-summary context.

It also owns Murph's semantic wearable read model: deduplicated daily sleep, activity, recovery, body-state, source-health, compact metric points, and assistant-facing day summaries derived from imported wearable evidence. Dense provider telemetry stays in raw evidence or explicit sample-debug ledgers and is not hydrated by default `readVault()` or `readVaultTolerant()` calls. When `readVault().samples` is non-empty, those rows are display-grade `metric_sample` facts from `ledger/metric-samples/**`, not generic raw `ledger/samples/**` telemetry. Use `readVaultRawTolerant()` only for explicit repair/debug source hydration because it bypasses the default projection filters.

HRV projection preserves measurement ownership. The existing provider resolver
emits at most one selected daily `hrv-rmssd` point across WHOOP Recovery, Oura,
and other provider evidence. Apple HealthKit SDNN uses `hrv-sdnn`. The beta
companion estimate uses `whoop-ble-overnight-prv-rmssd` with no generic `hrv`
or biomarker alias, so it cannot silently alias or aggregate with provider HRV.

Root wearable summary APIs should use the runtime projection helpers such as `summarizeWearableLatestRuntime()` and `summarizeWearableActivityRuntime()`. The lower-level read-model helpers in `src/wearables.ts` are package-internal and expect a full raw/debug read model or an intentionally full source model, not the default `readVault()` projection.

### Source-health reads

`summarizeWearableSourceHealthRuntime()` (including `wearables sources list`)
reuses `query_wearable_summaries` in the existing
`.runtime/projections/query.sqlite`. Its independently checked freshness is the
exact ordered canonical manifest (path, size and mtime), encoded in the existing
`query_meta.wearable_source_manifest` entry. This is derived projection metadata,
not a new cache, canonical fact, database, table family or background task. Every
canonical manifest change still invalidates wearable freshness, including an
unrelated note in the same ledger; there is no narrowed invalidation heuristic.

Under core's existing cross-process reentrant canonical lock, a source read checks
one manifest. When stale it reads one strict canonical snapshot, derives and
encodes the ordinary provider rows, and replaces those rows and their manifest
in one SQLite transaction. It captures the stored rows before releasing the
lock. Subsequent reads reuse them without rereading canonical records or
rebuilding provider bundles. Composition runs after capture; an outer lock owner
retains its own lock. No reader joins a shared pending promise.

Source-only publication does not extract global metrics/targets, materialize
entities/search documents, or update their rows, `query_source_manifest`,
`metadata_json` or `built_at`. A missing store gets only the existing wearable
table/indexes and metadata table; global tables remain absent. Global status
requires an actual completed global build,
its matching source manifest, and matching wearable freshness. A partial build
cannot certify an empty global index, even for an empty canonical manifest.
An invalidated existing global index remains stale until its own work completes.

Full query rebuilds check the same wearable manifest and retain already-current
provider rows without deriving, encoding or inserting them again. Global metrics
still derive their distinct evidence from the full snapshot; they are not
replaced with public wearable summaries. Both read orders, including writes,
are covered by the composed benchmark. All refresh work remains synchronous and
is reported through existing CLI timing phases, including `query-rebuild`.

SQLite version **28** gates this partial-publication contract. Version 27 full
rebuilders and version 28 readers use the existing unsupported-version reset
seam when switching generations, then rebuild only derived state. Absent global
tables also make an older in-flight global reader fail its existing table guard
if it checked freshness before the reset. Full schema creation and publication
share one transaction, so failed promotion cannot leave empty global tables.
A wall-clock
`built_at` value is a global completion marker, never generation identity.
Missing/corrupt wearable metadata is stale; unsupported/unreadable databases
are reset. Malformed stored activity evidence fails closed through the existing
codec. Strict canonical errors propagate unchanged, including empty provider
filters. Failed transactional publication rolls back rows and freshness together;
a failed global publication cannot discard a reusable wearable generation.

Source health continues to use the ordinary stored codec and cross-provider
composition, not raw canonical health or stored `source_health` rows alone.
Projected HRV counts and cross-provider diagnostics differ from those shortcuts.
The `sourceHealthOnly` composition option skips discarded public day output; the
preliminary health calculation discarded before conflict merging stays removed.
Keep exact ordinary stored-path output equality as the oracle for provider/date
filters, limits, ordering, counts, diagnostics and provenance. No public schema,
routing or staleness semantics change. See the stored-codec, source-health and
canonical-writer tests and the [paired public-usecase benchmark](../vault-usecases/bench/wearable-sources.md).
Cold, repeated and cumulative results, including both composed read orders,
require independent parent measurement; no speedup is established at handoff.

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

### Journal mirrored sessions

Journal collapses matching cross-provider session copies within an existing
human event before aggregating activity or rendering Records. Matching requires
an explicit absolute interval, the same activity/sleep classification, duration
and interval endpoints within one minute, and at least 90% interval overlap.
Date-only, floating-time, generic-source, same-provider, and conflicting evidence
remains separate. The direct provider is preferred over an Apple Health relay;
the existing source string lists both providers. Canonical evidence and the
source-record count stay unchanged. The existing 1,500-record bound limits this
in-memory comparison. Existing projection refresh publishes the revised view;
there is no new persisted state or client schema.
