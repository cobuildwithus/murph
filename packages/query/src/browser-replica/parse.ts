import type { CanonicalRecordClass } from "../canonical-entities.ts";
import type { OverviewWeeklySampleSummary } from "../overview.ts";
import type { TimelineEntry } from "../timeline.ts";
import type { WearableConfidenceLevel } from "../wearables.ts";
import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  type BrowserVaultAssistantSummary,
  type BrowserVaultEntity,
  type BrowserVaultEntityLink,
  type BrowserVaultMetricDayRow,
  type BrowserVaultMetricDomain,
  type BrowserVaultMetricPoint,
  type BrowserVaultMetricPointGrain,
  type BrowserVaultMetricPointStatistic,
  type BrowserVaultMetricRow,
  type BrowserVaultMetricSelectionRow,
  type BrowserVaultReplica,
  type BrowserVaultReplicaPolicy,
  type BrowserVaultReplicaSource,
  type BrowserVaultResolvedMetric,
  type BrowserVaultSearchRow,
  type BrowserVaultSourceHealthRow,
  type BrowserVaultTimelineRow,
} from "./shared.ts";

export function parseBrowserVaultReplica(
  value: unknown,
  label = "Browser vault replica",
): BrowserVaultReplica {
  const record = requireRecord(value, label);
  const schema = requireString(record.schema, `${label}.schema`);

  if (schema !== BROWSER_VAULT_REPLICA_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${BROWSER_VAULT_REPLICA_SCHEMA}.`);
  }

  return {
    assistantSummary: parseAssistantSummary(record.assistantSummary, `${label}.assistantSummary`),
    entities: requireArray(record.entities, `${label}.entities`).map((entry, index) =>
      parseEntity(entry, `${label}.entities[${index}]`)
    ),
    generatedAt: requireIsoDateTime(record.generatedAt, `${label}.generatedAt`),
    metricDayRows: requireArray(record.metricDayRows, `${label}.metricDayRows`).map((entry, index) =>
      parseMetricDayRow(entry, `${label}.metricDayRows[${index}]`)
    ),
    metricRows: requireArray(record.metricRows, `${label}.metricRows`).map((entry, index) =>
      parseMetricRow(entry, `${label}.metricRows[${index}]`)
    ),
    metricPoints: readOptionalArray(record.metricPoints, `${label}.metricPoints`).map((entry, index) =>
      parseMetricPoint(entry, `${label}.metricPoints[${index}]`)
    ),
    metricSelectionRows: readOptionalArray(record.metricSelectionRows, `${label}.metricSelectionRows`).map((entry, index) =>
      parseMetricSelectionRow(entry, `${label}.metricSelectionRows[${index}]`)
    ),
    policy: parsePolicy(record.policy, `${label}.policy`),
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: requireArray(record.searchRows, `${label}.searchRows`).map((entry, index) =>
      parseSearchRow(entry, `${label}.searchRows[${index}]`)
    ),
    source: parseSource(record.source, `${label}.source`),
    sourceHealthRows: requireArray(record.sourceHealthRows, `${label}.sourceHealthRows`).map((entry, index) =>
      parseSourceHealthRow(entry, `${label}.sourceHealthRows[${index}]`)
    ),
    timelineRows: requireArray(record.timelineRows, `${label}.timelineRows`).map((entry, index) =>
      parseTimelineRow(entry, `${label}.timelineRows[${index}]`)
    ),
    weeklySampleSummaries: requireArray(record.weeklySampleSummaries, `${label}.weeklySampleSummaries`).map((entry, index) =>
      parseWeeklySampleSummary(entry, `${label}.weeklySampleSummaries[${index}]`)
    ),
  };
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
    links: requireArray(record.links, `${label}.links`).map((entry, index) =>
      parseEntityLink(entry, `${label}.links[${index}]`)
    ),
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

  return {
    targetId: requireString(record.targetId, `${label}.targetId`),
    type: requireString(record.type, `${label}.type`),
  };
}

function parseMetricRow(value: unknown, label: string): BrowserVaultMetricRow {
  const record = requireRecord(value, label);

  return {
    confidence: requireConfidenceLevel(record.confidence, `${label}.confidence`),
    date: requireString(record.date, `${label}.date`),
    domain: requireMetricDomain(record.domain, `${label}.domain`),
    id: requireString(record.id, `${label}.id`),
    metric: requireString(record.metric, `${label}.metric`),
    recordIds: requireStringArray(record.recordIds, `${label}.recordIds`),
    sourceFamily: readNullableString(record.sourceFamily),
    sourceKind: readNullableString(record.sourceKind),
    unit: readNullableString(record.unit),
    value: readNullableFiniteNumber(record.value),
  };
}

function parseMetricPoint(value: unknown, label: string): BrowserVaultMetricPoint {
  const record = requireRecord(value, label);
  const pointSchema = requireString(record.pointSchema, `${label}.pointSchema`);

  if (pointSchema !== "murph.browser-vault.metric-point.v1") {
    throw new TypeError(`${label}.pointSchema must be murph.browser-vault.metric-point.v1.`);
  }

  return {
    biomarkerKey: readNullableString(record.biomarkerKey),
    confidence: requireConfidenceLevel(record.confidence, `${label}.confidence`),
    date: requireString(record.date, `${label}.date`),
    grain: requireMetricPointGrain(record.grain, `${label}.grain`),
    id: requireString(record.id, `${label}.id`),
    metricKey: requireString(record.metricKey, `${label}.metricKey`),
    observedAt: requireString(record.observedAt, `${label}.observedAt`),
    pointSchema,
    recordIds: requireStringArray(record.recordIds, `${label}.recordIds`),
    sourceFamily: readNullableString(record.sourceFamily),
    sourceKind: readNullableString(record.sourceKind),
    sourceLabel: readNullableString(record.sourceLabel),
    sourceMetricRowId: requireString(record.sourceMetricRowId, `${label}.sourceMetricRowId`),
    statistic: requireMetricPointStatistic(record.statistic, `${label}.statistic`),
    unit: readNullableString(record.unit),
    value: requireFiniteNumber(record.value, `${label}.value`),
    valueLabel: requireString(record.valueLabel, `${label}.valueLabel`),
  };
}

function parseMetricSelectionRow(value: unknown, label: string): BrowserVaultMetricSelectionRow {
  const record = requireRecord(value, label);
  const selectionSchema = requireString(record.selectionSchema, `${label}.selectionSchema`);
  const status = requireString(record.status, `${label}.status`);

  if (selectionSchema !== "murph.browser-vault.metric-selection.v1") {
    throw new TypeError(`${label}.selectionSchema must be murph.browser-vault.metric-selection.v1.`);
  }
  if (status !== "ready" && status !== "stale") {
    throw new TypeError(`${label}.status must be ready or stale.`);
  }

  return {
    biomarkerKey: readNullableString(record.biomarkerKey),
    confidence: requireConfidenceLevel(record.confidence, `${label}.confidence`),
    date: requireString(record.date, `${label}.date`),
    id: requireString(record.id, `${label}.id`),
    metricKey: requireString(record.metricKey, `${label}.metricKey`),
    observedAt: requireString(record.observedAt, `${label}.observedAt`),
    pointIds: requireStringArray(record.pointIds, `${label}.pointIds`),
    recordIds: requireStringArray(record.recordIds, `${label}.recordIds`),
    selectionSchema,
    sourceLabel: readNullableString(record.sourceLabel),
    status,
    unit: readNullableString(record.unit),
    value: requireFiniteNumber(record.value, `${label}.value`),
    valueLabel: requireString(record.valueLabel, `${label}.valueLabel`),
    warnings: requireArray(record.warnings, `${label}.warnings`).map((entry, index) =>
      parseMetricSelectionWarning(entry, `${label}.warnings[${index}]`)
    ),
  };
}

function parseMetricDayRow(value: unknown, label: string): BrowserVaultMetricDayRow {
  const record = requireRecord(value, label);

  return {
    attributes: requireRecord(record.attributes, `${label}.attributes`),
    confidence: requireConfidenceLevel(record.confidence, `${label}.confidence`),
    date: requireString(record.date, `${label}.date`),
    domain: requireMetricDomain(record.domain, `${label}.domain`),
    id: requireString(record.id, `${label}.id`),
    metricIds: requireStringArray(record.metricIds, `${label}.metricIds`),
    metrics: parseMetricMap(record.metrics, `${label}.metrics`),
    notes: requireStringArray(record.notes, `${label}.notes`),
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

function parseMetricMap(value: unknown, label: string): Record<string, BrowserVaultResolvedMetric> {
  const record = requireRecord(value, label);
  const output: Record<string, BrowserVaultResolvedMetric> = {};

  for (const [key, metricValue] of Object.entries(record)) {
    output[key] = parseResolvedMetric(metricValue, `${label}.${key}`);
  }

  return output;
}

function parseResolvedMetric(value: unknown, label: string): BrowserVaultResolvedMetric {
  const record = requireRecord(value, label);
  const selection = requireRecord(record.selection, `${label}.selection`);

  return {
    selection: {
      unit: readNullableString(selection.unit),
      value: readNullableFiniteNumber(selection.value),
    },
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value.slice();
}

function readOptionalArray(value: unknown, label: string): unknown[] {
  if (value === undefined) {
    return [];
  }

  return requireArray(value, label);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function readNullableFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireFiniteNumber(value, "nullable number");
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  const parsed = requireFiniteNumber(value, label);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }

  return parsed;
}

function readNullableNonNegativeInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireNonNegativeInteger(value, label);
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError("Expected nullable string.");
  }

  return value;
}

function requireIsoDateTime(value: unknown, label: string): string {
  const text = requireString(value, label);
  const parsed = Date.parse(text);

  if (Number.isNaN(parsed)) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }

  return text;
}

function requireRecordClass(value: unknown, label: string): CanonicalRecordClass {
  const text = requireString(value, label);

  if (text === "bank" || text === "ledger" || text === "sample" || text === "snapshot") {
    return text;
  }

  throw new TypeError(`${label} must be a canonical record class.`);
}

function requireMetricDomain(value: unknown, label: string): BrowserVaultMetricDomain {
  const text = requireString(value, label);

  if (text === "activity" || text === "body_state" || text === "recovery" || text === "sleep") {
    return text;
  }

  throw new TypeError(`${label} must be a browser vault metric domain.`);
}

function requireConfidenceLevel(value: unknown, label: string): WearableConfidenceLevel {
  const text = requireString(value, label);

  if (text === "none" || text === "low" || text === "medium" || text === "high") {
    return text;
  }

  throw new TypeError(`${label} must be a wearable confidence level.`);
}

function requireMetricPointGrain(value: unknown, label: string): BrowserVaultMetricPointGrain {
  const text = requireString(value, label);

  if (
    text === "instant" ||
    text === "event" ||
    text === "day" ||
    text === "week" ||
    text === "month" ||
    text === "window"
  ) {
    return text;
  }

  throw new TypeError(`${label} must be a metric point grain.`);
}

function requireMetricPointStatistic(value: unknown, label: string): BrowserVaultMetricPointStatistic {
  const text = requireString(value, label);

  if (
    text === "value" ||
    text === "latest" ||
    text === "mean" ||
    text === "median" ||
    text === "min" ||
    text === "max" ||
    text === "sum" ||
    text === "count"
  ) {
    return text;
  }

  throw new TypeError(`${label} must be a metric point statistic.`);
}

function parseMetricSelectionWarning(
  value: unknown,
  label: string,
): BrowserVaultMetricSelectionRow["warnings"][number] {
  const record = requireRecord(value, label);
  const code = requireString(record.code, `${label}.code`);

  if (
    code !== "LOW_SAMPLE_COUNT" &&
    code !== "MIXED_SOURCES" &&
    code !== "SOURCE_STALE" &&
    code !== "UNIT_NOT_NORMALIZED" &&
    code !== "METHOD_CHANGED"
  ) {
    throw new TypeError(`${label}.code is not a supported metric selection warning code.`);
  }

  return { code, message: requireString(record.message, `${label}.message`) };
}

function requireTimelineEntryType(value: unknown, label: string): TimelineEntry["entryType"] {
  const text = requireString(value, label);

  if (text === "assessment" || text === "event" || text === "journal" || text === "sample_summary") {
    return text;
  }

  throw new TypeError(`${label} must be a timeline entry type.`);
}
