# Query projection: rebuild only the section a reader reads

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

After any vault write, the first `search query`, `timeline` or metric read
rebuilds the whole query projection, including wearable evidence and metric
points that the reader never touches. On the largest production vault a stale
`search query` averaged 13.8 s of rebuild (max 39 s) inside a reply turn in the
week before 2026-11-10. Search needs entities and search documents only.

Outcome: one publication function that reads the canonical source once and
builds only the stale sections the caller asked for. A stale search stops
paying for wearable and metric work. No reader gets less fresh data than today.

## Measured baseline

Real 87 MB vault copy, Apple silicon, bundled CLI (production is about 4x
slower per call):

| Stage of a full rebuild | ms |
| --- | --- |
| Strict source read (68,372 entities) | 365 |
| Wearable dataset (`collectWearableDataset`) | 518 |
| Wearable summary rows | 820 |
| Metric projection (evidence, extract, precedence) | 919 |
| Publication (inserts, FTS, VACUUM) | about 200 |

| Command, stale projection | Today | Expected |
| --- | --- | --- |
| `search query` (nothing published yet) | 3,147 ms | about 800 ms |
| `timeline` after a wearable-only publication | 2,326 ms | about 700 ms |
| `wearables latest` | 2,259 ms | unchanged |

Production, 15 hours after the 2026-11-10 01:12Z deploy: rebuilds are 25% of
all in-process CLI time (23 rebuilds in 213 calls, 8 of them full rebuilds).

## Current shape

`packages/query/src/projection/rebuild.ts` holds two divergent publications:

- `rebuildQueryProjectionFromCanonicalSource` (global): source read, wearable
  dataset, metric projection, wearable summaries when stale, search documents,
  then one transaction replacing entities, metric points, metric targets,
  search documents and the `query_source_manifest` table, then `VACUUM`.
- `readFreshWearableSummaryRows` (wearable-only, added in schema 28): source
  read, dataset, summaries, then a transaction replacing wearable rows and the
  `wearable_source_manifest` meta key.

Freshness is `readProjectionStatus().fresh`: global tables present, manifest
table equal to the current manifest, and the wearable certificate equal too.
Entity and search readers therefore treat the projection as stale whenever
only the wearable certificate is stale, and the reverse.

## Design

Three sections, each a fixed set of tables plus one certificate in
`query_meta`, all encoded by the existing `encodeSourceManifest`:

| Section | Tables | Certificate key | Readers |
| --- | --- | --- | --- |
| `entities` | `query_entities`, `query_search_document` (+ FTS), `metadata_json`, `built_at` | `entity_source_manifest` | search, `loadProjectedVaultSource`, `listCanonicalEntitiesRuntime`, event list fast path |
| `metrics` | `query_metric_points`, `query_metric_payloads`, `query_metric_targets` | `metric_source_manifest` | metric point and target readers |
| `wearables` | `query_wearable_summaries`, `query_wearable_summary_shapes` | `wearable_source_manifest` (unchanged) | wearable summary readers |

One function replaces both publications:

```ts
publishQueryProjectionSections(vaultRoot, sections, capture, { force? })
```

Under the existing canonical write lock it lists the manifest, keeps the
requested sections whose certificate differs (all of them when `force`),
builds those from one strict source read, commits their tables, rows and
certificates in one immediate transaction, then runs `capture` before the
lock is released. The wearable dataset is computed once and only when
`metrics` or `wearables` is being built. `VACUUM` runs after a publication
that replaced `entities` or `metrics`, as it does today after a global
rebuild.

Entity and metric readers do one unlocked manifest and certificate check for
their own section and call the publisher when it is stale. Wearable readers
keep their two existing policies (see the review outcome below). The explicit
rebuild command publishes all three sections with `force`.

Deleted: the `query_source_manifest` table with its reader and comparer, the
separate wearable-only rebuild body, the `wearableOnly` schema mode, and the
second freshness re-check after a stale rebuild. `QueryProjectionStatus.fresh`
stays in the status output and means all three certificates match.

Unchanged: the lock boundary, wearable readers capturing rows under the lock
on the stale path, the event-list policy of reading the source without
publishing when its section is stale, timing phase names, and every row
format.

## Version and deploy

`QUERY_PROJECTION_SQLITE_VERSION` goes to 38. An older build that opens a
version-38 store sees an unsupported schema and resets it, as it does for any
version it does not know, so it can never serve metric rows that a newer build
left stale. Each vault rebuilds the sections it reads once after the deploy,
which already happens on every schema bump. The projection file size and the
workspace snapshot do not grow: the same rows, one table fewer.

