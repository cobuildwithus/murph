# `@murphai/query`

Workspace-private read-helper, filter, derived-retrieval, and export-pack surface over canonical vault state. Query code must not mutate canonical vault data. It owns the rebuildable local query projection in three write-once files under `.runtime/projections/`, which backs cross-family, aggregate, derived, and lexical-search reads.

Canonical source collection has asynchronous strict and tolerant modes. Export
packs derive health context from the supplied vault read model; they do not
perform a separate filesystem read.

Stale projection readers acquire the existing reentrant canonical write lock,
recheck freshness, and rebuild only when needed. Source capture and publication
stay inside that boundary. Ordinary fresh indexed reads take no lock (the
focused wearable snapshot exceptions are below). Do not coalesce rebuilds
with a separate pending promise: a lock owner could join a reader waiting for
that same lock. The `query-wait` timing span measures acquisition;
`query-rebuild` measures actual rebuilding.

SQLite version **39** publishes three independent section files. Their definitions
live in `src/projection/schema.ts`; paths come from
`QUERY_PROJECTION_SECTION_RELATIVE_PATHS` in `@murphai/runtime-state/node`.

| Section file under `.runtime/projections/` | Owned tables |
| --- | --- |
| `query-entities.sqlite` | `query_entities`, `query_search_document`, `query_search_fts` |
| `query-metrics.sqlite` | `query_metric_payloads`, `query_metric_points`, `query_metric_targets` |
| `query-wearables.sqlite` | `query_wearable_summary_shapes`, `query_wearable_summaries` |

Every file owns `query_meta`, with `schema_version` and `source_manifest`.
Entities also own `metadata_json` and `built_at`. Certificates encode the ordered
canonical manifest of paths, sizes and mtimes. A section file exists only after
publication: the builder replaces any leftover `<file>.tmp`, creates its tables,
inserts rows and writes its certificate and version in one immediate transaction,
then closes and renames the build file over the published file. Builds use
`journal_mode = MEMORY` and 8192-byte pages, without disk sidecars. Readers open
published files read-only; one open handle retains a complete generation even
if the path is replaced between its dictionary and row reads.

Missing, unreadable or other-version files are stale and rebuilt from source.
Publication failure leaves the previous section file untouched. If a later
section fails, earlier renames remain published under their own certificates,
the error propagates, and capture does not run. A retry publishes stale sections.
Atomic rename provides whole-file visibility; missing or damaged state after
power loss is recovered by rebuilding this derived cache.

`getQueryProjectionStatus().fresh` means all three sections are fresh. Status
exists once any supported section is published. `dbPath` identifies the entities
file; counts and build time describe that section and remain zero/null until it
is published.

`publishQueryProjectionSections()` rechecks the requested sections under the
canonical write lock, reads one strict source snapshot, derives stale sections,
then publishes and captures the caller's rows before releasing the lock.
Validation and derivation finish before any section file is replaced. Entity
readers publish only entities; generic metric readers publish only metrics.
Provider-specific metric points come from wearable rows and use locked wearable
capture. Search summarizes display-grade samples directly when metrics are not
being built. A combined publication shares sample summaries and collects the
wearable dataset once for metrics and wearables.

Explicit `rebuildQueryProjection()` forces all three sections, including fresh
ones. Ordinary publication reuses requested sections whose certificates match.
Entity and metric readers do one unlocked manifest/status check and, when stale,
one locked recheck and publication. CLI phase names stay unchanged: entities
record source read, search documents and publication; metrics add the dataset
and metric phases; wearables add the dataset and summary phases. Separate entity
and metric reads can each read source and publish their own file.

