import {
  METRIC_POINT_SCHEMA_VERSION,
  normalizeMetricKey,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  type GoalMetricTarget,
  type MetricConfidence,
  type MetricGrain,
  type MetricPoint,
  type MetricPointContext,
  type MetricPointProvenance,
  type MetricSourceFamily,
  type MetricStatistic,
} from "@murphai/health-metrics";

import type { CanonicalEntity } from "../canonical-entities.ts";
import { parseGoalMetricTargets } from "../metrics/index.ts";
import type {
  QueryMetricPointFilters,
  QueryMetricTargetRow,
} from "../query-projection-types.ts";
import {
  assertQueryProjectionTables,
  expectNullableString,
  openQueryProjectionDatabase,
  parseJsonValue,
  type DatabaseSync,
  type QueryProjectionLocation,
  type SqliteRow,
} from "./schema.ts";

const METRIC_POINT_CONTEXT_STORAGE_KEYS = [
  "aggregatePointCount",
  "aggregation",
  "candidateCount",
  "conflictingProviders",
  "contributingRecordIds",
  "exactDuplicateCount",
  "fastingStatus",
  "flag",
  "latestWindowDays",
  "measurementMethodKey",
  "observationGrain",
  "qualifiers",
  "quality",
  "recordedAt",
  "referenceRange",
  "sampleCount",
  "source",
  "sourceFamily",
  "sourceKind",
  "sourceStream",
  "syntheticRecordId",
  "timeZone",
  "windowEnd",
  "windowStart",
] as const;

interface StoredMetricPointPayload {
  context?: MetricPointContext;
  provenance?: StoredMetricPointProvenance;
  unit?: string | null;
  value?: number | null;
}

interface StoredMetricPointProvenance {
  labName?: string;
  provider?: string;
  rawRefs?: string[];
  sourceLabel?: string;
}

