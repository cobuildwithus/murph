import {
  BROWSER_VAULT_REPLICA_SCHEMA,
  type BrowserVaultCoreReplica,
  type BrowserVaultLabsReplica,
  type BrowserVaultMetricsIndexReplica,
  type BrowserVaultMetricsReplica,
  type BrowserVaultMetricRow,
  type BrowserVaultReplica,
} from "./shared.ts";
import {
  BROWSER_VAULT_METRIC_BUCKET_IDS,
  canonicalizeBrowserVaultMetricKey,
  getBrowserVaultMetricBucketId,
  type BrowserVaultMetricBucketId,
} from "./metric-buckets.ts";
import { BROWSER_VAULT_METRIC_ROW_SCHEMA } from "./metric-points.ts";
import { projectBrowserVaultSearchRow } from "./search-row.ts";

export const BROWSER_VAULT_REPLICA_SHARD_SET_SCHEMA = "murph.browser-vault-replica.shards.v2";
export const BROWSER_VAULT_CORE_SHARD_SCHEMA = "murph.browser-vault-replica.core.v1";
export const BROWSER_VAULT_METRICS_SHARD_SCHEMA = "murph.browser-vault-replica.metrics-index.v1";
export const BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA = "murph.browser-vault-replica.metric-bucket.v1";
export const BROWSER_VAULT_LABS_SHARD_SCHEMA = "murph.browser-vault-replica.labs.v1";

export type BrowserVaultReplicaShardKind = "core" | "metrics" | "labs";

export interface BrowserVaultReplicaShardIdentity {
  dataVersion: string;
  generatedAt: string;
  /** Absent only when a legacy monolith is split for compatibility. */
  generation?: number;
  replicaSchema: typeof BROWSER_VAULT_REPLICA_SCHEMA;
  sourceBundleHash: string;
}

export interface BrowserVaultCoreShard extends Pick<
  BrowserVaultReplica,
  | "assistantSummary"
  | "entities"
  | "personalPatterns"
  | "policy"
  | "timelineRows"
  | "weeklySampleSummaries"
> {
  experimentRunCards: NonNullable<BrowserVaultReplica["experimentRunCards"]>;
  hasLabBiomarkers: NonNullable<BrowserVaultReplica["hasLabBiomarkers"]>;
  identity: BrowserVaultReplicaShardIdentity;
  schema: typeof BROWSER_VAULT_CORE_SHARD_SCHEMA;
}

export interface BrowserVaultMetricDirectoryEntry {
  bucketId: BrowserVaultMetricBucketId;
  metricKey: string;
  rowCount: number;
}

export type BrowserVaultMetricBucketRow = Omit<BrowserVaultMetricRow, "metricKey" | "rowSchema">;

export interface BrowserVaultMetricBucketSeries {
  metricKey: string;
  rows: BrowserVaultMetricBucketRow[];
}

export interface BrowserVaultMetricBucketShard {
  bucketId: BrowserVaultMetricBucketId;
  identity: BrowserVaultReplicaShardIdentity;
  schema: typeof BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA;
  series: BrowserVaultMetricBucketSeries[];
}

export type BrowserVaultMetricBucketShards = Record<
  BrowserVaultMetricBucketId,
  BrowserVaultMetricBucketShard
>;

export interface BrowserVaultMetricsShard extends Pick<
  BrowserVaultReplica,
  | "metricGoalProgressRows"
  | "metricSelectionRows"
  | "sourceHealthRows"
> {
  experimentOutcomes: NonNullable<BrowserVaultReplica["experimentOutcomes"]>;
  identity: BrowserVaultReplicaShardIdentity;
  metricDirectory: BrowserVaultMetricDirectoryEntry[];
  metricRowCount: number;
  schema: typeof BROWSER_VAULT_METRICS_SHARD_SCHEMA;
}

export type BrowserVaultMetricsIndexShard = BrowserVaultMetricsShard;

export interface BrowserVaultLabsShard extends Pick<BrowserVaultReplica, "labResultRows"> {
  identity: BrowserVaultReplicaShardIdentity;
  schema: typeof BROWSER_VAULT_LABS_SHARD_SCHEMA;
}

export interface BrowserVaultReplicaShardSet {
  core: BrowserVaultCoreShard;
  labs: BrowserVaultLabsShard;
  metricBuckets: BrowserVaultMetricBucketShards;
  metrics: BrowserVaultMetricsShard;
  schema: typeof BROWSER_VAULT_REPLICA_SHARD_SET_SCHEMA;
}