Query SQLite version 30 rebuilds the derived cache with a partial biomarker
index: metric points without a biomarker key remain queryable but occupy no
biomarker-index entries. Replacement files contain only the new generation, so
retired payload bytes are absent from published files. Encrypted snapshots
include exactly the three published section filenames; temporary builds and
legacy shared-store files are excluded. Each snapshot archives all selected
files, including unchanged sections. Canonical source manifests still decide
whether each restored section is fresh.
Malformed plain or archived audit JSONL retains the safe query-source error contract:
logical vault-relative path and line number, without storage parser causes or
source content.
Version 31 creates query databases with 8 KiB pages to reduce overflow-page
waste for JSON-heavy rows. The four standalone entity/search date indexes are
omitted: existing date predicates use `COALESCE`/`substr`, while lexical search
uses FTS rowids. Family/kind, metric, and wearable range indexes remain. Every section build creates this page-size layout. Runtime SQLite stores outside query retain their default page size.
Version 32 stores identical compact metric payloads once per metric publication in
`query_metric_payloads`; metric rows retain their indexed scalars and reference
payloads by integer key. The existing metric query joins the payload table, using
the same codec, filters, order and limits. Metric rows and payloads are built in the same file transaction, so a failed
publication leaves their previous generation intact. An
insertion-local map shares exact serialized payloads without a duplicate text
index; no canonical data or restored SQLite content is omitted.
Version 33 stops projecting untouched legacy Junction oxygen feature measurements
(policy `junction.blood_oxygen_feature_envelope.v1`, device source, `features`
facet, initial event revision). Entity lists, search and generic metric extraction
share this eligibility rule. Historical canonical evidence remains intact; later
revisions remain visible conservatively because they can contain member edits.
Ordinary oxygen readings and v2 temporal features are unchanged. Restored older
query stores rebuild once under this policy; all three query section files remain
part of workspace restore.

Version 35 adds allowlisted typed clinical-fact terms to private search. The
index includes source labels, values, status, coding and qualifiers without
recursing into raw attributes. Safe shared search still excludes structured
payloads. This projection remains rebuildable from canonical notes.

Version 36 clusters metric points in a `WITHOUT ROWID` table keyed by
`(metric_key, effective_date DESC, observed_at DESC, id)`. It removes the unused
metric `sort_rank` and separate metric sort index; the partial biomarker index
remains. An insertion-local ID set preserves global duplicate-ID rejection,
including hash collisions between distinct full identities. Query filters,
ordering, limits and decoded results are unchanged. Unsupported section versions
are replaced from canonical evidence on the next read through their owner.

Run `pnpm exec tsx --expose-gc --tsconfig tsconfig.base.json packages/query/bench/query-projection.ts`
from the repository root with `zstd` installed to measure synthetic rebuild time,
plain bytes, `zstd -9 --long=27` bytes, read correctness and sorted-insertion
packing. The default fixture interleaves four metric keys across 8,000 points.

Version 34 shares ordered JSON field-name dictionaries across wearable summary
rows in `query_wearable_summary_shapes`. Tagged object/array values preserve all
summary facts and internal composition evidence; public summary JSON is unchanged.
Replacement builds rows and dictionaries in the same file transaction. Readers
load both through one read-only handle, including during concurrent publication.
Search documents use an explicit integer primary rowid for external-content FTS
references. Restored section files include their complete rows and dictionaries.

A restored legacy `query.sqlite` is ignored and left alone; current readers build
the new section files. Older runners ignore these section filenames and rebuild
their own legacy cache. The canonical format and query results do not change.

Exact and family-local reads must not rebuild or hydrate that shared projection.
Use core-owned exact readers when the canonical owner exposes one, or use
`resolveCanonicalEntityInFamily()` / `readCanonicalEntityFamilySource()` for a
bounded query-shaped family read. Alias resolution stays inside the selected
family, and exact canonical ids retain precedence over aliases. Collection
reads that still need projection freshness should use filtered APIs such as
`listCanonicalEntities()` rather than materializing the complete vault model.

Event listing uses `listCanonicalEventEntities()` to reuse a fresh entities
section without forcing a rebuild. If missing, stale, unsupported or
wearable-only, it takes the same reentrant canonical write lock, rechecks freshness,
and reads `readCanonicalEntityFamilySource(vaultRoot, "event")` when still needed.
The lock covers strict source capture, lifecycle collapse, visibility and selection;
no cache is published or certified fresh. Kind/date predicates match the existing
indexed operation, including its date fallback. The result is unlimited and in
canonical order so the usecase applies tag/experiment filters before its limit.