Runner-only change. No Worker, Web or database migration ordering.

## Failure modes considered

- **A command reads two sections across a write.** Each gate certifies against
  the manifest at its own call, as the separate wearable and global gates do
  today. No new skew.
- **Publication fails midway.** One transaction per publication; certificates
  commit with their rows or not at all.
- **Concurrent readers.** Both wait on the canonical write lock and recheck
  certificates under it, so the second one finds the section fresh.
- **A stale section is read by old code after a rollback.** Covered by the
  version reset above.
- **A reader that needs two sections.** It passes both; one source read builds
  both.

## Verification

- Unit: section selection (stale, fresh, forced), certificates committed with
  rows, no dataset work for an `entities`-only publication, one source read
  for a multi-section publication.
- Equivalence on the real vault copy: after publishing all sections, every
  table's row content equals the content produced by the current global
  rebuild plus wearable-only publication (hash per table, ordered).
- CLI output identical before and after for search, timeline, wearables and
  metric commands, with stale and fresh projections.
- Benchmark the table above before and after.
- Production: `query-rebuild` and `query-metric-projection` phases per command
  in `hosted_ai_usage.turn_profile_json`, one day before and after.

## Architecture review outcome (ReviewGPT, 2026-11-10)

Verdict: keep three sections, revise the reader gate. Each finding and what
was done with it:

1. **A matching certificate is not permission to read unlocked** (accepted).
   A canonical writer that queries wearables mid-write publishes them for
   files it may still roll back. Ordinary wearable readers therefore keep
   their existing rule: unlocked only when every section is fresh, otherwise
   lock, publish wearables, capture rows. Section certificates decide what is
   rebuilt, not who may skip the lock. Entity and metric readers keep the
   rule they had (unlocked once their own rows are certified); for them the
   per-section gate is never looser than the old all-or-nothing one.
2. **Search needs daily sample summaries** (accepted). The entities section
   reuses the metric projection's summaries when metrics are built in the
   same publication and otherwise calls `summarizeDailySamples` on the read
   model, so an entities-only publication keeps its `sample_summary`
   documents without the metric pipeline.
3. **Section ownership in the schema guards** (accepted). One fixed
   definition per section (tables, DDL, certificate key) drives table
   creation, freshness and the stored-reader guards. Opening a store creates
   `query_meta` only; a section's tables are created in the transaction that
   first publishes it, so a reader that passed its freshness check before the
   store was replaced fails its table guard. A version-37 reader in flight
   also fails closed because `query_source_manifest` is gone.
4. **Reader dependencies** (accepted). `listMetricPointsByPublicSourceRuntime`
   reads wearable rows, so it needs `wearables`. Sleep pattern uses stored
   metadata only when every section is fresh and otherwise reads `vault.json`
   under the lock with the wearable rows.

Open questions, answered by the review and adopted: keep three sections; the
stale event-list path keeps reading event sources without publishing (a
malformed goal must not fail an event list); delete `query_source_manifest`
in this change with version 38.

Also adopted: validate and derive before any reset (the old global path reset
first); `VACUUM` stays after commit and its failure does not undo a committed
publication. Not adopted: the double freshness re-check after a stale rebuild
is deleted, because the locked publication already re-lists the manifest and
re-checks certificates.

## Measured result (real 87 MB vault copy)

Bundled CLI, previous build against this change, output byte-identical for
every command (22 command runs across a cold store and two orders after a
canonical file change):

| First reads after a vault write | Before | After |
| --- | --- | --- |
| `search query` | 3,467 ms | 708 ms |
| `search query` after `wearables latest` | 2,646 ms | 834 ms |
| `wearables latest` then `search query` | 5,189 ms | 3,394 ms |
| `search query` then `wearables latest` | 4,046 ms | 3,158 ms |
| `wearables latest` alone | 2,543 ms | 2,560 ms |

In-process, a stale metric read is 2.2 to 2.4 s against 3.4 s for the old
full rebuild.

All seven data tables are identical (ordered row hashes) between the store
the previous build produces and the new store after a forced full publish,
after entities then metrics then wearables, and after wearables then entities
then metrics. FTS returns the same hit count. The file is the same size
(31.77 MB) give or take 40 KB by publication order.
Completed: 2026-11-10
