import { HOSTED_MAILBOX_CAUSAL_SEQ_QUALIFIER } from "@murphai/contracts";
import {
  METRIC_POINT_SCHEMA_VERSION,
  createCustomMetricDefinition,
  experimentSessionMetricIsDeclared,
  normalizeLabResultMetricValue,
  normalizeMetricKey,
  normalizeMetricValue,
  resolveLabResultMetricDefinition,
  resolveMetricDefinition,
  resolveExperimentSessionMetricSpec,
  resolveExperimentSessionMetricSpecForBiomarker,
  type MetricComparator,
  type MetricConfidence,
  type MetricGrain,
  type MetricDefinition,
  type MetricPoint,
  type MetricPointContext,
  type MetricSourceFamily,
  type MetricSourceKind,
} from "@murphai/health-metrics";

import type { CanonicalEntity } from "../canonical-entities.ts";
import {
  deriveWearableObservationEffectiveDate,
  inferWearableObservationGrain,
} from "../wearables/observation.ts";
import { isDeletionSentinelObservation } from "../observation-sentinels.ts";
import { buildSampleSummaryId } from "../sample-summary-id.ts";

export { parseGoalMetricTargets } from "./goals.ts";

export type {
  ExperimentPrimaryMetricCaptureAssessment,
  ExperimentPrimaryMetricCaptureIssue,
  GoalMetricTarget,
  MetricComparator,
  MetricConfidence,
  MetricDefinition,
  MetricGoalProgress,
  MetricGoalProgressStatus,
  MetricPoint,
  MetricPointContext,
  MetricPointProvenance,
  MetricSelection,
  MetricSelectionPolicy,
  MetricSelectionStatus,
  MetricSelectionWarning,
  MetricSelectionWarningCode,
  MetricSeries,
  MetricSeriesAggregation,
  MetricSeriesDuplicatePolicy,
  MetricSeriesPoint,
  MetricTrend,
  MetricWindowComparison,
  MetricWindowSummary,
} from "@murphai/health-metrics";

export {
  METRIC_POINT_SCHEMA_VERSION,
  METRIC_SELECTION_SCHEMA_VERSION,
  assessExperimentPrimaryMetricCapture,
  buildMetricSeries,
  createCustomMetricDefinition,
  experimentSessionMetricIsDeclared,
  formatMetricDisplayValue,
  listMetricPoints,
  listMetricDefinitions,
  metricWindowUnitsAreCompatible,
  metricPointRecordIds,
  normalizeMetricKey,
  normalizeMetricValue,
  resolveCanonicalBiomarkerKey,
  resolveComparableMetricPointValue,
  resolveMetricDefinition,
  resolveExperimentSessionMetricSpec,
  resolveExperimentSessionMetricSpecForBiomarker,
  resolveMetricDefinitionForBiomarker,
  selectMetricGoalProgress,
  selectMetricSeries,
  selectMetricTrend,
  selectMetricWindowComparison,
  selectMetricValue,
  unitsEquivalent,
  validateExperimentSessionMetricValue,
} from "@murphai/health-metrics";

export interface MetricRowEvidence {
  confidence: MetricConfidence;
  context?: MetricPointContext;
  dataOrigin?: unknown | null;
  date: string;
  externalRef?: unknown | null;
  metricKey: string;
  provider?: string | null;
  rawRefs?: readonly string[];
  recordIds: readonly string[];
  sourceFamily?: MetricSourceFamily;
  sourceKind: MetricSourceKind;
  sourceLabel: string | null;
  unit: string | null;
  value: number | null;
}

export interface SampleSummaryMetricEvidence {
  averageValue: number | null;
  date: string;
  firstSampleAt: string | null;
  lastSampleAt: string | null;
  numericSampleCount: number;
  sampleCount: number;
  stream: string;
  unit: string | null;
}

export function extractMetricPointsFromMetricRows(rows: readonly MetricRowEvidence[]): MetricPoint[] {
  return dedupeMetricPoints(rows.flatMap(metricPointFromMetricRow)).sort(compareMetricPointDesc);
}

export function extractMetricPointsFromSampleSummaries(summaries: readonly SampleSummaryMetricEvidence[]): MetricPoint[] {
  return dedupeMetricPoints(summaries.flatMap(metricPointFromSampleSummary)).sort(compareMetricPointDesc);
}

export function extractMetricPointsFromCanonicalEntities(entities: readonly CanonicalEntity[]): MetricPoint[] {
  return dedupeMetricPoints(entities.flatMap(metricPointsFromCanonicalEntity)).sort(compareMetricPointDesc);
}

