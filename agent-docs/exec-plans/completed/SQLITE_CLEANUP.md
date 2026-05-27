Yes: **raw provider timeseries should not be full-text searchable by default**. The database size is not primarily a SQLite tuning problem; it is a product/modeling boundary problem that SQLite is faithfully amplifying.

Your local breakdown already proves the main issue: the live DB is not mostly free pages; `query.sqlite` is live storage dominated by duplicated observation entities, duplicated search text, FTS content copy, and FTS token index. 

## The core bug chain

### 1. The code says dense telemetry should not hydrate into default query/read paths, but Garmin observations currently do

`packages/query/README.md` explicitly says the query package owns the local projection and that dense provider telemetry should stay in raw evidence or explicit sample-debug ledgers, while default `readVault()` should hydrate sparse/display-grade facts. 

But Junction timeseries normalization turns each allowed timeseries entry into a **device event** with `kind: "observation"` and metric fields. The relevant path is `normalizeTimeseries()`, which pushes `context.events.push({ kind: "observation", ... fields: { metric, unit, value } })`. 

That is the first big slip: dense Garmin telemetry is not landing in a raw-only path. It is entering the canonical event ledger.

### 2. The existing dense-row guard misses the actual dense path

Core has a dense sample policy, but it only checks `samples.length`. `importDeviceBatch()` calls `assertDenseDeviceSamplePolicy({ sampleCount: Array.isArray(samples) ? samples.length : 0 })`; it does **not** count dense `events`. 

Then the guard itself only rejects when `sampleCount` exceeds the threshold and no debug override is present. 

So Junction can emit 75k `kind: "observation"` rows as **events**, and the “dense provider imports must keep dense timeseries as raw evidence” guard never fires. That is likely the most important concrete bug.

### 3. Query treats all event ledger rows as default query source

The vault family descriptors mark `ledger/events` as a `jsonl-root` query source. By contrast, `ledger/samples` is explicitly `querySource: "none"` and described as import/debug inspection. 

Then `readBaseEntities()` reads event ledger shards into the query source, and `readJsonlRecordFamily()` turns each event record into a full `CanonicalEntity`.  

So once dense Garmin rows become `ledger/events` observations, they are automatically in the hot path for `readVault()`, search, projection rebuilds, and derived metrics.

### 4. The query projection duplicates each row several times

The rebuild path takes `snapshot.entities`, filters only some sample rows, and materializes search documents from the projected entities. It then deletes/reinserts every projection table on rebuild. 

For each projected entity, `query_entities` stores `JSON.stringify(entity)` in `entity_json`. 

For each search document, it stores text fields in `query_search_document`, then inserts the same text into `query_search_fts`. 

The schema confirms the duplication: `query_entities.entity_json` is required, `query_search_document` stores `title_text`, `body_text`, `tags_text`, and `structured_text`, and the FTS virtual table stores its own content by default.  

The worst part is `structured_text`: `buildSearchDocument()` includes `entity.path`, lookup IDs, relations, and `safeJsonStringify(entity.attributes)`. That means every raw Garmin observation’s attributes get copied into searchable text. 

So your math is right: this is not normal SQLite overhead. It is the same dense Garmin rows copied into at least three logical representations, plus FTS indexing overhead.

## The most important fix

Do **not** FTS-index raw provider observations. More strongly: do not put dense provider observations in default `query_entities` either, once wearable read APIs have a compact replacement source.

I would split this into two implementation phases so you can reduce DB size immediately without breaking wearable surfaces.

## Phase 1: stop search indexing dense provider observations immediately

This is the lowest-risk change. Keep `query_entities` as-is for the moment so existing wearable APIs that call `readVault()` still work, but prevent dense provider observations from entering `query_search_document` and `query_search_fts`.

Add a separate predicate, not just `isProjectedQueryEntity()`:

```ts
function isDenseProviderObservationEntity(entity: CanonicalEntity): boolean {
  if (entity.family !== "event" || entity.kind !== "observation") {
    return false;
  }

  const attributes = entity.attributes as Record<string, unknown>;

  return (
    attributes.source === "device" &&
    typeof attributes.metric === "string" &&
    typeof attributes.value === "number" &&
    (
      attributes.externalRef !== undefined ||
      attributes.dataOrigin !== undefined
    )
  );
}

function isSearchIndexedQueryEntity(entity: CanonicalEntity): boolean {
  return !isDenseProviderObservationEntity(entity);
}
```

