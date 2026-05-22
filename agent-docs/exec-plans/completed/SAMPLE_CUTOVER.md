Yes: based on main, I would hard-cut `query_sample_points`.

It is not a true product-serving table. In current main it exists for one thing: `readVault()` rehydrates projected samples back into `CanonicalEntity`s. Search uses sample **summary documents**, metric pages use **metric rows**, and browser-vault uses **metric rows / metric selection rows / source-health rows**. None of those need row-level sample points.

## Final read

`query_sample_points` is compatibility baggage.

Main branch shows:

* `readVault()` calls `loadProjectedVaultSource()` and wraps returned entities into `createVaultReadModel()`. 
* `loadProjectedVaultSource()` eventually calls `readStoredVaultSource()`, which reads both `query_entities` and **all** `query_sample_points`, then maps sample rows back into canonical sample entities. 
* `query_sample_points` is created, indexed, required by `hasQueryProjectionTables()`, and converted back through `samplePointRowToEntity()`. 
* Search already materializes **sample summary** documents from `DailySampleSummary`; it does not need sample point rows. 
* The biomarker/browser path already wants compact `metricRows` and `metricSelectionRows`, not raw sample entities. Browser-vault builds those rows from metric points. 

So the clean hard-cut is: **delete `query_sample_points`, delete sample entity rehydration, and stop making `readVault()` include dense sample telemetry.**

## Important distinction

There are two separate problems:

1. **`query_sample_points` readback is unnecessary.**
   We can delete this outright.

2. **Projection rebuild still materializes samples before inserting summaries/metrics.**
   Main currently reads `metricSamples` and `samples` from JSONL in `readBaseEntities()`.  If we only delete `query_sample_points`, rebuild may still be expensive. So for a real hard cut, we also need to stop generic sample ledgers from being part of the normal query source.

The durable rule should be:

> Generic dense samples are not part of the default query/read model.

## What I would hard-cut

### Delete `query_sample_points`

Remove all of this from `packages/query/src/query-projection.ts`:

* `QueryProjectionSamplePointRow`
* `decodeQueryProjectionSamplePointRow`
* `sampleEntities`
* `insertSamplePoint`
* `DELETE FROM query_sample_points`
* `CREATE TABLE query_sample_points`
* all sample point indexes
* `tableExists(database, "query_sample_points")`
* the sample-row `SELECT`
* `samplePointRowToEntity`

Then bump the SQLite projection version so old projections are discarded and rebuilt cleanly.

The resulting `readStoredVaultSource()` should only read `query_entities`.

### Stop `readVault()` from returning samples

`readVault()` should become sparse by construction:

```ts
readVault(vaultRoot) -> sparse canonical entities only
```

No `readVaultWithSamples()` unless there is a concrete product need. Since we are optimizing for hard-cut simplicity, I would avoid adding that escape hatch now. It preserves the old mistake.

### Remove generic samples from normal query source

In `vault-source.ts`, stop reading `VAULT_LAYOUT.sampleLedgerDirectory` in `readBaseEntities()`.

I would keep `metric-samples` only if they are display-grade product truth, because they are closer to “explicit scalar measurements” than provider firehose samples. But generic `ledger/samples` should not be a default query source.

Concretely:

```ts
const metricSamples = await readMetricSampleEntities(vaultRoot)
// remove:
// const samples = await readSampleEntities(vaultRoot)

return [
  ...
  ...metricSamples,
  // remove ...samples
]
```

Then delete `readSampleEntities()` if no remaining caller needs it.

### Keep `query_metric_points`

This is the table we actually want. It supports biomarker pages, browser-vault metric rows, metric selection, goal progress, and assistant-safe metric lookups. Main already has indexed metric point storage and filtered reads by metric, biomarker, date, and limit. 

The website should use this shape, not sample points.

### Stop browser-vault from rebuilding metrics from hydrated samples

Current browser-vault build calls `buildMetricProjection(input.vault).metricPoints` after receiving a `VaultReadModel`.  The hosted refresh path currently builds browser-vault by calling `readVault()` first. 

After the hard cut, browser-vault should not require sample hydration. Minimal clean change:

```ts
const vault = await readVault(vaultRoot) // sparse
const metricPoints = await listMetricPoints(vaultRoot, { limit: null })

return createBrowserVaultReplica({
  generatedAt,
  sourceBundleHash,
  vault,
  metricPoints,
})
```

Then `createBrowserVaultReplica()` should use `input.metricPoints` instead of calling `buildMetricProjection(input.vault)`.

That keeps one simple projection and avoids inventing separate projection families.

## What I would not do

I would **not** add skips like:

```ts
if provider === "garmin" skip sample rows
if provider === "whoop" skip sample rows
```

That is brittle.

I would also **not** add a complicated projection-scope system yet. Earlier I suggested sparse/telemetry/browser scopes, but after rechecking main, the cleaner hard cut is simpler:

```txt
one query projection
no sample point table
no dense sample entities in readVault
browser-vault consumes metric points
assistant consumes sparse vault / future narrow APIs
```

That is less architecture, not more.

## Provider ingestion cleanup

There is still a provider-layer issue. Garmin epoch summaries emit sample rows for heart rate, steps, respiratory rate, temperature, and HRV.  Those are the kind of dense firehose rows we should not normalize into canonical samples for normal product usage.

For a hard cut, I would change provider normalizers so:

* daily summaries become observation/metric facts;
* sleep/recovery/session-level summaries become observation/metric facts;
* high-frequency epoch data stays raw evidence unless a specific product surface needs it;
* generic `samples` are reserved for explicit user/imported sample batches, not wearable firehose telemetry.

The current shared normalizer has separate `pushObservationEvent()` and `pushSample()` paths.  For provider telemetry, prefer observation/metric facts over sample rows unless we truly need per-point raw time-series display.

## Assistant path after hard cut

Assistant setup still calls `readVault()` in places it does not need to. Active experiment context calls `readVault()` just to inspect experiment frontmatter.  Vault overview calls `readVault()` for counts and wearable source coverage. 

But if `readVault()` becomes sparse, this is no longer catastrophic. I would still clean it up later into narrow projection reads, but it does not need to block the hard cut.

## Final hard-cut plan

Do this in one PR:

1. **Remove `query_sample_points` from projection schema and code.**
2. **Bump query projection SQLite version.**
3. **Make `readStoredVaultSource()` return only `query_entities`.**
4. **Stop reading `ledger/samples` in `readVaultSourceStrict()` / `readVaultSourceTolerant()`.**
5. **Remove sample summary search docs if generic samples are gone, or replace them with compact daily summary rows if we still need them.**
6. **Change browser-vault build to accept metric points from projection instead of recomputing from hydrated vault samples.**
7. **Reroute or delete sample CLI commands that currently depend on `readVault().samples`.** The current sample helpers call `readVault()` for show/list/summarize.  For hard-cut simplicity, either remove these commands or make them explicit raw sample-ledger readers.
8. **Update provider normalizers to stop emitting wearable firehose samples.** Keep raw evidence and compact metric facts.

## Bottom line

We do **not** need `query_sample_points`.

The simplest long-term architecture is:

```txt
readVault()
  sparse canonical product records

query_metric_points
  compact metric facts for biomarker pages, goals, browser-vault, assistant lookups

browser-vault
  compact encrypted frontend rows built from query projection

raw provider artifacts
  immutable evidence for deep inspection

generic samples
  not part of default query/read/browser/assistant paths
```

This is the hard cut I would make. It removes a misleading abstraction instead of adding more filters around it.
