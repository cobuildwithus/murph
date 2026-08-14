import assert from "node:assert/strict";

import { test } from "vitest";

import {
  assembleBrowserVaultReplicaShards,
  BROWSER_VAULT_CORE_SHARD_SCHEMA,
  BROWSER_VAULT_LABS_SHARD_SCHEMA,
  BROWSER_VAULT_METRIC_BUCKET_IDS,
  BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA,
  BROWSER_VAULT_METRICS_SHARD_SCHEMA,
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  BROWSER_VAULT_REPLICA_SHARD_SET_SCHEMA,
  createBrowserVaultLoadedQueryClients,
  getBrowserVaultMetricBucketId,
  parseBrowserVaultCoreShard,
  parseBrowserVaultLabsShard,
  parseBrowserVaultMetricsShard,
  parseBrowserVaultMetricBucketShard,
  parseBrowserVaultReplica,
  parseBrowserVaultReplicaPayload,
  parseBrowserVaultReplicaShards,
  splitBrowserVaultReplica,
  type BrowserVaultReplica,
} from "../src/browser.ts";

test("browser vault replicas split into independently parseable core, metrics index, buckets, and labs shards", async () => {
  const replica = createReplica();
  replica.entities.push({
    attributes: {},
    bodyPreview: "A private note preview.",
    date: "2026-08-12",
    experimentSlug: null,
    family: "journal",
    id: "journal-1",
    kind: "journal_entry",
    links: [],
    lookupIds: ["journal-1"],
    occurredAt: "2026-08-12T09:00:00.000Z",
    recordClass: "bank",
    status: null,
    stream: null,
    tags: ["recovery"],
    title: "Daily note",
  });
  replica.searchRows.push({
    date: "2026-08-12",
    entityId: "journal-1",
    family: "journal",
    id: "journal-1",
    kind: "journal_entry",
    occurredAt: "2026-08-12T09:00:00.000Z",
    tags: ["recovery"],
    text: "Daily note\nA private note preview.\njournal_entry\nrecovery",
    title: "Daily note",
  });
  replica.metricRows.push({
    biomarkerKey: null,
    comparator: null,
    confidence: "high",
    context: {},
    date: "2026-08-12",
    grain: "day",
    id: "metric-row-1",
    metricKey: "steps",
    observedAt: "2026-08-12T09:00:00.000Z",
    pointIds: ["point-1"],
    recordIds: ["record-1"],
    rowSchema: "murph.browser-vault.metric-row.v1",
    sourceFamily: "sample",
    sourceKind: "activity-summary",
    sourceLabel: "Device",
    statistic: "value",
    unit: "count",
    value: 1,
    valueLabel: null,
  });
  const shards = await splitBrowserVaultReplica(replica);

  assert.equal(shards.schema, BROWSER_VAULT_REPLICA_SHARD_SET_SCHEMA);
  assert.equal(shards.core.schema, BROWSER_VAULT_CORE_SHARD_SCHEMA);
  assert.equal(shards.metrics.schema, BROWSER_VAULT_METRICS_SHARD_SCHEMA);
  assert.equal(shards.labs.schema, BROWSER_VAULT_LABS_SHARD_SCHEMA);
  assert.deepEqual(
    Object.keys(shards.metricBuckets).slice().sort(),
    BROWSER_VAULT_METRIC_BUCKET_IDS.slice().sort(),
  );
  assert.equal("metricRows" in shards.core, false);
  assert.equal("labResultRows" in shards.core, false);
  assert.equal("searchRows" in shards.core, false);
  assert.equal("entities" in shards.metrics, false);
  assert.equal("metricRows" in shards.metrics, false);
  assert.equal(shards.metrics.metricRowCount, 1);
  assert.deepEqual(shards.metrics.metricDirectory, [{
    bucketId: await getBrowserVaultMetricBucketId("steps"),
    metricKey: "steps",
    rowCount: 1,
  }]);
  const stepsBucketId = await getBrowserVaultMetricBucketId("steps");
  const physicalRow = shards.metricBuckets[stepsBucketId].series[0]?.rows[0] ?? {};
  assert.equal("rowSchema" in physicalRow, false);
  assert.equal("metricKey" in physicalRow, false);
  assert.equal(shards.metricBuckets[stepsBucketId].schema, BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA);

  const serialized = JSON.parse(JSON.stringify(shards)) as unknown;
  const parsedShards = await parseBrowserVaultReplicaShards(serialized);

  assert.deepEqual(parseBrowserVaultCoreShard(shards.core), parsedShards.core);
  assert.deepEqual(parseBrowserVaultMetricsShard(shards.metrics), parsedShards.metrics);
  assert.deepEqual(parseBrowserVaultLabsShard(shards.labs), parsedShards.labs);
  assert.deepEqual(
    await parseBrowserVaultMetricBucketShard(shards.metricBuckets[stepsBucketId], stepsBucketId),
    parsedShards.metricBuckets[stepsBucketId],
  );
  assert.deepEqual(
    assembleBrowserVaultReplicaShards(parsedShards),
    parseBrowserVaultReplica(replica),
  );
  assert.deepEqual(
    await parseBrowserVaultReplicaPayload(serialized),
    parseBrowserVaultReplica(replica),
  );
});

