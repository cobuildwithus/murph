import {
  METRIC_POINT_SCHEMA_VERSION,
  createCustomMetricDefinition,
  formatMetricDisplayValue,
  normalizeMetricKey,
  normalizeMetricValue,
  resolveBrowserMetricBinding,
  resolveMetricDefinition,
  type MetricComparator,
  type MetricConfidence,
  type MetricPoint,
  type MetricPointContext,
  type MetricPointProvenance,
  type MetricSourceKind,
} from "@murphai/health-metrics";

import type { CanonicalEntity } from "../canonical-entities.ts";

export type {
  MetricComparator,
  MetricConfidence,
  MetricDefinition,
  MetricPoint,
  MetricPointContext,
  MetricPointProvenance,
  MetricSelection,
  MetricSelectionPolicy,
  MetricSelectionStatus,
  MetricSelectionWarning,
  MetricSelectionWarningCode,
} from "@murphai/health-metrics";

export {
  METRIC_POINT_SCHEMA_VERSION,
  METRIC_SELECTION_SCHEMA_VERSION,
  buildMetricSeries,
  createCustomMetricDefinition,
  formatMetricDisplayValue,
  listMetricDefinitions,
  normalizeMetricKey,
  normalizeMetricValue,
  resolveBrowserMetricBinding,
  resolveMetricDefinition,
  selectMetricValue,
} from "@murphai/health-metrics";

export interface MetricRowEvidence {
  confidence: MetricConfidence;
  date: string;
  domain: string;
  id: string;
  metric: string;
  recordIds: readonly string[];
  sourceFamily: string | null;
  sourceKind: string | null;
  unit: string | null;
  value: number | null;
}

export function extractMetricPointsFromMetricRows(rows: readonly MetricRowEvidence[]): MetricPoint[] {
  return dedupeMetricPoints(rows.flatMap(metricPointFromMetricRow)).sort(compareMetricPointDesc);
}

export function extractMetricPointsFromCanonicalEntities(entities: readonly CanonicalEntity[]): MetricPoint[] {
  return dedupeMetricPoints(entities.flatMap(metricPointsFromCanonicalEntity)).sort(compareMetricPointDesc);
}

export function extractMetricPoints(input: {
  metricRows?: readonly MetricRowEvidence[];
  vault?: { entities: readonly CanonicalEntity[] };
}): MetricPoint[] {
  return dedupeMetricPoints([
    ...extractMetricPointsFromMetricRows(input.metricRows ?? []),
    ...extractMetricPointsFromCanonicalEntities(input.vault?.entities ?? []),
  ]).sort(compareMetricPointDesc);
}

function metricPointFromMetricRow(row: MetricRowEvidence): MetricPoint[] {
  const definition = resolveBrowserMetricBinding({ domain: row.domain, metric: row.metric });
  if (!definition || typeof row.value !== "number" || !Number.isFinite(row.value)) {
    return [];
  }

  const observedAt = row.date.includes("T") ? row.date : `${row.date}T00:00:00.000Z`;
  const normalized = normalizeMetricValue({ metricKey: definition.key, unit: row.unit ?? definition.displayUnit, value: row.value });
  const sourceKind = metricSourceKindForRow(row);

  return [createMetricPoint({
    biomarkerKey: definition.biomarkerKey,
    canonicalUnit: normalized.canonicalUnit,
    canonicalValue: normalized.canonicalValue,
    comparator: null,
    confidence: row.confidence,
    context: {},
    effectiveDate: row.date.slice(0, 10),
    metricKey: definition.key,
    observedAt,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: sourceLabelForMetricRow(row),
    },
    recordedAt: null,
    reportedAt: null,
    source: {
      family: "derived",
      kind: sourceKind,
      path: "",
      recordId: row.id,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit: row.unit ?? definition.displayUnit,
    value: row.value,
  })];
}

function metricPointsFromCanonicalEntity(entity: CanonicalEntity): MetricPoint[] {
  if (entity.family !== "event") {
    return [];
  }

  switch (entity.kind) {
    case "measurement":
      return measurementMetricPoints(entity);
    case "body_measurement":
      return bodyMeasurementMetricPoints(entity);
    case "observation":
      return observationMetricPoints(entity);
    case "test":
      return testResultMetricPoints(entity);
    default:
      return [];
  }
}

