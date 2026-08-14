import type { CanonicalRecordClass } from "../canonical-entities.ts";
import type { OverviewWeeklySampleSummary } from "../overview.ts";
import type { TimelineEntry } from "../timeline.ts";
import { experimentOutcomeSchema } from "@murphai/contracts";
import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  BROWSER_VAULT_EXPERIMENT_RUN_CARD_SCHEMA,
  type BrowserVaultAssistantSummary,
  type BrowserVaultEntity,
  type BrowserVaultEntityLink,
  type BrowserVaultExperimentRunCard,
  type BrowserVaultExperimentRunCardMetric,
  type BrowserVaultExperimentRunCardSummary,
  type BrowserVaultLabResultReferenceRange,
  type BrowserVaultLabResultRow,
  type BrowserVaultLabSpecimenKind,
  type BrowserVaultMetricGoalProgressRow,
  type BrowserVaultMetricRow,
  type BrowserVaultMetricSelectionRow,
  type BrowserVaultReplica,
  type BrowserVaultReplicaPolicy,
  type BrowserVaultReplicaSource,
  type BrowserVaultSearchRow,
  type BrowserVaultSourceHealthRow,
  type BrowserVaultTimelineRow,
} from "./shared.ts";
import {
  assembleBrowserVaultReplicaShards,
  BROWSER_VAULT_CORE_SHARD_SCHEMA,
  BROWSER_VAULT_LABS_SHARD_SCHEMA,
  BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA,
  BROWSER_VAULT_METRICS_SHARD_SCHEMA,
  BROWSER_VAULT_REPLICA_SHARD_SET_SCHEMA,
  hasAllBrowserVaultMetricBuckets,
  markBrowserVaultMetricBucketShardVerified,
  type BrowserVaultCoreShard,
  type BrowserVaultLabsShard,
  type BrowserVaultMetricsShard,
  type BrowserVaultMetricBucketRow,
  type BrowserVaultMetricBucketShard,
  type BrowserVaultMetricBucketShards,
  type BrowserVaultReplicaShardIdentity,
  type BrowserVaultReplicaShardSet,
} from "./shards.ts";
import {
  BROWSER_VAULT_METRIC_BUCKET_IDS,
  getBrowserVaultMetricBucketId,
  requireBrowserVaultMetricBucketId,
  type BrowserVaultMetricBucketId,
} from "./metric-buckets.ts";
import { BROWSER_VAULT_LAB_RESULT_ROW_SCHEMA } from "./lab-results.ts";
import { BROWSER_VAULT_METRIC_ROW_SCHEMA } from "./metric-points.ts";
import {
  type PersonalPatternCell,
  type PersonalPatternFactor,
  type PersonalPatternOutcome,
  type PersonalPatternReport,
  type PersonalPatternStage,
} from "../personal-patterns.ts";