A caller that needs only some event kinds passes `{ eventKinds }` to
`readCanonicalEntityFamilySource(vaultRoot, "event", ...)`. Every ledger row is
still parsed and checked, and revisions collapse across all kinds in the same
order, so the result equals the full read filtered by kind; entities are built
only for the surviving rows of those kinds. Event listing passes its kind
filter through when it falls back to the source read.
Event-source errors remain strict; malformed unrelated families no longer block
this event-only read. Explicit global readers retain their existing strict errors
and rebuild policy. No other collection endpoint changes. Manifest/status checks
inspect the entities certificate, and repeated stale event reads reread the ledger.

Experiment listing reads `readCanonicalEntityFamilySource(vaultRoot, "experiment")`
under core's reentrant canonical write lock, including when a global index is
fresh. It preserves strict experiment-source validation, ordering, status-before-
limit and the existing list envelope. Malformed unrelated families no longer
block this list; global readers keep their strict policy. No query cache is read,
published or certified fresh. Repeated lists rescan experiments; a later global
read still performs its own work. Progress, journal and lifecycle APIs are unchanged.

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

### Device readings and health-store copies

When a watch, ring or known wearable source supplies the same daily metric,
its own reading takes precedence over a merged health-store copy, even if
Apple Health or another store syncs later. Sleep-window selection follows the
same rule after its existing main-sleep eligibility checks. Steps retain their
separate worn-coverage rule. Days without a device reading and source-filtered
reads retain health-store evidence. All candidates remain available for
provenance and raw-observation suppression.

Query schema 37 rebuilds prior wearable selections and MetricPoints through
the existing projection owner; canonical records are unchanged.

### Ordinary wearable reads

Day, latest, metric latest/trend, drift, activity, body and recovery runtime
readers use the private `readFreshPublicWearableSummaryBundle()` helper. Its
unlocked preflight uses the same `readProjectionStatus()` predicate as the old
ordinary path: current schema/version and all three sections with matching
certificates and complete tables. Only when that full predicate is fresh does it use the old stored bundle read without
acquiring or waiting for the canonical writer lock.

Otherwise `readFreshWearableSummaryRows()` remains the synchronous owner of the
locked recheck, strict source validation, wearable-only publication and capture.
Wearable-only freshness does not authorize an unlocked read: even an atomic
wearable publication can occur inside an outer reentrant writer before that
writer commits. Sleep-list retains its pre-task direct focused-row read and
normal composition, including on fresh global state; source-health retains its
focused owner and specialized `sourceHealthOnly` composition. Neither gets the
ordinary fast path. Ordinary readers keep their original normal composer and
summarizers, including public days and source health.

Ordinary readers push only provider selection into the stored-row read.
Sleep-list additionally pushes its day-prefixed `date`/`from`/`to` bounds, but
never a summary-kind filter: composed multi-provider sleep reads shared
recovery/activity keys such as HRV and SpO2. In every reader the composer still
applies date and range filters, ordering, complete cross-provider composition
and limits, preserving prior/next canonical evidence. At the
service boundary an omitted or empty provider array is unrestricted; a nonempty
array normalized to no providers selects nothing.

Multi-provider composition ends in `projectPublicWearableSummaryBundle()`, which
copies the composed plain objects directly instead of stringifying and parsing
each summary. The copy applies the same key policy as
`stringifyPublicWearableProjectionSummary()` (emptied `candidates`, `paths` and
`recordIds`; omitted provenance keys) and the same JSON value results, with
fresh containers. It is not a general serializer: any value outside that plain
shape, such as a prototype other than `Object`/`null`, `toJSON`, bigint or an
over-deep graph, takes the unchanged stringify/parse path and its errors. The
current composer produces only plain objects; it does not define accessors or
proxies, and the copy makes no promise about them. Stored rows, the stored
codec and the stringify function itself are unchanged, so persisted and public
bytes are identical.

The exact ordered path/size/mtime manifest, strict current canonical validation,
atomic row/dictionary/manifest publication and failure behavior below apply to
all these readers. Corrections, deletions, unrelated ledger edits and timestamp-
only manifest changes still invalidate freshness. This preserves the timestamp
contract; it does not assert how frequently timestamp-only changes occur in
production or introduce a restore workaround. Even an empty selected provider
scope must validate stale canonical input. Every canonical manifest change
invalidates section freshness.