function measurementMetricPoints(entity: CanonicalEntity): MetricPoint[] {
  return readArray(entity.attributes.measurements).flatMap((entry, index) => {
    const record = readRecord(entry);
    const metric = readString(record?.metric);
    const value = readNumber(record?.value);
    const unit = readString(record?.unit);
    if (!metric || value === null) return [];

    return [scalarMetricPoint({
      confidence: eventConfidence(entity),
      context: { qualifiers: readQualifiers(record?.qualifiers) },
      entity,
      index,
      metric,
      sourceKind: "measurement",
      unit,
      value,
    })];
  });
}

function bodyMeasurementMetricPoints(entity: CanonicalEntity): MetricPoint[] {
  return readArray(entity.attributes.measurements).flatMap((entry, index) => {
    const record = readRecord(entry);
    const metric = readString(record?.type);
    const value = readNumber(record?.value);
    const unit = readString(record?.unit);
    if (!metric || value === null) return [];

    return [scalarMetricPoint({
      confidence: eventConfidence(entity),
      context: {},
      entity,
      index,
      metric,
      sourceKind: "compat-body-measurement",
      unit,
      value,
    })];
  });
}

function observationMetricPoints(entity: CanonicalEntity): MetricPoint[] {
  const metric = readString(entity.attributes.metric);
  const value = readNumber(entity.attributes.value);
  const unit = readString(entity.attributes.unit);
  if (!metric || value === null) return [];

  return [scalarMetricPoint({
    confidence: eventConfidence(entity),
    context: {},
    entity,
    index: 0,
    metric,
    sourceKind: "compat-observation",
    unit,
    value,
  })];
}

function testResultMetricPoints(entity: CanonicalEntity): MetricPoint[] {
  const results = readArray(entity.attributes.results);
  const collectedAt = readString(entity.attributes.collectedAt);
  const reportedAt = readString(entity.attributes.reportedAt);
  const observedAt = collectedAt ?? entity.occurredAt ?? reportedAt ?? entity.date ?? null;
  if (!observedAt) return [];

  return results.flatMap((entry, index) => {
    const record = readRecord(entry);
    const metric = readString(record?.biomarkerSlug) ?? readString(record?.slug) ?? readString(record?.analyte);
    const value = readNumber(record?.value);
    const textValue = readString(record?.textValue);
    const unit = readString(record?.unit);
    if (!metric || (value === null && !textValue)) return [];

    return [scalarMetricPoint({
      comparator: readComparator(record?.comparator),
      confidence: "high",
      context: {
        fastingStatus: readFastingStatus(entity.attributes.fastingStatus),
        flag: readString(record?.flag) ?? undefined,
        referenceRange: readReferenceRange(record?.referenceRange),
      },
      entity,
      index,
      metric,
      observedAt,
      reportedAt,
      sourceKind: "test-result",
      textValue,
      unit,
      value,
    })];
  });
}

function scalarMetricPoint(input: {
  comparator?: MetricComparator | null;
  confidence: MetricConfidence;
  context: MetricPointContext;
  entity: CanonicalEntity;
  index: number;
  metric: string;
  observedAt?: string | null;
  reportedAt?: string | null;
  sourceKind: MetricSourceKind;
  textValue?: string | null;
  unit: string | null;
  value: number | null;
}): MetricPoint {
  const metricKey = normalizeMetricKey(input.metric);
  const definition = resolveMetricDefinition(metricKey) ?? createCustomMetricDefinition(metricKey, input.unit);
  const normalized = normalizeMetricValue({ metricKey: definition.key, unit: input.unit ?? definition.displayUnit, value: input.value });
  const observedAt = input.observedAt ?? entityObservedAt(input.entity);
  const effectiveDate = observedAt.slice(0, 10);
  const labName = readString(input.entity.attributes.labName);

  return createMetricPoint({
    biomarkerKey: definition.biomarkerKey,
    canonicalUnit: normalized.canonicalUnit,
    canonicalValue: normalized.canonicalValue,
    comparator: input.comparator ?? null,
    confidence: input.confidence,
    context: compactContext(input.context),
    effectiveDate,
    metricKey: definition.key,
    observedAt,
    provenance: {
      dataOrigin: readJson(input.entity.attributes.dataOrigin),
      externalRef: readJson(input.entity.attributes.externalRef),
      labName,
      provider: providerForEntity(input.entity),
      rawRefs: readStringArray(input.entity.attributes.rawRefs),
      sourceLabel: sourceLabelForEntity(input.entity),
    },
    recordedAt: readString(input.entity.attributes.recordedAt),
    reportedAt: input.reportedAt ?? readString(input.entity.attributes.reportedAt),
    source: {
      family: "event",
      kind: input.sourceKind,
      path: input.entity.path,
      recordId: input.entity.entityId,
      resultIndex: input.index,
    },
    statistic: "value",
    textValue: input.textValue ?? null,
    unit: input.unit,
    value: input.value,
  });
}