test("browser vault replica payload parsing preserves legacy monolith compatibility", async () => {
  const { generation: _generation, ...legacyReplica } = createReplica();
  const parsedLegacy = await parseBrowserVaultReplicaPayload(legacyReplica);

  assert.equal(parsedLegacy.generation, undefined);
  assert.deepEqual(parsedLegacy, parseBrowserVaultReplica(legacyReplica));
  assert.deepEqual(
    assembleBrowserVaultReplicaShards(await splitBrowserVaultReplica(parsedLegacy)),
    parsedLegacy,
  );
});

test("browser vault shard assembly rejects mixed replica versions", async () => {
  const shards = await splitBrowserVaultReplica(createReplica());
  shards.metrics.identity = {
    ...shards.metrics.identity,
    dataVersion: "different-version",
  };

  assert.throws(
    () => assembleBrowserVaultReplicaShards(shards),
    /metrics index shard identity must match the core shard identity/u,
  );
});

test("browser vault assembly requires hash-verified buckets and exact partial index coverage", async () => {
  const replica = createReplica();
  replica.metricRows.push({
    biomarkerKey: null, comparator: null, confidence: "high", context: {}, date: "2026-08-12",
    grain: "day", id: "row", metricKey: "steps", observedAt: "2026-08-12T00:00:00.000Z",
    pointIds: [], recordIds: [], rowSchema: "murph.browser-vault.metric-row.v1", sourceFamily: null,
    sourceKind: null, sourceLabel: null, statistic: "value", unit: "count", value: 1, valueLabel: null,
  });
  const shards = await splitBrowserVaultReplica(replica);
  const stepsBucketId = await getBrowserVaultMetricBucketId("steps");
  const unverifiedBucket = { ...shards.metricBuckets[stepsBucketId] };

  assert.throws(
    () => createBrowserVaultLoadedQueryClients({
      core: shards.core,
      metricBuckets: { [stepsBucketId]: unverifiedBucket },
      metrics: shards.metrics,
    }),
    /must come from the bucket parser or replica splitter/u,
  );
  assert.throws(
    () => createBrowserVaultLoadedQueryClients({
      core: shards.core,
      metricBuckets: { [stepsBucketId]: shards.metricBuckets[stepsBucketId] },
      metrics: { ...shards.metrics, metricDirectory: [] },
    }),
    /does not match the metrics index directory/u,
  );
});