export interface BrowserVaultReplicaShardSelection {
  core: BrowserVaultCoreShard;
  labs?: BrowserVaultLabsShard;
  metricBuckets?: Partial<Record<BrowserVaultMetricBucketId, BrowserVaultMetricBucketShard>>;
  metrics?: BrowserVaultMetricsShard;
}

export type BrowserVaultReplicaPayload = BrowserVaultReplica | BrowserVaultReplicaShardSet;

const verifiedMetricBuckets = new WeakSet<BrowserVaultMetricBucketShard>();

export async function splitBrowserVaultReplica(
  replica: BrowserVaultReplica,
): Promise<BrowserVaultReplicaShardSet> {
  const identity = createShardIdentity(replica);
  const grouped = new Map<string, BrowserVaultMetricRow[]>();
  for (const row of replica.metricRows) {
    const rows = grouped.get(row.metricKey);
    if (rows) rows.push(row);
    else grouped.set(row.metricKey, [row]);
  }

  const bucketIds = await Promise.all(
    [...grouped.keys()].map((metricKey) => getBrowserVaultMetricBucketId(metricKey)),
  );
  const emptyBuckets: Partial<Record<BrowserVaultMetricBucketId, BrowserVaultMetricBucketShard>> = {};
  for (const bucketId of BROWSER_VAULT_METRIC_BUCKET_IDS) {
    const bucket: BrowserVaultMetricBucketShard = {
      bucketId,
      identity,
      schema: BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA,
      series: [],
    };
    emptyBuckets[bucketId] = bucket;
    verifiedMetricBuckets.add(bucket);
  }
  if (!hasAllBrowserVaultMetricBuckets(emptyBuckets)) {
    throw new TypeError("Browser vault metric bucket builder did not create every fixed bucket.");
  }
  const metricDirectory: BrowserVaultMetricDirectoryEntry[] = [];

  [...grouped.entries()].forEach(([metricKey, rows], index) => {
    const bucketId = bucketIds[index]!;
    metricDirectory.push({ bucketId, metricKey, rowCount: rows.length });
    emptyBuckets[bucketId].series.push({
      metricKey,
      rows: rows.map(toMetricBucketRow),
    });
  });
  for (const bucket of Object.values(emptyBuckets)) {
    bucket.series.sort((left, right) => left.metricKey.localeCompare(right.metricKey));
  }
  metricDirectory.sort((left, right) => left.metricKey.localeCompare(right.metricKey));

  return {
    core: {
      assistantSummary: replica.assistantSummary,
      entities: replica.entities,
      experimentRunCards: replica.experimentRunCards ?? [],
      hasLabBiomarkers: replica.hasLabBiomarkers ?? false,
      identity,
      ...(replica.personalPatterns === undefined ? {} : { personalPatterns: replica.personalPatterns }),
      policy: replica.policy,
      schema: BROWSER_VAULT_CORE_SHARD_SCHEMA,
      timelineRows: replica.timelineRows,
      weeklySampleSummaries: replica.weeklySampleSummaries,
    },
    labs: { identity, labResultRows: replica.labResultRows, schema: BROWSER_VAULT_LABS_SHARD_SCHEMA },
    metricBuckets: emptyBuckets,
    metrics: {
      experimentOutcomes: replica.experimentOutcomes ?? [],
      identity,
      metricDirectory,
      metricGoalProgressRows: replica.metricGoalProgressRows,
      metricRowCount: replica.metricRows.length,
      metricSelectionRows: replica.metricSelectionRows,
      schema: BROWSER_VAULT_METRICS_SHARD_SCHEMA,
      sourceHealthRows: replica.sourceHealthRows,
    },
    schema: BROWSER_VAULT_REPLICA_SHARD_SET_SCHEMA,
  };
}

export function assembleBrowserVaultReplicaShards(shards: BrowserVaultReplicaShardSet): BrowserVaultReplica {
  requireSchema(shards.schema, BROWSER_VAULT_REPLICA_SHARD_SET_SCHEMA, "Browser vault replica shard set.schema");
  const metricsReplica = assembleBrowserVaultMetricsReplica(shards.core, shards.metrics, shards.metricBuckets);
  requireSchema(shards.labs.schema, BROWSER_VAULT_LABS_SHARD_SCHEMA, "Browser vault labs shard.schema");
  requireMatchingIdentity(shards.core.identity, shards.labs.identity, "labs");
  return { ...metricsReplica, labResultRows: shards.labs.labResultRows };
}