function createMetricPoint(input: Omit<MetricPoint, "id" | "schemaVersion">): MetricPoint {
  return {
    ...input,
    id: [
      "metric-point",
      input.metricKey,
      input.effectiveDate,
      input.source.recordId,
      input.source.kind,
      input.source.resultIndex ?? 0,
    ].join(":"),
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
  };
}

function dedupeMetricPoints(points: readonly MetricPoint[]): MetricPoint[] {
  const byId = new Map<string, MetricPoint>();
  for (const point of points) {
    byId.set(point.id, point);
  }
  return [...byId.values()];
}

function compareMetricPointDesc(left: MetricPoint, right: MetricPoint): number {
  if (left.effectiveDate !== right.effectiveDate) return right.effectiveDate.localeCompare(left.effectiveDate);
  if (left.observedAt !== right.observedAt) return right.observedAt.localeCompare(left.observedAt);
  return left.id.localeCompare(right.id);
}

function entityObservedAt(entity: CanonicalEntity): string {
  return entity.occurredAt ?? entity.date ?? new Date(0).toISOString();
}

function metricSourceKindForRow(row: MetricRowEvidence): MetricSourceKind {
  if (row.domain === "sleep") return "sleep-summary";
  if (row.domain === "activity") return "activity-summary";
  return "wearable-summary";
}

function sourceLabelForMetricRow(row: MetricRowEvidence): string {
  if (row.sourceKind && row.sourceKind !== "summary") return humanize(row.sourceKind);
  if (row.sourceFamily && row.sourceFamily !== "derived") return humanize(row.sourceFamily);
  return "Wearable summary";
}

function sourceLabelForEntity(entity: CanonicalEntity): string | null {
  const labName = readString(entity.attributes.labName);
  if (labName) return labName;
  const source = readString(entity.attributes.source) ?? entity.status;
  if (entity.kind === "test") return source ? humanize(source) : "Lab result";
  return source ? humanize(source) : "Manual";
}

function providerForEntity(entity: CanonicalEntity): string | null {
  const externalRef = readRecord(entity.attributes.externalRef);
  return readString(externalRef?.system);
}

function eventConfidence(entity: CanonicalEntity): MetricConfidence {
  return readString(entity.attributes.source) === "manual" ? "medium" : "high";
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readJson(value: unknown): unknown | null {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function readComparator(value: unknown): MetricComparator | null {
  return value === "<" || value === "<=" || value === ">" || value === ">=" ? value : null;
}

function readFastingStatus(value: unknown): "fasting" | "non_fasting" | "unknown" | undefined {
  return value === "fasting" || value === "non_fasting" || value === "unknown" ? value : undefined;
}

function readReferenceRange(value: unknown): MetricPointContext["referenceRange"] {
  const record = readRecord(value);
  if (!record) return undefined;
  const low = readNumber(record.low);
  const high = readNumber(record.high);
  const text = readString(record.text);
  return low === null && high === null && !text
    ? undefined
    : {
        ...(low !== null ? { low } : {}),
        ...(high !== null ? { high } : {}),
        ...(text ? { text } : {}),
      };
}

function readQualifiers(value: unknown): Record<string, string | number | boolean> | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const output: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      output[key] = entry;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function compactContext(context: MetricPointContext): MetricPointContext {
  return Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined)) as MetricPointContext;
}

function humanize(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