Then in `rebuildQueryProjectionWithManifest()` change:

```ts
const searchDocuments = [
  ...materializeSearchDocuments(projectedEntities),
  ...materializeSummaryDocuments(dailySampleSummaries),
];
```

to:

```ts
const searchableEntities = projectedEntities.filter(isSearchIndexedQueryEntity);

const searchDocuments = [
  ...materializeSearchDocuments(searchableEntities),
  ...materializeSummaryDocuments(dailySampleSummaries),
];
```

This alone should remove most of:

`query_search_document` + `query_search_fts_content` + much of `query_search_fts_data`.

It will not remove the `entity_json` bloat yet, but it should cut the DB by a large fraction and remove the product-wrong behavior where search returns raw provider points.

## Phase 2: move wearable surfaces off raw `readVault()` entities, then remove dense observations from `query_entities`

Right now, wearable query services call `query.readVault()` and then summarize from that read model. For example, `showWearableDay`, `showWearableLatest`, `showWearableMetricLatest`, and trend/drift/list wearable services all load `readVault()` first. 

That means if you immediately exclude raw observations from `query_entities`, these wearable APIs may lose their evidence unless you give them a compact projected replacement.

The right replacement is a compact wearable projection table, for example:

```sql
CREATE TABLE query_wearable_daily_summary (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  provider TEXT,
  summary_kind TEXT NOT NULL, -- sleep | activity | recovery | body_state | source_health
  summary_json TEXT NOT NULL
);

CREATE INDEX query_wearable_daily_summary_date_idx
  ON query_wearable_daily_summary(date DESC);

CREATE INDEX query_wearable_daily_summary_kind_date_idx
  ON query_wearable_daily_summary(summary_kind, date DESC);
```

During rebuild, keep using the full source snapshot internally to compute summaries and metric points, but persist only compact summaries/metric points. Then switch wearable public services to runtime projection readers instead of `readVault()` over raw observation entities.

After that, change `isProjectedQueryEntity()` itself:

```ts
function isProjectedQueryEntity(entity: CanonicalEntity): boolean {
  if (isDenseProviderObservationEntity(entity)) {
    return false;
  }

  if (entity.family !== "sample") {
    return true;
  }

  return entity.kind === "metric_sample" && isDisplayGradeMetricSampleEntity(entity);
}
```

That is the change that removes the ~98 MiB `entity_json` problem and stops default `readVault()` from hydrating dense Garmin points.

## Phase 3: fix the ingestion boundary so this does not recur

The better fix is upstream: Junction timeseries should not be normalized into `events` by default.

Right now the importer builds `canonicalWearableRecords`, and the public importer payload type even includes `canonicalWearableRecords`.  

But the core `ImportDeviceBatchInput` in `packages/core/src/mutations.ts` does not include `canonicalWearableRecords`; `importDeviceBatch()` destructures only `events`, `samples`, `rawArtifacts`, `denseSamplePolicy`, and `provenance`.  

That means the intended canonical wearable path is partially built but not wired into core storage. The system therefore falls back to event-ledger observations.

I would make one of these true:

```ts
// Option A: default
normalizeTimeseries(...) stores raw artifact + canonicalWearableRecords only.
// No dense observation events unless explicitly requested for debug.

// Option B: debug-only
if (input.denseSamplePolicy?.allowDenseDebugSamples === true) {
  emit dense observations/samples into explicit debug ledgers.
}
```

Also rename or generalize the guard:

```ts
assertDenseDeviceTelemetryPolicy({
  sampleCount: samples.length,
  observationEventCount: events.filter(isDenseDeviceObservationInput).length,
  policy: denseSamplePolicy,
});
```

Current `assertDenseDeviceSamplePolicy()` gives a false sense of safety because the worst path is not `samples`; it is `events`.

## SQLite-specific improvements after the modeling fix

These help, but they are secondary.