export function extractMetricPoints(input: {
  metricRows?: readonly MetricRowEvidence[];
  sampleSummaries?: readonly SampleSummaryMetricEvidence[];
  vault?: { entities: readonly CanonicalEntity[] };
}): MetricPoint[] {
  return dedupeMetricPoints([
    ...extractMetricPointsFromMetricRows(input.metricRows ?? []),
    ...extractMetricPointsFromSampleSummaries(input.sampleSummaries ?? []),
    ...extractMetricPointsFromCanonicalEntities(input.vault?.entities ?? []),
  ]).sort(compareMetricPointDesc);
}

function metricPointFromSampleSummary(summary: SampleSummaryMetricEvidence): MetricPoint[] {
  if (summary.stream !== "glucose") {
    return [];
  }
  if (typeof summary.averageValue !== "number" || !Number.isFinite(summary.averageValue)) {
    return [];
  }

  const definition = resolveMetricDefinition("glucose");
  if (!definition) {
    return [];
  }

  const observedAt = summary.lastSampleAt ?? `${summary.date}T00:00:00.000Z`;
  const normalized = normalizeMetricValue({
    metricKey: definition.key,
    unit: summary.unit ?? definition.displayUnit,
    value: summary.averageValue,
  });

  return [createMetricPoint({
    biomarkerKey: definition.biomarkerKey,
    canonicalUnit: normalized.canonicalUnit,
    canonicalValue: normalized.canonicalValue,
    comparator: null,
    confidence: summary.numericSampleCount >= 3 ? "medium" : "low",
    context: {
      firstSampleAt: summary.firstSampleAt,
      lastSampleAt: summary.lastSampleAt,
      numericSampleCount: summary.numericSampleCount,
      sampleCount: summary.sampleCount,
      sourceStream: summary.stream,
    },
    effectiveDate: summary.date,
    grain: "day",
    metricKey: definition.key,
    observedAt,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: "Glucose sample summary",
    },
    recordedAt: null,
    reportedAt: null,
    source: {
      family: "sample",
      kind: "sample-summary",
      path: "",
      recordId: buildSampleSummaryId(summary),
      resultIndex: null,
    },
    statistic: "mean",
    textValue: null,
    unit: summary.unit ?? definition.displayUnit,
    value: summary.averageValue,
  })];
}