Cold/stale ordinary reads publish no global metrics/targets, entities/search,
entity metadata. Later entity and metric reads still publish their own files,
reusing current wearable rows. An explicit full rebuild
forces all sections. This
avoids global work for wearable-only workflows and defers it for mixed workflows;
complete mixed costs must include that later work. Fresh global rows remain
reusable without the new lock wait introduced by the first implementation packet.

The fresh-global check and stored read are not one canonical transaction, just
as before this task. A canonical write after the fresh observation may leave
that request reading the prior projection; the next request checks again. The
stored reader's open immutable file captures its dictionary and rows in one
generation. A missing or malformed section file after the check retains the
direct reader's error behavior and empty-provider short-circuit. There is no catch-and-retry, optimistic wearable-only
branch, schema-race repair protocol or stronger commit guarantee.

Refresh remains synchronous when the checks require it; there is no new stale-
while-refresh policy. The existing CLI process already keeps this CPU work off
the hosted conversation event loop. The canonical lock remains the focused
source/publication boundary, not a claim that every fresh read is nonblocking.
There is no background owner, daemon, pending-promise coordinator, monitor or
member-fact cache. A stale focused refresh still reads the
strict canonical snapshot required by the existing wearable owner, rather than
pretending unrelated malformed input can be ignored.

Timing charges the global preflight and any focused recheck separately: one
`query-freshness` span containing manifest/status on the fast path, or two
non-overlapping freshness spans on fallback, with the latter including lock wait
and required refresh work. Manifest/status subspans remain inclusive; do not add
them to their parent spans or omit the extra preflight from workflow costs.

Sleep-pattern also captures current timezone metadata. It uses stored entity
metadata only when all sections are fresh; otherwise it reads canonical metadata
and captures wearable rows under one reentrant lock, without publishing entities.
See the
[ordinary-read and whole-rebuild proof](../vault-usecases/bench/global-projection.md)
for the eight-reader oracle, real CLI/assistant gates, exact byte comparisons,
phase counts and paired workflow measurement. Parent evidence is required before
claiming a measured improvement. The historical
[sleep-list proof](../vault-usecases/bench/wearable-sleep.md) remains unchanged.

### Blood-test lists and Browser Vault reuse

`listBloodTests()` acquires unlimited test events through the existing
`listCanonicalEventEntitiesRuntime()` owner. Fresh entity-section rows remain a
read accelerator; otherwise that owner captures strict current events under the
reentrant canonical lock without publishing any projection. Every stale repeat
re-reads events; no stale facts or new cache is introduced. Blood classification,
text/status/date filtering and stable ordering still precede the final limit.
Malformed selected event sources still fail, including for empty result scopes;
unrelated malformed families no longer force an unrelated global read. A later
explicit global query still performs its necessary validation/publication work.
Generic entity queries and other health collections keep their original policy.

Browser Vault builds one default-visible wearable bundle for source health and
the assistant summary. `buildWearableAssistantSummaryFromBundle()`
expects an already-filtered normal bundle; the existing public vault wrapper
still performs the same filtering and returns the complete original summary.
There is no persistent cache. Raw/default visibility, journal input, cancellation
yields, timestamps and dataVersion hashing are unchanged. This remains correct
whether the upstream source reader returns raw or already-filtered entities.