### Use external-content FTS

SQLite FTS5 normally stores a private copy of row content in addition to the token index; SQLite’s docs explicitly say the `content` option can make FTS store only full-text index entries and save significant space. ([SQLite][1])

Your schema should likely become:

```sql
CREATE VIRTUAL TABLE query_search_fts USING fts5(
  title_text,
  body_text,
  tags_text,
  structured_text,
  content='query_search_document',
  content_rowid='rowid',
  tokenize = 'unicode61 remove_diacritics 2 tokenchars ''-_'''
);
```

Then join by rowid:

```sql
FROM query_search_fts
JOIN query_search_document
  ON query_search_document.rowid = query_search_fts.rowid
```

External-content FTS requires keeping the FTS index consistent with the content table; SQLite documents this explicitly. For your full-rebuild projection, that is manageable because you can repopulate both in one transaction, without needing triggers. ([SQLite][1])

### Stop putting raw `JSON.stringify(entity.attributes)` into `structured_text`

`structured_text` should be an allowlisted, product-facing search surface, not a dump of every attribute object.

Use per-kind searchable fields:

```ts
function searchableStructuredText(entity: CanonicalEntity): string {
  if (isDenseProviderObservationEntity(entity)) {
    return "";
  }

  switch (entity.kind) {
    case "document":
      return compactStrings([
        entity.entityId,
        entity.primaryLookupId,
        entity.title,
        pickString(entity.attributes, "provider"),
        pickString(entity.attributes, "mimeType"),
      ]).join("\n");

    case "meal":
      return compactStrings([
        entity.entityId,
        entity.primaryLookupId,
        entity.title,
        entity.body,
      ]).join("\n");

    default:
      return compactStrings([
        entity.entityId,
        entity.primaryLookupId,
        ...entity.lookupIds,
        ...entity.relatedIds,
      ]).join("\n");
  }
}
```

This preserves useful structured-only search for sparse records, while preventing raw provider JSON from becoming the biggest text corpus in the DB.

### Do not expect `VACUUM` to fix the current DB by itself

Your snapshot says the freelist is only about 1.21 MiB, so the bloat is live allocated content, not mostly deleted pages. 

After code changes, the clean operational path is:

```bash
rm vault/.runtime/projections/query.sqlite \
   vault/.runtime/projections/query.sqlite-wal \
   vault/.runtime/projections/query.sqlite-shm

murph query projection rebuild --vault <vault>
```

`VACUUM` is only useful after deleting rows from an existing DB. A rebuild from the corrected projection is simpler and safer.

## Other efficiency issues I’d fix while here

`readJsonlFile()` reads an entire JSONL file into memory and splits it. With 40 MiB shards that is tolerable, but for device data it will get worse. Use a streaming line reader for JSONL. 

Projection freshness compares source manifests and rebuilds the entire projection when stale; if any source file changes, `ensureFreshQueryProjection()` calls the full rebuild.  The rebuild then deletes and reinserts all rows.  Once raw telemetry is out of the hot path, this may be fine, but if source size grows again you will want shard-level incremental projection.

Search currently pulls full text fields for up to the candidate limit and then does custom scoring/snippet generation in TypeScript.  That is okay for sparse docs, but another reason raw observations should never be candidates.

## What I would prioritize

1. **Immediate:** add `isSearchIndexedQueryEntity()` and exclude dense provider observations from search docs/FTS.
2. **Next:** add compact wearable projection tables and move wearable services off raw `readVault()` observation entities.
3. **Then:** exclude dense provider observations from `query_entities` / default `readVault()`.
4. **Upstream:** stop emitting Junction timeseries as default `ledger/events` observations; wire `canonicalWearableRecords` into core storage or keep them as raw evidence + derived compact summaries.
5. **SQLite cleanup:** switch FTS to external content and replace global `JSON.stringify(attributes)` with searchable field allowlists.

The biggest slipped issue is not “SQLite is inefficient.” It is: **dense Junction/Garmin timeseries are being represented as canonical event observations, and the query projection treats canonical events as searchable/default-hydrated entities.**

[1]: https://www.sqlite.org/fts5.html "SQLite FTS5 Extension"