export function parseBrowserVaultReplica(value: unknown, label = "Browser vault replica"): BrowserVaultReplica {
  const record = requireRecord(value, label);
  const schema = requireString(record.schema, `${label}.schema`);
  if (schema !== BROWSER_VAULT_REPLICA_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${BROWSER_VAULT_REPLICA_SCHEMA}.`);
  }
  const generatedAt = requireIsoDateTime(record.generatedAt, `${label}.generatedAt`);
  const metricRows = requireArray(record.metricRows, `${label}.metricRows`).map((entry, index) =>
    parseMetricRow(entry, `${label}.metricRows[${index}]`)
  );

  return {
    assistantSummary: parseAssistantSummary(record.assistantSummary, `${label}.assistantSummary`),
    entities: requireArray(record.entities, `${label}.entities`).map((entry, index) => parseEntity(entry, `${label}.entities[${index}]`)),
    experimentOutcomes: record.experimentOutcomes === undefined
      ? []
      : requireArray(record.experimentOutcomes, `${label}.experimentOutcomes`).map((entry) =>
          experimentOutcomeSchema.parse(entry)
        ),
    experimentRunCards: readOptionalArray(
      record.experimentRunCards,
      `${label}.experimentRunCards`,
    ).map((entry, index) =>
      parseExperimentRunCard(entry, `${label}.experimentRunCards[${index}]`)
    ),
    generatedAt,
    ...(record.generation === undefined
      ? {}
      : { generation: requirePositiveSafeInteger(record.generation, `${label}.generation`) }),
    hasLabBiomarkers: record.hasLabBiomarkers === undefined
      ? metricRows.some((row) =>
          row.sourceKind === "test-result"
          && row.biomarkerKey !== null
          && row.value !== null
        )
      : requireBoolean(record.hasLabBiomarkers, `${label}.hasLabBiomarkers`),
    labResultRows: readOptionalArray(record.labResultRows, `${label}.labResultRows`).map((entry, index) =>
      parseLabResultRow(entry, `${label}.labResultRows[${index}]`)
    ),
    metricGoalProgressRows: requireArray(record.metricGoalProgressRows, `${label}.metricGoalProgressRows`).map((entry, index) => parseMetricGoalProgressRow(entry, `${label}.metricGoalProgressRows[${index}]`)),
    metricRows,
    metricSelectionRows: requireArray(record.metricSelectionRows, `${label}.metricSelectionRows`).map((entry, index) => parseMetricSelectionRow(entry, `${label}.metricSelectionRows[${index}]`)),
    ...(record.personalPatterns === undefined
      ? {}
      : {
          personalPatterns: parsePersonalPatternReport(
            record.personalPatterns,
            `${label}.personalPatterns`,
          ),
        }),
    policy: parsePolicy(record.policy, `${label}.policy`),
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: requireArray(record.searchRows, `${label}.searchRows`).map((entry, index) => parseSearchRow(entry, `${label}.searchRows[${index}]`)),
    source: parseSource(record.source, `${label}.source`),
    sourceHealthRows: requireArray(record.sourceHealthRows, `${label}.sourceHealthRows`).map((entry, index) => parseSourceHealthRow(entry, `${label}.sourceHealthRows[${index}]`)),
    timelineRows: requireArray(record.timelineRows, `${label}.timelineRows`).map((entry, index) => parseTimelineRow(entry, `${label}.timelineRows[${index}]`)),
    weeklySampleSummaries: requireArray(record.weeklySampleSummaries, `${label}.weeklySampleSummaries`).map((entry, index) => parseWeeklySampleSummary(entry, `${label}.weeklySampleSummaries[${index}]`)),
  };
}

export function parseBrowserVaultCoreShard(
  value: unknown,
  label = "Browser vault core shard",
): BrowserVaultCoreShard {
  const record = requireRecord(value, label);
  requireExpectedSchema(record.schema, BROWSER_VAULT_CORE_SHARD_SCHEMA, `${label}.schema`);

  return {
    assistantSummary: parseAssistantSummary(record.assistantSummary, `${label}.assistantSummary`),
    entities: requireArray(record.entities, `${label}.entities`).map((entry, index) =>
      parseEntity(entry, `${label}.entities[${index}]`)
    ),
    experimentRunCards: requireArray(
      record.experimentRunCards,
      `${label}.experimentRunCards`,
    ).map((entry, index) =>
      parseExperimentRunCard(entry, `${label}.experimentRunCards[${index}]`)
    ),
    hasLabBiomarkers: requireBoolean(
      record.hasLabBiomarkers,
      `${label}.hasLabBiomarkers`,
    ),
    identity: parseShardIdentity(record.identity, `${label}.identity`),
    ...(record.personalPatterns === undefined
      ? {}
      : {
          personalPatterns: parsePersonalPatternReport(
            record.personalPatterns,
            `${label}.personalPatterns`,
          ),
        }),
    policy: parsePolicy(record.policy, `${label}.policy`),
    schema: BROWSER_VAULT_CORE_SHARD_SCHEMA,
    timelineRows: requireArray(record.timelineRows, `${label}.timelineRows`).map((entry, index) =>
      parseTimelineRow(entry, `${label}.timelineRows[${index}]`)
    ),
    weeklySampleSummaries: requireArray(
      record.weeklySampleSummaries,
      `${label}.weeklySampleSummaries`,
    ).map((entry, index) =>
      parseWeeklySampleSummary(entry, `${label}.weeklySampleSummaries[${index}]`)
    ),
  };
}

function parseExperimentRunCard(
  value: unknown,
  label: string,
): BrowserVaultExperimentRunCard {
  const record = requireRecord(value, label);
  const schema = requireExpectedSchema(
    record.schema,
    BROWSER_VAULT_EXPERIMENT_RUN_CARD_SCHEMA,
    `${label}.schema`,
  );
  const lookupKeys = requireRecord(record.lookupKeys, `${label}.lookupKeys`);
  const status = requireString(record.status, `${label}.status`);
  if (
    status !== "active"
    && status !== "paused"
    && status !== "finished"
    && status !== "stopped"
  ) {
    throw new TypeError(`${label}.status must be active, paused, finished, or stopped.`);
  }

  return {
    id: requireString(record.id, `${label}.id`),
    lookupKeys: {
      experimentIds: requireStringArray(
        lookupKeys.experimentIds,
        `${label}.lookupKeys.experimentIds`,
      ),
      protocolKeys: requireStringArray(
        lookupKeys.protocolKeys,
        `${label}.lookupKeys.protocolKeys`,
      ),
      slugs: requireStringArray(lookupKeys.slugs, `${label}.lookupKeys.slugs`),
    },
    requiredMetricBuckets: readOptionalArray(
      record.requiredMetricBuckets,
      `${label}.requiredMetricBuckets`,
    ).map((entry, index) => requireBrowserVaultMetricBucketId(
      entry,
      `${label}.requiredMetricBuckets[${index}]`,
    )),
    runSummary: parseExperimentRunCardSummary(
      record.runSummary,
      `${label}.runSummary`,
    ),
    schema,
    slug: readNullableString(record.slug),
    startedOn: readNullableString(record.startedOn),
    status,
    statusLabel: requireString(record.statusLabel, `${label}.statusLabel`),
    summary: readNullableString(record.summary),
    summaryDetail: readNullableString(record.summaryDetail),
    tags: requireStringArray(record.tags, `${label}.tags`),
    title: requireString(record.title, `${label}.title`),
  };
}

function parseExperimentRunCardSummary(
  value: unknown,
  label: string,
): BrowserVaultExperimentRunCardSummary {
  const record = requireRecord(value, label);
  return {
    ...(record.completionPercent === undefined
      ? {}
      : {
          completionPercent: requireNonNegativeInteger(
            record.completionPercent,
            `${label}.completionPercent`,
          ),
        }),
    ...(record.dailyCadence === undefined
      ? {}
      : {
          dailyCadence: parseExperimentRunCardDailyCadence(
            record.dailyCadence,
            `${label}.dailyCadence`,
          ),
        }),
    ...(record.dateRange === undefined
      ? {}
      : { dateRange: requireString(record.dateRange, `${label}.dateRange`) }),
    ...(record.day === undefined
      ? {}
      : { day: requireNonNegativeInteger(record.day, `${label}.day`) }),
    ...(record.metric === undefined
      ? {}
      : { metric: parseExperimentRunCardMetric(record.metric, `${label}.metric`) }),
    metrics: requireArray(record.metrics, `${label}.metrics`).map((entry, index) =>
      parseExperimentRunCardMetric(entry, `${label}.metrics[${index}]`)
    ),
  };
}

function parseExperimentRunCardDailyCadence(
  value: unknown,
  label: string,
): NonNullable<BrowserVaultExperimentRunCardSummary["dailyCadence"]> {
  const record = requireRecord(value, label);
  return {
    cadence: requireString(record.cadence, `${label}.cadence`),
    completed: requireNonNegativeInteger(record.completed, `${label}.completed`),
    expected: requireNonNegativeInteger(record.expected, `${label}.expected`),
    ...(record.label === undefined
      ? {}
      : { label: requireString(record.label, `${label}.label`) }),
  };
}

function parseExperimentRunCardMetric(
  value: unknown,
  label: string,
): BrowserVaultExperimentRunCardMetric {
  const record = requireRecord(value, label);
  const direction = record.direction === undefined
    ? undefined
    : requireString(record.direction, `${label}.direction`);
  if (
    direction !== undefined
    && direction !== "down"
    && direction !== "neutral"
    && direction !== "up"
  ) {
    throw new TypeError(`${label}.direction must be down, neutral, or up.`);
  }
  return {
    ...(record.baseline === undefined
      ? {}
      : { baseline: requireString(record.baseline, `${label}.baseline`) }),
    ...(record.biomarkerKey === undefined
      ? {}
      : { biomarkerKey: requireString(record.biomarkerKey, `${label}.biomarkerKey`) }),
    current: requireString(record.current, `${label}.current`),
    ...(record.delta === undefined
      ? {}
      : { delta: requireString(record.delta, `${label}.delta`) }),
    ...(direction === undefined ? {} : { direction }),
    label: requireString(record.label, `${label}.label`),
  };
}

export function parseBrowserVaultMetricsShard(
  value: unknown,
  label = "Browser vault metrics shard",
): BrowserVaultMetricsShard {
  const record = requireRecord(value, label);
  requireExpectedSchema(record.schema, BROWSER_VAULT_METRICS_SHARD_SCHEMA, `${label}.schema`);

  return {
    experimentOutcomes: requireArray(
      record.experimentOutcomes,
      `${label}.experimentOutcomes`,
    ).map((entry) => experimentOutcomeSchema.parse(entry)),
    identity: parseShardIdentity(record.identity, `${label}.identity`),
    metricGoalProgressRows: requireArray(
      record.metricGoalProgressRows,
      `${label}.metricGoalProgressRows`,
    ).map((entry, index) =>
      parseMetricGoalProgressRow(entry, `${label}.metricGoalProgressRows[${index}]`)
    ),
    metricDirectory: requireArray(record.metricDirectory, `${label}.metricDirectory`).map(
      (entry, index) => {
        const directoryEntry = requireRecord(entry, `${label}.metricDirectory[${index}]`);
        return {
          bucketId: requireBrowserVaultMetricBucketId(
            directoryEntry.bucketId,
            `${label}.metricDirectory[${index}].bucketId`,
          ),
          metricKey: requireString(
            directoryEntry.metricKey,
            `${label}.metricDirectory[${index}].metricKey`,
          ),
          rowCount: requireNonNegativeInteger(
            directoryEntry.rowCount,
            `${label}.metricDirectory[${index}].rowCount`,
          ),
        };
      },
    ),
    metricRowCount: requireNonNegativeInteger(record.metricRowCount, `${label}.metricRowCount`),
    metricSelectionRows: requireArray(
      record.metricSelectionRows,
      `${label}.metricSelectionRows`,
    ).map((entry, index) =>
      parseMetricSelectionRow(entry, `${label}.metricSelectionRows[${index}]`)
    ),
    schema: BROWSER_VAULT_METRICS_SHARD_SCHEMA,
    sourceHealthRows: requireArray(record.sourceHealthRows, `${label}.sourceHealthRows`).map(
      (entry, index) => parseSourceHealthRow(entry, `${label}.sourceHealthRows[${index}]`),
    ),
  };
}

export async function parseBrowserVaultMetricBucketShard(
  value: unknown,
  expectedBucketId?: BrowserVaultMetricBucketId,
  label = "Browser vault metric bucket shard",
): Promise<BrowserVaultMetricBucketShard> {
  const record = requireRecord(value, label);
  requireExpectedSchema(
    record.schema,
    BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA,
    `${label}.schema`,
  );
  const bucketId = requireBrowserVaultMetricBucketId(record.bucketId, `${label}.bucketId`);
  if (expectedBucketId !== undefined && bucketId !== expectedBucketId) {
    throw new TypeError(`${label}.bucketId must be ${expectedBucketId}.`);
  }
  const series = requireArray(record.series, `${label}.series`).map((entry, index) => {
    const seriesRecord = requireRecord(entry, `${label}.series[${index}]`);
    const metricKey = requireString(seriesRecord.metricKey, `${label}.series[${index}].metricKey`);
    return {
      metricKey,
      rows: requireArray(seriesRecord.rows, `${label}.series[${index}].rows`).map(
        (row, rowIndex) => parseMetricBucketRow(
          row,
          `${label}.series[${index}].rows[${rowIndex}]`,
        ),
      ),
    };
  });
  for (const entry of series) {
    const actualBucketId = await getBrowserVaultMetricBucketId(entry.metricKey);
    if (actualBucketId !== bucketId) {
      throw new TypeError(`${label} contains a metric key assigned to bucket ${actualBucketId}.`);
    }
  }
  return markBrowserVaultMetricBucketShardVerified({
    bucketId,
    identity: parseShardIdentity(record.identity, `${label}.identity`),
    schema: BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA,
    series,
  });
}

export function parseBrowserVaultLabsShard(
  value: unknown,
  label = "Browser vault labs shard",
): BrowserVaultLabsShard {
  const record = requireRecord(value, label);
  requireExpectedSchema(record.schema, BROWSER_VAULT_LABS_SHARD_SCHEMA, `${label}.schema`);

  return {
    identity: parseShardIdentity(record.identity, `${label}.identity`),
    labResultRows: requireArray(record.labResultRows, `${label}.labResultRows`).map((entry, index) =>
      parseLabResultRow(entry, `${label}.labResultRows[${index}]`)
    ),
    schema: BROWSER_VAULT_LABS_SHARD_SCHEMA,
  };
}

export async function parseBrowserVaultReplicaShards(
  value: unknown,
  label = "Browser vault replica shard set",
): Promise<BrowserVaultReplicaShardSet> {
  const record = requireRecord(value, label);
  requireExpectedSchema(record.schema, BROWSER_VAULT_REPLICA_SHARD_SET_SCHEMA, `${label}.schema`);

  const rawBuckets = requireRecord(record.metricBuckets, `${label}.metricBuckets`);
  const metricBuckets: Partial<Record<BrowserVaultMetricBucketId, BrowserVaultMetricBucketShard>> = {};
  const parsedBuckets = await Promise.all(BROWSER_VAULT_METRIC_BUCKET_IDS.map(async (bucketId) => ({
    bucket: await parseBrowserVaultMetricBucketShard(
      rawBuckets[bucketId],
      bucketId,
      `${label}.metricBuckets.${bucketId}`,
    ),
    bucketId,
  })));
  for (const { bucket, bucketId } of parsedBuckets) metricBuckets[bucketId] = bucket;
  if (!hasAllBrowserVaultMetricBuckets(metricBuckets)) {
    throw new TypeError(`${label}.metricBuckets must contain all fixed metric buckets.`);
  }
  return {
    core: parseBrowserVaultCoreShard(record.core, `${label}.core`),
    labs: parseBrowserVaultLabsShard(record.labs, `${label}.labs`),
    metricBuckets,
    metrics: parseBrowserVaultMetricsShard(record.metrics, `${label}.metrics`),
    schema: BROWSER_VAULT_REPLICA_SHARD_SET_SCHEMA,
  };
}

export async function parseBrowserVaultReplicaPayload(
  value: unknown,
  label = "Browser vault replica payload",
): Promise<BrowserVaultReplica> {
  const record = requireRecord(value, label);
  if (record.schema === BROWSER_VAULT_REPLICA_SCHEMA) {
    return parseBrowserVaultReplica(record, label);
  }
  return assembleBrowserVaultReplicaShards(await parseBrowserVaultReplicaShards(record, label));
}

function parseShardIdentity(
  value: unknown,
  label: string,
): BrowserVaultReplicaShardIdentity {
  const record = requireRecord(value, label);
  requireExpectedSchema(
    record.replicaSchema,
    BROWSER_VAULT_REPLICA_SCHEMA,
    `${label}.replicaSchema`,
  );
  return {
    dataVersion: requireString(record.dataVersion, `${label}.dataVersion`),
    generatedAt: requireIsoDateTime(record.generatedAt, `${label}.generatedAt`),
    ...(record.generation === undefined
      ? {}
      : { generation: requirePositiveSafeInteger(record.generation, `${label}.generation`) }),
    replicaSchema: BROWSER_VAULT_REPLICA_SCHEMA,
    sourceBundleHash: requireString(record.sourceBundleHash, `${label}.sourceBundleHash`),
  };
}

function parsePersonalPatternReport(value: unknown, label: string): PersonalPatternReport {
  const record = requireRecord(value, label);
  const lagDays = requireNonNegativeInteger(record.lagDays, `${label}.lagDays`);
  if (lagDays !== 1) throw new TypeError(`${label}.lagDays must be 1.`);
  return {
    asOfDate: requireString(record.asOfDate, `${label}.asOfDate`),
    cells: requireArray(record.cells, `${label}.cells`).map((entry, index) =>
      parsePersonalPatternCell(entry, `${label}.cells[${index}]`)
    ),
    factors: requireArray(record.factors, `${label}.factors`).map((entry, index) =>
      parsePersonalPatternFactor(entry, `${label}.factors[${index}]`)
    ),
    lagDays,
    notes: requireStringArray(record.notes, `${label}.notes`),
    outcomes: requireArray(record.outcomes, `${label}.outcomes`).map((entry, index) =>
      parsePersonalPatternOutcome(entry, `${label}.outcomes[${index}]`)
    ),
    repeatableCellCount: requireNonNegativeInteger(record.repeatableCellCount, `${label}.repeatableCellCount`),
    testedCellCount: requireNonNegativeInteger(record.testedCellCount, `${label}.testedCellCount`),
    windowDays: requireNonNegativeInteger(record.windowDays, `${label}.windowDays`),
  };
}

function parsePersonalPatternFactor(value: unknown, label: string): PersonalPatternFactor {
  const record = requireRecord(value, label);
  const kind = requireString(record.kind, `${label}.kind`);
  if (kind !== "activity" && kind !== "intervention" && kind !== "mixed") {
    throw new TypeError(`${label}.kind must be activity, intervention, or mixed.`);
  }
  return {
    id: requireString(record.id, `${label}.id`),
    kind,
    label: requireString(record.label, `${label}.label`),
    observedDays: requireNonNegativeInteger(record.observedDays, `${label}.observedDays`),
  };
}

function parsePersonalPatternOutcome(value: unknown, label: string): PersonalPatternOutcome {
  const record = requireRecord(value, label);
  return {
    id: requireString(record.id, `${label}.id`),
    label: requireString(record.label, `${label}.label`),
    unit: requireString(record.unit, `${label}.unit`),
  };
}

function parsePersonalPatternCell(value: unknown, label: string): PersonalPatternCell {
  const record = requireRecord(value, label);
  const direction = requireString(record.direction, `${label}.direction`);
  if (direction !== "higher" && direction !== "lower" && direction !== "flat") {
    throw new TypeError(`${label}.direction must be higher, lower, or flat.`);
  }
  return {
    comparisonDays: requireNonNegativeInteger(record.comparisonDays, `${label}.comparisonDays`),
    comparisonMean: readNullableFiniteNumber(record.comparisonMean),
    delta: readNullableFiniteNumber(record.delta),
    deltaPercent: readNullableFiniteNumber(record.deltaPercent),
    direction,
    exposedDays: requireNonNegativeInteger(record.exposedDays, `${label}.exposedDays`),
    exposedMean: readNullableFiniteNumber(record.exposedMean),
    factorId: requireString(record.factorId, `${label}.factorId`),
    firstExposedDate: readNullableString(record.firstExposedDate),
    lastExposedDate: readNullableString(record.lastExposedDate),
    outcomeId: requireString(record.outcomeId, `${label}.outcomeId`),
    repeatedDirection: requireBoolean(record.repeatedDirection, `${label}.repeatedDirection`),
    stage: requirePersonalPatternStage(record.stage, `${label}.stage`),
  };
}

function requirePersonalPatternStage(value: unknown, label: string): PersonalPatternStage {
  const stage = requireString(value, label);
  if (
    stage === "insufficient"
    || stage === "no_clear_pattern"
    || stage === "new_clue"
    || stage === "seen_again"
    || stage === "worth_testing"
  ) return stage;
  throw new TypeError(`${label} must be a Personal Patterns evidence stage.`);
}

function parsePolicy(value: unknown, label: string): BrowserVaultReplicaPolicy {
  const record = requireRecord(value, label);
  const id = requireString(record.id, `${label}.id`);
  if (id !== BROWSER_VAULT_REPLICA_POLICY_ID) {
    throw new TypeError(`${label}.id must be ${BROWSER_VAULT_REPLICA_POLICY_ID}.`);
  }
  return {
    bodyPreviewChars: requireNonNegativeInteger(record.bodyPreviewChars, `${label}.bodyPreviewChars`),
    excludedFamilies: requireStringArray(record.excludedFamilies, `${label}.excludedFamilies`),
    id,
    includedFamilies: requireStringArray(record.includedFamilies, `${label}.includedFamilies`),
    metricLookbackDays: requireNonNegativeInteger(record.metricLookbackDays, `${label}.metricLookbackDays`),
  };
}

function parseSource(value: unknown, label: string): BrowserVaultReplicaSource {
  const record = requireRecord(value, label);
  return {
    dataVersion: requireString(record.dataVersion, `${label}.dataVersion`),
    sourceBundleHash: requireString(record.sourceBundleHash, `${label}.sourceBundleHash`),
  };
}

function parseEntity(value: unknown, label: string): BrowserVaultEntity {
  const record = requireRecord(value, label);
  return {
    attributes: requireRecord(record.attributes, `${label}.attributes`),
    bodyPreview: readNullableString(record.bodyPreview),
    date: readNullableString(record.date),
    experimentSlug: readNullableString(record.experimentSlug),
    family: requireString(record.family, `${label}.family`),
    id: requireString(record.id, `${label}.id`),
    kind: requireString(record.kind, `${label}.kind`),
    links: requireArray(record.links, `${label}.links`).map((entry, index) => parseEntityLink(entry, `${label}.links[${index}]`)),
    lookupIds: requireStringArray(record.lookupIds, `${label}.lookupIds`),
    occurredAt: readNullableString(record.occurredAt),
    recordClass: requireRecordClass(record.recordClass, `${label}.recordClass`),
    status: readNullableString(record.status),
    stream: readNullableString(record.stream),
    tags: requireStringArray(record.tags, `${label}.tags`),
    title: readNullableString(record.title),
  };
}

function parseEntityLink(value: unknown, label: string): BrowserVaultEntityLink {
  const record = requireRecord(value, label);
  return { targetId: requireString(record.targetId, `${label}.targetId`), type: requireString(record.type, `${label}.type`) };
}

function parseLabResultRow(value: unknown, label: string): BrowserVaultLabResultRow {
  const record = requireRecord(value, label);
  const rowSchema = requireString(record.rowSchema, `${label}.rowSchema`);
  if (rowSchema !== BROWSER_VAULT_LAB_RESULT_ROW_SCHEMA) {
    throw new TypeError(`${label}.rowSchema must be ${BROWSER_VAULT_LAB_RESULT_ROW_SCHEMA}.`);
  }
  const valueNumber = readNullableFiniteNumber(record.value);
  const textValue = readNullableString(record.textValue);
  if (valueNumber === null && textValue === null) {
    throw new TypeError(`${label} must include a numeric value or textValue.`);
  }
  const normalizedValue = readNullableFiniteNumber(record.normalizedValue);
  const normalizedUnit = readNullableString(record.normalizedUnit);
  if ((normalizedValue === null) !== (normalizedUnit === null)) {
    throw new TypeError(`${label} normalizedValue and normalizedUnit must be provided together.`);
  }
  if (normalizedValue !== null && valueNumber === null) {
    throw new TypeError(`${label}.normalizedValue requires a numeric value.`);
  }

  return {
    analyte: requireString(record.analyte, `${label}.analyte`),
    biomarkerKey: readNullableString(record.biomarkerKey),
    comparator: readNullableMetricComparator(record.comparator, `${label}.comparator`),
    date: requireString(record.date, `${label}.date`),
    flag: readNullableString(record.flag),
    id: requireString(record.id, `${label}.id`),
    labName: readNullableString(record.labName),
    metricKey: requireString(record.metricKey, `${label}.metricKey`),
    normalizedUnit,
    normalizedValue,
    observedAt: requireString(record.observedAt, `${label}.observedAt`),
    referenceRange: readNullableReferenceRange(record.referenceRange, `${label}.referenceRange`),
    rowSchema,
    sourceLabel: readNullableString(record.sourceLabel),
    specimenKind: readNullableLabSpecimenKind(record.specimenKind, `${label}.specimenKind`),
    textValue,
    unit: readNullableString(record.unit),
    value: valueNumber,
  };
}

function readNullableLabSpecimenKind(
  value: unknown,
  label: string,
): BrowserVaultLabSpecimenKind | null {
  if (value === null || value === undefined) return null;
  if (value === "plasma" || value === "serum" || value === "whole_blood") return value;
  throw new TypeError(`${label} must be plasma, serum, whole_blood, or null.`);
}

function parseMetricRow(value: unknown, label: string): BrowserVaultMetricRow {
  const record = requireRecord(value, label);
  const rowSchema = requireString(record.rowSchema, `${label}.rowSchema`);
  if (rowSchema !== BROWSER_VAULT_METRIC_ROW_SCHEMA) {
    throw new TypeError(`${label}.rowSchema must be ${BROWSER_VAULT_METRIC_ROW_SCHEMA}.`);
  }
  return {
    biomarkerKey: readNullableString(record.biomarkerKey),
    comparator: readNullableMetricComparator(record.comparator, `${label}.comparator`),
    confidence: requireConfidenceLevel(record.confidence, `${label}.confidence`),
    context: requireRecord(record.context, `${label}.context`),
    date: requireString(record.date, `${label}.date`),
    grain: requireMetricGrain(record.grain, `${label}.grain`),
    id: requireString(record.id, `${label}.id`),
    metricKey: requireString(record.metricKey, `${label}.metricKey`),
    observedAt: requireString(record.observedAt, `${label}.observedAt`),
    pointIds: requireStringArray(record.pointIds, `${label}.pointIds`),
    recordIds: requireStringArray(record.recordIds, `${label}.recordIds`),
    rowSchema,
    sourceFamily: readNullableString(record.sourceFamily),
    sourceKind: readNullableString(record.sourceKind),
    sourceLabel: readNullableString(record.sourceLabel),
    statistic: requireMetricStatistic(record.statistic, `${label}.statistic`),
    unit: readNullableString(record.unit),
    value: readNullableFiniteNumber(record.value),
    valueLabel: readNullableString(record.valueLabel),
  };
}

function parseMetricBucketRow(value: unknown, label: string): BrowserVaultMetricBucketRow {
  const parsed = parseMetricRow(
    {
      ...requireRecord(value, label),
      metricKey: "physical-metric-key-restored-by-series",
      rowSchema: BROWSER_VAULT_METRIC_ROW_SCHEMA,
    },
    label,
  );
  const { metricKey: _metricKey, rowSchema: _rowSchema, ...bucketRow } = parsed;
  return bucketRow;
}

function parseMetricSelectionRow(value: unknown, label: string): BrowserVaultMetricSelectionRow {
  const record = requireRecord(value, label);
  const selectionSchema = requireString(record.selectionSchema, `${label}.selectionSchema`);
  if (selectionSchema !== "murph.browser-vault.metric-selection.v1") {
    throw new TypeError(`${label}.selectionSchema must be murph.browser-vault.metric-selection.v1.`);
  }
  return {
    biomarkerKey: readNullableString(record.biomarkerKey),
    confidence: requireConfidenceLevel(record.confidence, `${label}.confidence`),
    effectiveDate: readNullableString(record.effectiveDate),
    id: requireString(record.id, `${label}.id`),
    metricKey: requireString(record.metricKey, `${label}.metricKey`),
    observedAt: readNullableString(record.observedAt),
    pointIds: requireStringArray(record.pointIds, `${label}.pointIds`),
    recordIds: requireStringArray(record.recordIds, `${label}.recordIds`),
    selectedMetricRowId: readNullableString(record.selectedMetricRowId),
    selectionSchema,
    sourceLabel: readNullableString(record.sourceLabel),
    status: requireMetricSelectionStatus(record.status, `${label}.status`),
    unit: readNullableString(record.unit),
    value: readNullableFiniteNumber(record.value),
    valueLabel: readNullableString(record.valueLabel),
    warnings: requireArray(record.warnings, `${label}.warnings`).map((entry, index) => parseMetricSelectionWarning(entry, `${label}.warnings[${index}]`)),
  };
}

function parseMetricGoalProgressRow(value: unknown, label: string): BrowserVaultMetricGoalProgressRow {
  const record = requireRecord(value, label);
  return {
    currentValue: readNullableFiniteNumber(record.currentValue),
    currentValueLabel: readNullableString(record.currentValueLabel),
    deltaToTarget: readNullableFiniteNumber(record.deltaToTarget),
    goalId: requireString(record.goalId, `${label}.goalId`),
    metricKey: requireString(record.metricKey, `${label}.metricKey`),
    selectedPointIds: requireStringArray(record.selectedPointIds, `${label}.selectedPointIds`),
    status: requireMetricGoalStatus(record.status, `${label}.status`),
    targetId: requireString(record.targetId, `${label}.targetId`),
    targetValueLabel: requireString(record.targetValueLabel, `${label}.targetValueLabel`),
    unit: requireString(record.unit, `${label}.unit`),
    warnings: requireArray(record.warnings, `${label}.warnings`).map((entry, index) => parseMetricSelectionWarning(entry, `${label}.warnings[${index}]`)),
  };
}

function parseTimelineRow(value: unknown, label: string): BrowserVaultTimelineRow {
  const record = requireRecord(value, label);
  return {
    date: requireString(record.date, `${label}.date`),
    entityId: requireString(record.entityId, `${label}.entityId`),
    entryType: requireTimelineEntryType(record.entryType, `${label}.entryType`),
    family: requireString(record.family, `${label}.family`),
    id: requireString(record.id, `${label}.id`),
    kind: requireString(record.kind, `${label}.kind`),
    occurredAt: requireString(record.occurredAt, `${label}.occurredAt`),
    stream: readNullableString(record.stream),
    tags: requireStringArray(record.tags, `${label}.tags`),
    title: requireString(record.title, `${label}.title`),
  };
}

function parseSearchRow(value: unknown, label: string): BrowserVaultSearchRow {
  const record = requireRecord(value, label);
  return {
    date: readNullableString(record.date),
    entityId: requireString(record.entityId, `${label}.entityId`),
    family: requireString(record.family, `${label}.family`),
    id: requireString(record.id, `${label}.id`),
    kind: requireString(record.kind, `${label}.kind`),
    occurredAt: readNullableString(record.occurredAt),
    tags: requireStringArray(record.tags, `${label}.tags`),
    text: requireString(record.text, `${label}.text`),
    title: readNullableString(record.title),
  };
}

function parseSourceHealthRow(value: unknown, label: string): BrowserVaultSourceHealthRow {
  const record = requireRecord(value, label);
  return {
    activityDays: requireNonNegativeInteger(record.activityDays, `${label}.activityDays`),
    bodyStateDays: requireNonNegativeInteger(record.bodyStateDays, `${label}.bodyStateDays`),
    conflictCount: requireNonNegativeInteger(record.conflictCount, `${label}.conflictCount`),
    firstDate: readNullableString(record.firstDate),
    lastDate: readNullableString(record.lastDate),
    latestRecordedAt: readNullableString(record.latestRecordedAt),
    provider: requireString(record.provider, `${label}.provider`),
    providerDisplayName: requireString(record.providerDisplayName, `${label}.providerDisplayName`),
    recoveryDays: requireNonNegativeInteger(record.recoveryDays, `${label}.recoveryDays`),
    selectedMetrics: requireNonNegativeInteger(record.selectedMetrics, `${label}.selectedMetrics`),
    sleepNights: requireNonNegativeInteger(record.sleepNights, `${label}.sleepNights`),
    stalenessVsNewestDays: readNullableNonNegativeInteger(record.stalenessVsNewestDays, `${label}.stalenessVsNewestDays`),
  };
}

function parseWeeklySampleSummary(value: unknown, label: string): OverviewWeeklySampleSummary {
  const record = requireRecord(value, label);
  return {
    date: requireString(record.date, `${label}.date`),
    numericSampleCount: requireNonNegativeInteger(record.numericSampleCount, `${label}.numericSampleCount`),
    sampleCount: requireNonNegativeInteger(record.sampleCount, `${label}.sampleCount`),
    stream: requireString(record.stream, `${label}.stream`),
    sumValue: readNullableFiniteNumber(record.sumValue),
    unit: readNullableString(record.unit),
  };
}

function parseAssistantSummary(value: unknown, label: string): BrowserVaultAssistantSummary {
  const record = requireRecord(value, label);
  return {
    highlights: requireStringArray(record.highlights, `${label}.highlights`),
    latestDate: readNullableString(record.latestDate),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value.slice();
}
function readOptionalArray(value: unknown, label: string): unknown[] {
  return value === undefined ? [] : requireArray(value, label);
}
function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string.`);
  return value;
}
function requireExpectedSchema<TSchema extends string>(
  value: unknown,
  expected: TSchema,
  label: string,
): TSchema {
  const schema = requireString(value, label);
  if (schema !== expected) throw new TypeError(`${label} must be ${expected}.`);
  return expected;
}
function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) => requireString(entry, `${label}[${index}]`));
}
function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number.`);
  return value;
}
function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean.`);
  return value;
}
function readNullableFiniteNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : requireFiniteNumber(value, "nullable number");
}
function requireNonNegativeInteger(value: unknown, label: string): number {
  const parsed = requireFiniteNumber(value, label);
  if (!Number.isInteger(parsed) || parsed < 0) throw new TypeError(`${label} must be a non-negative integer.`);
  return parsed;
}
function requirePositiveSafeInteger(value: unknown, label: string): number {
  const parsed = requireFiniteNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new TypeError(`${label} must be a positive safe integer.`);
  return parsed;
}
function readNullableNonNegativeInteger(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : requireNonNegativeInteger(value, label);
}
function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new TypeError("Expected nullable string.");
  return value;
}
function requireIsoDateTime(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (Number.isNaN(Date.parse(text))) throw new TypeError(`${label} must be an ISO timestamp.`);
  return text;
}
function requireRecordClass(value: unknown, label: string): CanonicalRecordClass {
  const text = requireString(value, label);
  if (text === "bank" || text === "ledger" || text === "sample" || text === "snapshot") return text;
  throw new TypeError(`${label} must be a canonical record class.`);
}
function requireConfidenceLevel(value: unknown, label: string) {
  const text = requireString(value, label);
  if (text === "none" || text === "low" || text === "medium" || text === "high") return text;
  throw new TypeError(`${label} must be a metric confidence level.`);
}
function requireMetricGrain(value: unknown, label: string) {
  const text = requireString(value, label);
  if (text === "instant" || text === "event" || text === "day" || text === "week" || text === "month" || text === "window") return text;
  throw new TypeError(`${label} must be a metric grain.`);
}
function requireMetricStatistic(value: unknown, label: string) {
  const text = requireString(value, label);
  if (text === "value" || text === "latest" || text === "mean" || text === "median" || text === "min" || text === "max" || text === "sum" || text === "count") return text;
  throw new TypeError(`${label} must be a metric statistic.`);
}
function readNullableMetricComparator(value: unknown, label: string) {
  if (value === null || value === undefined) return null;
  const text = requireString(value, label);
  if (text === "<" || text === "<=" || text === ">" || text === ">=") return text;
  throw new TypeError(`${label} must be a metric comparator.`);
}
function readNullableReferenceRange(
  value: unknown,
  label: string,
): BrowserVaultLabResultReferenceRange | null {
  if (value === null || value === undefined) return null;
  const record = requireRecord(value, label);
  const low = readNullableFiniteNumber(record.low);
  const high = readNullableFiniteNumber(record.high);
  const text = readNullableString(record.text);
  if (low === null && high === null && text === null) {
    throw new TypeError(`${label} must include low, high, or text.`);
  }
  return {
    ...(low !== null ? { low } : {}),
    ...(high !== null ? { high } : {}),
    ...(text !== null ? { text } : {}),
  };
}
function requireMetricSelectionStatus(value: unknown, label: string) {
  const text = requireString(value, label);
  if (text === "insufficient_data" || text === "no_data" || text === "ready" || text === "stale" || text === "unsupported") return text;
  throw new TypeError(`${label} must be a metric selection status.`);
}
function requireMetricGoalStatus(value: unknown, label: string) {
  const text = requireString(value, label);
  if (text === "behind" || text === "met" || text === "no_data" || text === "not_met" || text === "stale" || text === "unsupported") return text;
  throw new TypeError(`${label} must be a metric goal status.`);
}
function parseMetricSelectionWarning(value: unknown, label: string): BrowserVaultMetricSelectionRow["warnings"][number] {
  const record = requireRecord(value, label);
  const code = requireString(record.code, `${label}.code`);
  if (code !== "COMPARATOR_VALUE" && code !== "LOW_SAMPLE_COUNT" && code !== "MIXED_SOURCES" && code !== "SOURCE_STALE" && code !== "UNIT_NOT_NORMALIZED" && code !== "METHOD_CHANGED") {
    throw new TypeError(`${label}.code is not a supported metric selection warning code.`);
  }
  return { code, message: requireString(record.message, `${label}.message`) };
}
function requireTimelineEntryType(value: unknown, label: string): TimelineEntry["entryType"] {
  const text = requireString(value, label);
  if (text === "assessment" || text === "event" || text === "journal" || text === "sample_summary") return text;
  throw new TypeError(`${label} must be a timeline entry type.`);
}