The proposed single-pass metric aggregation is not implemented: exported evidence
constructors accept noncanonical date strings whose locale equality makes the
unchanged comparator nontransitive. The new cross-producer differential regression
records the concrete parity boundary instead of changing ordering, validation or
adding a fallback. See the [incremental benchmark and proof](../vault-usecases/bench/global-projection.md#incremental-additions-first-packet-versus-this-packet).

### Empty stored-envelope verification

The stored codec reuses only module-private expected-empty JSON strings for the
finite summary metric keys. Each string comes from the same `resolveMetric(key,
[])` constructor and public serializer used by the previous write-side check.
Every actual envelope is still serialized and compared **exactly**, including
field order and unexpected fields; a mismatch still stores the full envelope.
Nonempty verification is unchanged. Stored/public bytes and the SQLite version
are unchanged; no member facts, decoder objects or parsed JSON are cached.
Decoding still constructs fresh objects/arrays for each empty metric and each
read. Call-count tests distinguish removed expected serialization from the
required actual-envelope comparison, while existing codec tests retain sparse,
rich, conflict and fallback coverage.

### Source-health reads

`summarizeWearableSourceHealthRuntime()` (including `wearables sources list`)
reuses `query_wearable_summaries` in the existing
`.runtime/projections/query-wearables.sqlite`. Its independently checked freshness is the
exact ordered canonical manifest (path, size and mtime), encoded in the existing
`query_meta.source_manifest` entry. This is derived projection metadata,
owned by the wearable section file, not canonical truth or a background task. Every
canonical manifest change still invalidates wearable freshness, including an
unrelated note in the same ledger; there is no narrowed invalidation heuristic.

Under core's existing cross-process reentrant canonical lock, a source read checks
one manifest. When stale it reads one strict canonical snapshot, derives and
encodes the ordinary provider rows, and builds their rows and manifest in one
temporary-file transaction. It closes the file and publishes it by rename, then
captures the stored rows before releasing the
lock. Subsequent reads reuse them without rereading canonical records or
rebuilding provider bundles. Composition runs after capture; an outer lock owner
retains its own lock. No reader joins a shared pending promise.

Source-only publication replaces wearable rows, their shape dictionary and the
wearable certificate together in a new file. Entity and metric files, including
their certificates, `metadata_json` and `built_at`, retain their prior generation.
On a cold vault only the wearables file is created; full status remains stale
until every section publishes.

A non-forced publication of all sections retains current provider rows without
deriving, encoding or inserting them again. An explicit full rebuild forces
wearable publication too. Metrics derive their own evidence from the strict
snapshot. Both read orders, including writes, are covered by the composed
benchmark. All refresh work remains synchronous and uses existing timing phases.

Version 39 isolates these files from the legacy shared projection. Section
schema creation, row insertion and certificate writes share one transaction in
the temporary file. `built_at` records entity publication time; each section's
certificate decides its freshness. Missing/corrupt wearable metadata is stale;
unsupported/unreadable files are replaced on the next read through their owner.
Malformed stored activity evidence fails closed through the existing codec.
Strict canonical errors propagate unchanged, including empty provider filters.
A failed section build leaves its published file byte-identical and retryable.
Earlier sections published during a failed multi-section call remain valid;
capture runs only after all requested publications succeed.

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

## Wearable confidence storage

Metric confidence retains level, candidate/duplicate counts and conflicting
providers; selected values and source/provider fields keep their existing owners.
Per-metric English `reasons` are neither built, stored nor projected. Readers
ignore that field in older compact and full envelopes without a SQLite schema
version bump, database reset or read-time reconstruction. Fresh legacy rows stay
readable. The next canonical source change invalidates the existing wearable
manifest; the next wearable read publishes only wearable summaries and their
shape dictionary. Global entities, metrics and search are untouched.

Activity candidate and session evidence remains necessary: provider-local winners
and selected metric points cannot reconstruct cross-provider ranking or session
overlap reduction. Publication replaces the wearable section file, leaving no retired payload
bytes in its new generation. Other section files are reused when fresh.

### Sleep summary card read

`resolveWearableSleepCardNight(vaultRoot, { wakeDate })` selects one eligible
night by localized wake date from a bounded adjacent stored-date read. It
retains total-only evidence, excludes naps/short/tentative sessions, returns
recovery on the wake date with resting HR from the night's provider when present
(otherwise the cross-provider selection on that date), and optionally enriches absent RMSSD
with canonical SDNN samples inside the sleep window. Night timezone precedes
validated vault reporting timezone. `wearables day` semantics are unchanged.

Apple HealthKit RHR is labeled `Apple Watch` only when the selected reading's
preserved `source.type` is `watch`. Junction documents that its Apple HealthKit
watch tag identifies first-party Apple Watch data; third-party apps remain
`unknown`, and combined data is `multiple_sources`. Those records retain the
Apple HealthKit label and cannot select a device-specific benchmark. A tagged
Apple Watch reading also takes precedence over an unidentified store copy.
See [Junction data attributions](https://docs.junction.com/wearables/providers/data-attributions).
The Health SDK's daily RHR statistics can lack per-reading device identity;
knowing that a watch is connected does not establish the source of such a value.