export function assembleBrowserVaultCoreReplica(core: BrowserVaultCoreShard): BrowserVaultCoreReplica {
  requireSchema(core.schema, BROWSER_VAULT_CORE_SHARD_SCHEMA, "Browser vault core shard.schema");
  requireReplicaIdentity(core.identity, "Browser vault core shard.identity");
  const identity = core.identity;
  return {
    assistantSummary: core.assistantSummary,
    entities: core.entities,
    experimentRunCards: core.experimentRunCards,
    generatedAt: identity.generatedAt,
    ...(identity.generation === undefined ? {} : { generation: identity.generation }),
    hasLabBiomarkers: core.hasLabBiomarkers,
    ...(core.personalPatterns === undefined ? {} : { personalPatterns: core.personalPatterns }),
    policy: core.policy,
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: core.entities.map(projectBrowserVaultSearchRow),
    source: { dataVersion: identity.dataVersion, sourceBundleHash: identity.sourceBundleHash },
    timelineRows: core.timelineRows,
    weeklySampleSummaries: core.weeklySampleSummaries,
  };
}

export function assembleBrowserVaultMetricsIndexReplica(
  core: BrowserVaultCoreShard,
  metrics: BrowserVaultMetricsShard,
): BrowserVaultMetricsIndexReplica {
  requireSchema(metrics.schema, BROWSER_VAULT_METRICS_SHARD_SCHEMA, "Browser vault metrics index shard.schema");
  requireMatchingIdentity(core.identity, metrics.identity, "metrics index");
  return {
    ...assembleBrowserVaultCoreReplica(core),
    experimentOutcomes: metrics.experimentOutcomes,
    metricGoalProgressRows: metrics.metricGoalProgressRows,
    metricSelectionRows: metrics.metricSelectionRows,
    sourceHealthRows: metrics.sourceHealthRows,
  };
}

export function assembleBrowserVaultMetricsReplica(
  core: BrowserVaultCoreShard,
  metrics: BrowserVaultMetricsShard,
  metricBuckets: BrowserVaultMetricBucketShards,
): BrowserVaultMetricsReplica {
  const indexReplica = assembleBrowserVaultMetricsIndexReplica(core, metrics);
  const rowsByMetricKey = new Map<string, BrowserVaultMetricRow[]>();
  for (const bucketId of BROWSER_VAULT_METRIC_BUCKET_IDS) {
    const bucket = metricBuckets[bucketId];
    if (!bucket) throw new TypeError(`Browser vault metric bucket ${bucketId} is required for full assembly.`);
    requireMetricBucket(bucket, bucketId, core.identity);
    for (const entry of bucket.series) {
      if (rowsByMetricKey.has(entry.metricKey)) {
        throw new TypeError(`Browser vault metric key ${entry.metricKey} appears in more than one bucket series.`);
      }
      rowsByMetricKey.set(entry.metricKey, entry.rows.map((row) => fromMetricBucketRow(entry.metricKey, row)));
    }
  }
  const metricRows = metrics.metricDirectory.flatMap((entry) => {
    const rows = rowsByMetricKey.get(entry.metricKey) ?? [];
    if (rows.length !== entry.rowCount) {
      throw new TypeError(`Browser vault metric directory row count does not match ${entry.metricKey}.`);
    }
    const bucket = metricBuckets[entry.bucketId];
    if (!bucket.series.some((series) => series.metricKey === entry.metricKey)) {
      throw new TypeError(`Browser vault metric directory bucket does not match ${entry.metricKey}.`);
    }
    rowsByMetricKey.delete(entry.metricKey);
    return rows;
  });
  if (rowsByMetricKey.size > 0 || metricRows.length !== metrics.metricRowCount) {
    throw new TypeError("Browser vault metric buckets do not match the metrics index directory.");
  }
  return { ...indexReplica, metricRows };
}

export function assembleBrowserVaultLoadedMetricRows(
  metrics: BrowserVaultMetricsShard,
  metricBuckets: Partial<Record<BrowserVaultMetricBucketId, BrowserVaultMetricBucketShard>>,
): BrowserVaultMetricRow[] {
  const rows: BrowserVaultMetricRow[] = [];
  for (const bucketId of BROWSER_VAULT_METRIC_BUCKET_IDS) {
    const bucket = metricBuckets[bucketId];
    if (!bucket) continue;
    requireMetricBucket(bucket, bucketId, metrics.identity);
    const expectedEntries = metrics.metricDirectory.filter((entry) => entry.bucketId === bucketId);
    const seriesByMetricKey = new Map(bucket.series.map((series) => [series.metricKey, series]));
    if (seriesByMetricKey.size !== bucket.series.length) {
      throw new TypeError(`Browser vault metric bucket ${bucketId} contains duplicate metric series.`);
    }
    if (seriesByMetricKey.size !== expectedEntries.length) {
      throw new TypeError(`Browser vault metric bucket ${bucketId} does not match the metrics index directory.`);
    }
    for (const entry of expectedEntries) {
      const series = seriesByMetricKey.get(entry.metricKey);
      if (!series || series.rows.length !== entry.rowCount) {
        throw new TypeError(`Browser vault metric bucket ${bucketId} row count does not match ${entry.metricKey}.`);
      }
    }
    for (const series of bucket.series) {
      rows.push(...series.rows.map((row) => fromMetricBucketRow(series.metricKey, row)));
    }
  }
  return rows;
}