test("browser vault loaded clients distinguish unloaded, loaded-empty, and loaded metric series", async () => {
  const replica = createReplica();
  replica.metricRows.push({
    biomarkerKey: null,
    comparator: null,
    confidence: "high",
    context: { preserved: true },
    date: "2026-08-12",
    grain: "day",
    id: "metric-row-1",
    metricKey: "steps",
    observedAt: "2026-08-12T09:00:00.000Z",
    pointIds: ["point-1"],
    recordIds: ["record-1"],
    rowSchema: "murph.browser-vault.metric-row.v1",
    sourceFamily: "sample",
    sourceKind: "activity-summary",
    sourceLabel: "Device",
    statistic: "value",
    unit: "count",
    value: 1,
    valueLabel: null,
  });
  const shards = await splitBrowserVaultReplica(replica);
  const stepsBucketId = await getBrowserVaultMetricBucketId("steps");
  const coreOnly = createBrowserVaultLoadedQueryClients({ core: shards.core });

  assert.equal(coreOnly.core.capability, "core");
  assert.equal(coreOnly.metrics, null);
  assert.equal(coreOnly.labs, null);
  assert.equal(coreOnly.full, null);
  assert.equal(coreOnly.interactiveMetrics, null);
  assert.equal("metricRows" in coreOnly.core.replica, false);

  const withMetrics = createBrowserVaultLoadedQueryClients({
    core: shards.core,
    metrics: shards.metrics,
  });
  assert.equal(withMetrics.metrics, null);
  assert.equal(withMetrics.interactiveMetrics?.metricCoverage.get("steps").status, "unloaded");
  assert.equal(withMetrics.interactiveMetrics?.metricCoverage.get("unknown-metric").status, "loaded-empty");
  assert.throws(
    () => withMetrics.interactiveMetrics?.metrics.series({ metricKey: "steps" }),
    /is not loaded for steps/u,
  );
  assert.equal(withMetrics.labs, null);
  assert.equal(withMetrics.full, null);

  const withSteps = createBrowserVaultLoadedQueryClients({
    core: shards.core,
    metricBuckets: { [stepsBucketId]: shards.metricBuckets[stepsBucketId] },
    metrics: shards.metrics,
  });
  assert.equal(withSteps.interactiveMetrics?.metricCoverage.get("steps").status, "loaded");
  assert.deepEqual(withSteps.interactiveMetrics?.metrics.series({ metricKey: "steps" }), replica.metricRows);
  assert.equal("metricRows" in (withSteps.interactiveMetrics?.replica ?? {}), false);

  const all = createBrowserVaultLoadedQueryClients(shards);
  assert.equal(all.full?.capability, "core+metrics+labs");
});

test("browser vault shard parsers validate schemas, bucket placement, and generation metadata", async () => {
  const replica = createReplica();
  replica.metricRows.push({
    biomarkerKey: null, comparator: null, confidence: "high", context: {}, date: "2026-08-12",
    grain: "day", id: "row", metricKey: "steps", observedAt: "2026-08-12T00:00:00.000Z",
    pointIds: [], recordIds: [], rowSchema: "murph.browser-vault.metric-row.v1", sourceFamily: null,
    sourceKind: null, sourceLabel: null, statistic: "value", unit: "count", value: 1, valueLabel: null,
  });
  const shards = await splitBrowserVaultReplica(replica);

  assert.throws(
    () => parseBrowserVaultCoreShard({ ...shards.core, schema: "wrong" }),
    /core shard\.schema must be murph\.browser-vault-replica\.core\.v1/u,
  );
  assert.throws(
    () => parseBrowserVaultMetricsShard({
      ...shards.metrics,
      identity: { ...shards.metrics.identity, generation: 0 },
    }),
    /metrics shard\.identity\.generation must be a positive safe integer/u,
  );
  const stepsBucketId = await getBrowserVaultMetricBucketId("steps");
  const wrongBucketId = BROWSER_VAULT_METRIC_BUCKET_IDS.find((id) => id !== stepsBucketId)!;
  await assert.rejects(
    () => parseBrowserVaultMetricBucketShard(
      { ...shards.metricBuckets[stepsBucketId], bucketId: wrongBucketId },
      wrongBucketId,
    ),
    /contains a metric key assigned to bucket/u,
  );
});

test("browser vault metric bucket assignment has stable SHA-256 test vectors", async () => {
  // Changing any vector requires a generation bump so old refs are never read
  // with a new canonical-key placement rule.
  assert.equal(BROWSER_VAULT_REPLICA_CURRENT_GENERATION, 10);
  assert.equal(await getBrowserVaultMetricBucketId("spo2"), "02");
  assert.equal(await getBrowserVaultMetricBucketId("lowest-spo2"), "19");
  assert.equal(await getBrowserVaultMetricBucketId("estimated-vo2-max"), "0d");
  assert.equal(await getBrowserVaultMetricBucketId("resting-heart-rate"), "14");
});

function createReplica(): BrowserVaultReplica {
  return {
    assistantSummary: {
      highlights: ["A compact core summary."],
      latestDate: "2026-08-12",
    },
    entities: [],
    experimentOutcomes: [],
    experimentRunCards: [],
    generatedAt: "2026-08-13T12:00:00.000Z",
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
    hasLabBiomarkers: false,
    labResultRows: [],
    metricGoalProgressRows: [],
    metricRows: [],
    metricSelectionRows: [],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: ["audit"],
      id: BROWSER_VAULT_REPLICA_POLICY_ID,
      includedFamilies: ["journal"],
      metricLookbackDays: 365,
    },
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: [],
    source: {
      dataVersion: "data-version",
      sourceBundleHash: "source-bundle-hash",
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
}