export function insertMetricPoints(
  database: DatabaseSync,
  metricPoints: readonly MetricPoint[],
): void {
  const insertMetricPoint = database.prepare(`
    INSERT INTO query_metric_points (
      id,
      sort_rank,
      metric_key,
      biomarker_key,
      value,
      text_value,
      comparator,
      unit,
      canonical_value,
      canonical_unit,
      observed_at,
      effective_date,
      recorded_at,
      reported_at,
      grain,
      statistic,
      source_family,
      source_kind,
      source_record_id,
      source_result_index,
      source_path,
      confidence,
      metric_point_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  metricPoints.forEach((point, index) => {
    insertMetricPoint.run(
      point.id,
      index,
      point.metricKey,
      point.biomarkerKey,
      point.canonicalValue ?? point.value,
      point.textValue,
      point.comparator,
      point.canonicalUnit ?? point.unit,
      point.canonicalValue,
      point.canonicalUnit,
      point.observedAt,
      point.effectiveDate,
      point.recordedAt,
      point.reportedAt,
      point.grain,
      point.statistic,
      point.source.family,
      point.source.kind,
      point.source.recordId,
      point.source.resultIndex,
      point.source.path,
      point.confidence,
      stringifyStoredMetricPointPayload(point),
    );
  });
}

export function insertMetricTargets(
  database: DatabaseSync,
  metricTargets: readonly QueryMetricTargetRow[],
): void {
  const insertMetricTarget = database.prepare(`
    INSERT INTO query_metric_targets (
      id,
      goal_id,
      metric_key,
      biomarker_key,
      comparator,
      target_value,
      target_unit,
      target_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  metricTargets.forEach((entry) => {
    insertMetricTarget.run(
      entry.id,
      entry.goalId,
      entry.target.metricKey,
      entry.target.biomarkerKey ?? null,
      entry.target.comparator,
      entry.target.value,
      entry.target.unit,
      JSON.stringify(entry.target),
    );
  });
}

export function listStoredMetricPoints(
  location: QueryProjectionLocation,
  filters: QueryMetricPointFilters,
): MetricPoint[] {
  const database = openQueryProjectionDatabase(location, {
    create: false,
    readOnly: true,
  });

  try {
    assertQueryProjectionTables(database, location);

    const whereClauses: string[] = [];
    const parameters: Array<string | number> = [];

    if (filters.metricKey) {
      whereClauses.push("metric_key = ?");
      parameters.push(filters.metricKey);
    }
    if (filters.biomarkerKey) {
      whereClauses.push("biomarker_key = ?");
      parameters.push(filters.biomarkerKey);
    }
    if (filters.from) {
      whereClauses.push("effective_date >= ?");
      parameters.push(filters.from);
    }
    if (filters.to) {
      whereClauses.push("effective_date <= ?");
      parameters.push(filters.to);
    }

    const limit = filters.limit === null ? null : normalizeMetricPointLimit(filters.limit ?? 1_000);
    const limitSql = limit === null ? "" : "LIMIT ?";
    if (limit !== null) {
      parameters.push(limit);
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const rows = database.prepare(`
      SELECT
        id,
        metric_key,
        biomarker_key,
        value,
        text_value,
        comparator,
        unit,
        canonical_value,
        canonical_unit,
        observed_at,
        effective_date,
        recorded_at,
        reported_at,
        grain,
        statistic,
        source_family,
        source_kind,
        source_record_id,
        source_result_index,
        source_path,
        confidence,
        metric_point_json
      FROM query_metric_points
      ${whereSql}
      ORDER BY effective_date DESC, observed_at DESC, id ASC
      ${limitSql}
    `).all(...parameters);

    return rows
      .map(decodeStoredMetricPoint)
      .filter((point): point is MetricPoint => point !== null);
  } finally {
    database.close();
  }
}

export function normalizeMetricPointFilters(filters: QueryMetricPointFilters): QueryMetricPointFilters {
  const definition = filters.metricKey
    ? resolveMetricDefinition(filters.metricKey)
    : filters.biomarkerKey
      ? resolveMetricDefinitionForBiomarker(filters.biomarkerKey)
      : null;
  return {
    ...filters,
    ...(filters.metricKey || definition ? {
      metricKey: definition?.key ?? (filters.metricKey ? normalizeMetricKey(filters.metricKey) : undefined),
    } : {}),
  };
}

export function metricPointFiltersForGoalTarget(
  target: GoalMetricTarget,
  now: string | undefined,
): QueryMetricPointFilters {
  const filters: QueryMetricPointFilters = {
    limit: 10_000,
    metricKey: target.metricKey,
  };
  const range = metricTargetDateRange(target, now);
  if (range.from) filters.from = range.from;
  if (range.to) filters.to = range.to;
  if (filters.from || filters.to) filters.limit = null;
  return normalizeMetricPointFilters(filters);
}

export function listStoredMetricTargets(location: QueryProjectionLocation): QueryMetricTargetRow[] {
  const database = openQueryProjectionDatabase(location, { create: false, readOnly: true });
  try {
    assertQueryProjectionTables(database, location);
    const rows = database.prepare(`
      SELECT id, goal_id AS goalId, target_json AS targetJson
      FROM query_metric_targets
      ORDER BY goal_id ASC, id ASC
    `).all() as Array<{ goalId: string; id: string; targetJson: string }>;
    return rows.flatMap((row) => {
      const target = parseJsonValue<GoalMetricTarget | null>(row.targetJson, null);
      return target ? [{ goalId: row.goalId, id: row.id, target }] : [];
    });
  } finally {
    database.close();
  }
}

export function extractMetricTargetsFromCanonicalEntities(
  entities: readonly CanonicalEntity[],
): QueryMetricTargetRow[] {
  return entities
    .filter((entity) => entity.family === "goal")
    .flatMap((entity) =>
      parseGoalMetricTargets(entity).map((target) => ({
        goalId: entity.entityId,
        id: `${entity.entityId}:${target.targetId}`,
        target,
      }))
    );
}

function normalizeMetricPointLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    return 1_000;
  }
  return Math.min(value, 10_000);
}

function stringifyStoredMetricPointPayload(point: MetricPoint): string {
  const payload: StoredMetricPointPayload = {};
  const context = compactStoredMetricPointContext(point.context);
  const provenance = compactStoredMetricPointProvenance(point);
  const storedValue = point.canonicalValue ?? point.value;
  const storedUnit = point.canonicalUnit ?? point.unit;

  if (!isEmptyRecord(context)) {
    payload.context = context;
  }
  if (!isEmptyRecord(provenance)) {
    payload.provenance = provenance;
  }
  if (point.value !== storedValue) {
    payload.value = point.value;
  }
  if (point.unit !== storedUnit) {
    payload.unit = point.unit;
  }

  return JSON.stringify(payload);
}

function compactStoredMetricPointContext(context: MetricPointContext): MetricPointContext {
  const compact: MetricPointContext = {};
  const compactRecord = compact as Record<string, unknown>;
  const record = context as Record<string, unknown>;

  for (const key of METRIC_POINT_CONTEXT_STORAGE_KEYS) {
    const value = record[key];
    if (value !== undefined) {
      compactRecord[key] = value;
    }
  }

  return compact;
}

function compactStoredMetricPointProvenance(point: MetricPoint): StoredMetricPointProvenance {
  const compact: StoredMetricPointProvenance = {};
  if (point.provenance.labName) {
    compact.labName = point.provenance.labName;
  }
  if (point.provenance.provider) {
    compact.provider = point.provenance.provider;
  }
  if (point.source.kind === "test-result" && point.provenance.rawRefs.length > 0) {
    compact.rawRefs = point.provenance.rawRefs;
  }
  if (point.provenance.sourceLabel) {
    compact.sourceLabel = point.provenance.sourceLabel;
  }
  return compact;
}

function decodeStoredMetricPoint(row: SqliteRow): MetricPoint | null {
  const sourceKind = expectString(row.source_kind, "query_metric_points.source_kind");
  const payload = readStoredMetricPointPayload(
    expectString(row.metric_point_json, "query_metric_points.metric_point_json"),
    sourceKind,
  );

  return {
    biomarkerKey: expectNullableString(row.biomarker_key, "query_metric_points.biomarker_key"),
    canonicalUnit: expectNullableString(row.canonical_unit, "query_metric_points.canonical_unit"),
    canonicalValue: expectNullableNumber(row.canonical_value, "query_metric_points.canonical_value"),
    comparator: expectMetricComparator(row.comparator),
    confidence: expectMetricConfidence(row.confidence),
    context: payload.context,
    effectiveDate: expectString(row.effective_date, "query_metric_points.effective_date"),
    grain: expectMetricGrain(row.grain),
    id: expectString(row.id, "query_metric_points.id"),
    metricKey: expectString(row.metric_key, "query_metric_points.metric_key"),
    observedAt: expectString(row.observed_at, "query_metric_points.observed_at"),
    provenance: payload.provenance,
    recordedAt: expectNullableString(row.recorded_at, "query_metric_points.recorded_at"),
    reportedAt: expectNullableString(row.reported_at, "query_metric_points.reported_at"),
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
    source: {
      family: expectMetricSourceFamily(row.source_family),
      kind: sourceKind,
      path: expectString(row.source_path, "query_metric_points.source_path"),
      recordId: expectString(row.source_record_id, "query_metric_points.source_record_id"),
      resultIndex: expectNullableNumber(row.source_result_index, "query_metric_points.source_result_index"),
    },
    statistic: expectMetricStatistic(row.statistic),
    textValue: expectNullableString(row.text_value, "query_metric_points.text_value"),
    unit: payload.unit === undefined ? expectNullableString(row.unit, "query_metric_points.unit") : payload.unit,
    value: payload.value === undefined ? expectNullableNumber(row.value, "query_metric_points.value") : payload.value,
  };
}

function readStoredMetricPointPayload(value: string, sourceKind: string): {
  context: MetricPointContext;
  provenance: MetricPointProvenance;
  unit: string | null | undefined;
  value: number | null | undefined;
} {
  const parsed = parseJsonValue<unknown>(value, null);
  const record = isRecord(parsed) ? parsed : {};

  return {
    context: compactStoredMetricPointContext(isRecord(record.context) ? record.context : {}),
    provenance: readStoredMetricPointProvenance(record.provenance, sourceKind),
    unit: Object.hasOwn(record, "unit") ? readNullableString(record.unit) : undefined,
    value: Object.hasOwn(record, "value") ? readNullableNumber(record.value) : undefined,
  };
}

function readStoredMetricPointProvenance(value: unknown, sourceKind: string): MetricPointProvenance {
  const record = isRecord(value) ? value : {};
  return {
    dataOrigin: null,
    externalRef: null,
    labName: readOptionalString(record.labName) ?? null,
    provider: readOptionalString(record.provider) ?? null,
    rawRefs: sourceKind === "test-result" ? readStringArray(record.rawRefs) : [],
    sourceLabel: readOptionalString(record.sourceLabel) ?? null,
  };
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${field} to be a string.`);
  }
  return value;
}

function expectNullableNumber(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number") {
    throw new TypeError(`Expected ${field} to be a number or null.`);
  }
  return value;
}

function expectMetricConfidence(value: unknown): MetricConfidence {
  const confidence = expectString(value, "query_metric_points.confidence");
  switch (confidence) {
    case "none":
    case "low":
    case "medium":
    case "high":
      return confidence;
    default:
      throw new TypeError(`Expected query_metric_points.confidence to be a metric confidence.`);
  }
}

function expectMetricComparator(value: unknown): MetricPoint["comparator"] {
  if (value === null) {
    return null;
  }
  const comparator = expectString(value, "query_metric_points.comparator");
  switch (comparator) {
    case "<":
    case "<=":
    case ">":
    case ">=":
      return comparator;
    default:
      throw new TypeError(`Expected query_metric_points.comparator to be a metric comparator.`);
  }
}

function expectMetricGrain(value: unknown): MetricGrain {
  const grain = expectString(value, "query_metric_points.grain");
  switch (grain) {
    case "instant":
    case "event":
    case "day":
    case "week":
    case "month":
    case "window":
      return grain;
    default:
      throw new TypeError(`Expected query_metric_points.grain to be a metric grain.`);
  }
}

function expectMetricSourceFamily(value: unknown): MetricSourceFamily {
  const family = expectString(value, "query_metric_points.source_family");
  switch (family) {
    case "derived":
    case "event":
    case "sample":
      return family;
    default:
      throw new TypeError(`Expected query_metric_points.source_family to be a metric source family.`);
  }
}

function expectMetricStatistic(value: unknown): MetricStatistic {
  const statistic = expectString(value, "query_metric_points.statistic");
  switch (statistic) {
    case "value":
    case "latest":
    case "mean":
    case "median":
    case "min":
    case "max":
    case "sum":
    case "count":
      return statistic;
    default:
      throw new TypeError(`Expected query_metric_points.statistic to be a metric statistic.`);
  }
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return readOptionalString(value) ?? null;
}

function readNullableNumber(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyRecord(value: object): boolean {
  return Object.keys(value).length === 0;
}

function metricTargetDateRange(
  target: GoalMetricTarget,
  now: string | undefined,
): { from?: string; to?: string } {
  if (target.evaluation.kind !== "rolling-window") {
    return dateRange(target.startAt, target.targetAt);
  }

  const anchorDate = rollingWindowQueryAnchorDate(target, now);
  if (!anchorDate) {
    return dateRange(target.startAt, target.targetAt);
  }

  return dateRange(
    maxIsoDate(target.startAt, subtractIsoDays(anchorDate, target.evaluation.windowDays - 1)),
    minIsoDate(target.targetAt, anchorDate) ?? anchorDate,
  );
}

function dateRange(from: string | undefined, to: string | undefined): { from?: string; to?: string } {
  const range: { from?: string; to?: string } = {};
  if (from) range.from = from;
  if (to) range.to = to;
  return range;
}

function rollingWindowQueryAnchorDate(target: GoalMetricTarget, now: string | undefined): string | null {
  const nowDate = now?.slice(0, 10) ?? null;
  if (nowDate && target.targetAt) return minIsoDate(nowDate, target.targetAt) ?? nowDate;
  return nowDate ?? target.targetAt ?? null;
}

function maxIsoDate(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function minIsoDate(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function subtractIsoDays(value: string, days: number): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) return value.slice(0, 10);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}