/** @internal Parser-owned proof that SHA-256 placement was checked. */
export function markBrowserVaultMetricBucketShardVerified(
  bucket: BrowserVaultMetricBucketShard,
): BrowserVaultMetricBucketShard {
  verifiedMetricBuckets.add(bucket);
  return bucket;
}

export function assembleBrowserVaultLabsReplica(core: BrowserVaultCoreShard, labs: BrowserVaultLabsShard): BrowserVaultLabsReplica {
  requireSchema(labs.schema, BROWSER_VAULT_LABS_SHARD_SCHEMA, "Browser vault labs shard.schema");
  requireMatchingIdentity(core.identity, labs.identity, "labs");
  return { ...assembleBrowserVaultCoreReplica(core), labResultRows: labs.labResultRows };
}

export function hasAllBrowserVaultMetricBuckets(
  buckets: Partial<Record<BrowserVaultMetricBucketId, BrowserVaultMetricBucketShard>> | undefined,
): buckets is BrowserVaultMetricBucketShards {
  return buckets !== undefined && BROWSER_VAULT_METRIC_BUCKET_IDS.every((bucketId) => buckets[bucketId] !== undefined);
}

function createShardIdentity(replica: BrowserVaultReplica): BrowserVaultReplicaShardIdentity {
  return {
    dataVersion: replica.source.dataVersion,
    generatedAt: replica.generatedAt,
    ...(replica.generation === undefined ? {} : { generation: replica.generation }),
    replicaSchema: BROWSER_VAULT_REPLICA_SCHEMA,
    sourceBundleHash: replica.source.sourceBundleHash,
  };
}

function toMetricBucketRow(row: BrowserVaultMetricRow): BrowserVaultMetricBucketRow {
  const { metricKey: _metricKey, rowSchema: _rowSchema, ...bucketRow } = row;
  return bucketRow;
}

function fromMetricBucketRow(metricKey: string, row: BrowserVaultMetricBucketRow): BrowserVaultMetricRow {
  return { ...row, metricKey, rowSchema: BROWSER_VAULT_METRIC_ROW_SCHEMA };
}

function requireMetricBucket(
  bucket: BrowserVaultMetricBucketShard,
  expectedBucketId: BrowserVaultMetricBucketId,
  identity: BrowserVaultReplicaShardIdentity,
): void {
  requireSchema(bucket.schema, BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA, `Browser vault metric bucket ${expectedBucketId}.schema`);
  if (bucket.bucketId !== expectedBucketId) throw new TypeError(`Browser vault metric bucket id must be ${expectedBucketId}.`);
  requireMatchingIdentity(identity, bucket.identity, `metric bucket ${expectedBucketId}`);
  if (!verifiedMetricBuckets.has(bucket)) {
    throw new TypeError(
      `Browser vault metric bucket ${expectedBucketId} must come from the bucket parser or replica splitter.`,
    );
  }
  for (const series of bucket.series) {
    if (canonicalizeBrowserVaultMetricKey(series.metricKey).length === 0) {
      throw new TypeError(`Browser vault metric bucket ${expectedBucketId} has an empty metric key.`);
    }
  }
}

function requireReplicaIdentity(identity: BrowserVaultReplicaShardIdentity, label: string): void {
  requireSchema(identity.replicaSchema, BROWSER_VAULT_REPLICA_SCHEMA, `${label}.replicaSchema`);
}

function requireMatchingIdentity(
  expected: BrowserVaultReplicaShardIdentity,
  actual: BrowserVaultReplicaShardIdentity,
  shardName: string,
): void {
  requireReplicaIdentity(actual, `Browser vault ${shardName} shard.identity`);
  if (
    actual.dataVersion !== expected.dataVersion
    || actual.generatedAt !== expected.generatedAt
    || actual.generation !== expected.generation
    || actual.sourceBundleHash !== expected.sourceBundleHash
  ) throw new TypeError(`Browser vault ${shardName} shard identity must match the core shard identity.`);
}

function requireSchema(actual: string, expected: string, label: string): void {
  if (actual !== expected) throw new TypeError(`${label} must be ${expected}.`);
}