function metricPointFromMetricRow(row: MetricRowEvidence): MetricPoint[] {
  if (typeof row.value !== "number" || !Number.isFinite(row.value)) {
    return [];
  }
  const definition = resolveMetricDefinition(row.metricKey) ?? createCustomMetricDefinition(row.metricKey, row.unit);

  const observedAt = row.date.includes("T") ? row.date : `${row.date}T00:00:00.000Z`;
  const normalized = normalizeMetricValue({ metricKey: definition.key, unit: row.unit ?? definition.displayUnit, value: row.value });
  return [createMetricPoint({
    biomarkerKey: definition.biomarkerKey,
    canonicalUnit: normalized.canonicalUnit,
    canonicalValue: normalized.canonicalValue,
    comparator: null,
    confidence: row.confidence,
    context: compactContext({
      ...(row.context ?? {}),
      contributingRecordIds: readStringArray(row.recordIds),
    }),
    effectiveDate: row.date.slice(0, 10),
    grain: "day",
    metricKey: definition.key,
    observedAt,
    provenance: {
      dataOrigin: readJson(row.dataOrigin),
      externalRef: readJson(row.externalRef),
      labName: null,
      provider: row.provider ?? null,
      rawRefs: readStringArray(row.rawRefs),
      sourceLabel: row.sourceLabel,
    },
    recordedAt: null,
    reportedAt: null,
    source: {
      family: row.sourceFamily ?? "derived",
      kind: row.sourceKind,
      path: "",
      recordId: row.recordIds[0] ?? `derived:${definition.key}:${row.date}`,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit: row.unit ?? definition.displayUnit,
    value: row.value,
  })];
}

function metricPointsFromCanonicalEntity(entity: CanonicalEntity): MetricPoint[] {
  if (entity.family === "sample" && entity.kind === "metric_sample") {
    return metricSampleMetricPoints(entity);
  }

  if (entity.family !== "event") {
    return [];
  }

  switch (entity.kind) {
    case "measurement":
      return measurementMetricPoints(entity, "measurement");
    case "observation":
      return observationMetricPoints(entity);
    case "test":
      return testResultMetricPoints(entity);
    default:
      return [];
  }
}

function metricSampleMetricPoints(entity: CanonicalEntity): MetricPoint[] {
  const metric = readString(entity.attributes.metric) ?? entity.stream;
  const value = readNumber(entity.attributes.value);
  const unit = readString(entity.attributes.unit);
  const observedAt = readString(entity.attributes.recordedAt) ?? entity.occurredAt;
  if (!metric || value === null || !observedAt) return [];

  const metricKey = normalizeMetricKey(metric);
  const definition = resolveMetricDefinition(metricKey) ?? createCustomMetricDefinition(metricKey, unit);
  const normalized = normalizeMetricValue({ metricKey: definition.key, unit: unit ?? definition.displayUnit, value });
  const quality = readString(entity.attributes.quality) ?? entity.status ?? null;
  const source = readString(entity.attributes.source);
  const qualifiers = readQualifiers(entity.attributes.qualifiers);
  if (!isDisplayGradeMetricSample(source, quality, qualifiers)) return [];
  const provider = providerForMetricSample(entity);

  return [createMetricPoint({
    biomarkerKey: definition.biomarkerKey,
    canonicalUnit: normalized.canonicalUnit,
    canonicalValue: normalized.canonicalValue,
    comparator: null,
    confidence: metricSampleConfidence(quality),
    context: compactContext({
      qualifiers,
      quality: quality ?? undefined,
      source: source ?? undefined,
      timeZone: readString(entity.attributes.timeZone) ?? undefined,
    }),
    effectiveDate: readString(entity.attributes.dayKey) ?? observedAt.slice(0, 10),
    grain: "instant",
    metricKey: definition.key,
    observedAt,
    provenance: {
      dataOrigin: readJson(entity.attributes.dataOrigin),
      externalRef: readJson(entity.attributes.externalRef),
      labName: null,
      provider,
      rawRefs: [],
      sourceLabel: provider ? humanize(provider) : source ? humanize(source) : "Metric sample",
    },
    recordedAt: observedAt,
    reportedAt: null,
    source: {
      family: "sample",
      kind: "metric-sample",
      path: entity.path,
      recordId: entity.entityId,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit,
    value,
  })];
}

function metricSampleConfidence(quality: string | null): MetricConfidence {
  if (quality === "raw") return "medium";
  if (quality === "normalized" || quality === "derived") return "high";
  return "medium";
}

export function isDisplayGradeMetricSample(
  source: string | null,
  quality: string | null,
  qualifiers: Record<string, string | number | boolean> | undefined = undefined,
): boolean {
  if (source === "manual" || source === "derived") return true;
  if (quality === "derived") return true;
  if (quality === "raw") return false;
  return qualifiers?.summary === true || qualifiers?.["display-grade"] === true || qualifiers?.displayGrade === true;
}

export function isDisplayGradeMetricSampleEntity(entity: CanonicalEntity): boolean {
  if (entity.family !== "sample" || entity.kind !== "metric_sample") return false;
  const quality = readString(entity.attributes.quality) ?? entity.status ?? null;
  const source = readString(entity.attributes.source);
  const qualifiers = readQualifiers(entity.attributes.qualifiers);
  return isDisplayGradeMetricSample(source, quality, qualifiers);
}

function observationMetricPoints(entity: CanonicalEntity): MetricPoint[] {
  const metric = resolveObservationMetric(entity);
  const value = readNumber(entity.attributes.value);
  const unit = readString(entity.attributes.unit);
  if (!metric || value === null) return [];
  if (isDeletionSentinelObservation(entity, metric)) return [];

  // Daily provider summaries (observationGrain "summary") are day-grain
  // facts; other grains keep the event default. Legacy shared-normalizer
  // provider rows can lack observationGrain, so importer-shaped daily
  // resources infer the same summary grain from dayKey + externalRef.
  const explicitObservationGrain = readString(entity.attributes.observationGrain);
  const observationGrain = explicitObservationGrain ?? inferWearableObservationGrain(entity);
  const effectiveDate = resolveObservationEffectiveDate(entity, observationGrain);
  const qualifiers = readQualifiers(entity.attributes.qualifiers);

  return [scalarMetricPoint({
    confidence: eventConfidence(entity),
    context: {
      measurementMethodKey: eventMeasurementMethodKey(entity),
      observationGrain: observationGrain ?? undefined,
      causalSeq: readReportedDailyMetricCausalSeq(entity, qualifiers) ?? undefined,
      qualifiers,
      timeZone: readString(entity.attributes.timeZone) ?? undefined,
    },
    grain: isDayGrainObservation(observationGrain) ? "day" : undefined,
    // Canonical dayKey wins over the UTC slice of occurredAt: daily and
    // sleep observations are dated by their local/sleep day (the same
    // invariant deriveWearableDate uses), so precedence and date-filtered
    // queries must see the same day the summary point uses.
    effectiveDate,
    entity,
    index: 0,
    metric,
    sourceKind: "observation",
    unit,
    value,
  })];
}

function readReportedDailyMetricCausalSeq(
  entity: CanonicalEntity,
  qualifiers: Record<string, string | number | boolean> | undefined,
): string | null {
  const externalRef = readRecord(entity.attributes.externalRef);
  if (
    readString(entity.attributes.source) !== "manual"
    || readString(externalRef?.system) !== "manual"
    || readString(externalRef?.resourceType) !== "daily-metric-report"
  ) {
    return null;
  }
  const causalSeq = qualifiers?.[HOSTED_MAILBOX_CAUSAL_SEQ_QUALIFIER];
  return typeof causalSeq === "string" ? causalSeq : null;
}

function resolveObservationMetric(entity: CanonicalEntity): string | null {
  const metric = readString(entity.attributes.metric);
  if (metric !== "hrv") {
    return metric;
  }

  const dataOrigin = readRecord(entity.attributes.dataOrigin);
  const sourceProviderSlug = readString(dataOrigin?.sourceProviderSlug)
    ?.trim()
    .toLowerCase()
    .replace(/_/gu, "-");

  return sourceProviderSlug === "apple-health-kit" ? "hrv-sdnn" : metric;
}

function resolveObservationEffectiveDate(
  entity: CanonicalEntity,
  observationGrain: string | null,
): string | null {
  const dayKey = readString(entity.attributes.dayKey);
  if (!isDayGrainObservation(observationGrain)) {
    return dayKey ?? entity.date;
  }
  if (isDeviceProviderObservation(entity)) {
    return deriveWearableObservationEffectiveDate(entity) ?? dayKey ?? entity.date;
  }
  return dayKey ?? entity.date;
}

function isDayGrainObservation(observationGrain: string | null): boolean {
  if (!observationGrain) {
    return false;
  }
  const normalized = observationGrain.trim().toLowerCase().replace(/_/gu, "-");
  return normalized === "summary"
    || normalized === "day"
    || normalized === "daily-summary"
    || normalized === "daily-timeseries-aggregate";
}

function isDeviceProviderObservation(entity: CanonicalEntity): boolean {
  if (readString(entity.attributes.source) !== "device") {
    return false;
  }
  const externalRef = readRecord(entity.attributes.externalRef);
  return Boolean(readString(externalRef?.system) && readString(externalRef?.resourceType));
}

function measurementMetricPoints(entity: CanonicalEntity, sourceKind: MetricSourceKind): MetricPoint[] {
  return readArray(entity.attributes.measurements).flatMap((entry, index) => {
    const record = readRecord(entry);
    const metric = readString(record?.metric) ?? readString(record?.type);
    const value = readNumber(record?.value);
    const unit = readString(record?.unit);
    if (!metric || value === null) return [];

    return [scalarMetricPoint({
      confidence: eventConfidence(entity),
      context: { qualifiers: readQualifiers(record?.qualifiers) },
      entity,
      index,
      metric,
      sourceKind,
      unit,
      value,
    })];
  });
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
    const metricKey = resolveNonEmptyMetricKey(metric);
    const definition = resolveLabResultMetricDefinition(metricKey)
      ?? createCustomMetricDefinition(metricKey, unit);

    return [scalarMetricPoint({
      comparator: readComparator(record?.comparator),
      confidence: "high",
      context: {
        fastingStatus: readFastingStatus(entity.attributes.fastingStatus),
        flag: readString(record?.flag) ?? undefined,
        referenceRange: readReferenceRange(record?.referenceRange),
      },
      definition,
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
  definition?: MetricDefinition;
  effectiveDate?: string | null;
  entity: CanonicalEntity;
  grain?: MetricGrain;
  index: number;
  metric: string;
  observedAt?: string | null;
  reportedAt?: string | null;
  sourceKind: MetricSourceKind;
  textValue?: string | null;
  unit: string | null;
  value: number | null;
}): MetricPoint {
  const metricKey = resolveNonEmptyMetricKey(input.metric);
  const definition = input.definition
    ?? resolveMetricDefinition(metricKey)
    ?? createCustomMetricDefinition(metricKey, input.unit);
  const normalizeValue = input.sourceKind === "test-result"
    ? normalizeLabResultMetricValue
    : normalizeMetricValue;
  const normalized = input.sourceKind === "test-result" && input.unit === null
    ? null
    : normalizeValue({
        metricKey: definition.key,
        unit: input.unit ?? definition.displayUnit,
        value: input.value,
      });
  const observedAt = input.observedAt ?? entityObservedAt(input.entity);
  const effectiveDate = input.effectiveDate ?? observedAt.slice(0, 10);
  const labName = readString(input.entity.attributes.labName);

  return createMetricPoint({
    biomarkerKey: definition.biomarkerKey,
    canonicalUnit: normalized?.canonicalUnit ?? null,
    canonicalValue: normalized?.canonicalValue ?? null,
    comparator: input.comparator ?? null,
    confidence: input.confidence,
    context: compactContext(input.context),
    effectiveDate,
    grain: input.grain ?? "event",
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
    id: `metric-point:${hashMetricPointIdentity(input)}`,
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
  };
}

function dedupeMetricPoints(points: readonly MetricPoint[]): MetricPoint[] {
  const byId = new Map<string, MetricPoint>();
  for (const point of points) {
    byId.set(metricPointDedupeKey(point), point);
  }
  return [...byId.values()];
}

function metricPointDedupeKey(point: MetricPoint): string {
  return metricPointIdentityJson(point);
}

function hashMetricPointIdentity(point: Omit<MetricPoint, "id" | "schemaVersion">): string {
  return fnv1a64Hex(metricPointIdentityJson(point));
}

function metricPointIdentityJson(point: Omit<MetricPoint, "id" | "schemaVersion"> | MetricPoint): string {
  return JSON.stringify(metricPointIdentityTuple(point));
}

function metricPointIdentityTuple(point: Omit<MetricPoint, "id" | "schemaVersion"> | MetricPoint): readonly unknown[] {
  return [
    point.metricKey,
    point.observedAt,
    point.effectiveDate,
    point.grain,
    point.statistic,
    point.source.family,
    point.source.kind,
    point.source.recordId,
    point.source.resultIndex,
    point.source.path,
    point.comparator ?? "",
    point.canonicalValue ?? point.value ?? point.textValue ?? null,
    point.canonicalUnit ?? point.unit ?? null,
  ];
}

const FNV_64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_64_PRIME = 0x100000001b3n;
const FNV_64_MASK = 0xffffffffffffffffn;

function fnv1a64Hex(value: string): string {
  let hash = FNV_64_OFFSET_BASIS;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * FNV_64_PRIME) & FNV_64_MASK;
  }

  return hash.toString(16).padStart(16, "0");
}

function resolveNonEmptyMetricKey(metric: string): string {
  const normalized = normalizeMetricKey(metric);
  return normalized || `custom-${fnv1a64Hex(metric.normalize("NFKC").toLowerCase())}`;
}

function compareMetricPointDesc(left: MetricPoint, right: MetricPoint): number {
  if (left.effectiveDate !== right.effectiveDate) return right.effectiveDate.localeCompare(left.effectiveDate);
  if (left.observedAt !== right.observedAt) return right.observedAt.localeCompare(left.observedAt);
  return left.id.localeCompare(right.id);
}

function entityObservedAt(entity: CanonicalEntity): string {
  return entity.occurredAt ?? entity.date ?? new Date(0).toISOString();
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

function providerForMetricSample(entity: CanonicalEntity): string | null {
  const dataOrigin = readRecord(entity.attributes.dataOrigin);
  const externalRef = readRecord(entity.attributes.externalRef);
  return readString(dataOrigin?.sourceProviderSlug)
    ?? readString(dataOrigin?.aggregatorProvider)
    ?? readString(externalRef?.system)
    ?? readString(entity.attributes.source);
}

function eventConfidence(entity: CanonicalEntity): MetricConfidence {
  const dataOrigin = readRecord(entity.attributes.dataOrigin);
  const originConfidence = readString(dataOrigin?.originConfidence);
  if (originConfidence === "high" || originConfidence === "medium" || originConfidence === "low") {
    return originConfidence;
  }
  return readString(entity.attributes.source) === "manual" ? "medium" : "high";
}

function eventMeasurementMethodKey(entity: CanonicalEntity): string | undefined {
  const dataOrigin = readRecord(entity.attributes.dataOrigin);
  return readString(dataOrigin?.sourceType) ?? undefined;
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
