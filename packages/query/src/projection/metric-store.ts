import {
  normalizeMetricKey,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  type GoalMetricTarget,
  type MetricPoint,
} from "@murphai/health-metrics";

import type { CanonicalEntity } from "../canonical-entities.ts";
import { parseGoalMetricTargets } from "../metrics/index.ts";
import type {
  QueryMetricPointFilters,
  QueryMetricTargetRow,
} from "../query-projection-types.ts";
import {
  assertQueryProjectionTables,
  openQueryProjectionDatabase,
  parseJsonValue,
  type DatabaseSync,
  type QueryProjectionLocation,
} from "./schema.ts";

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
      provenance_json,
      context_json,
      metric_point_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(point.provenance),
      JSON.stringify(point.context),
      JSON.stringify(point),
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
      SELECT metric_point_json
      FROM query_metric_points
      ${whereSql}
      ORDER BY effective_date DESC, observed_at DESC, id ASC
      ${limitSql}
    `).all(...parameters) as Array<{ metric_point_json: string }>;

    return rows
      .map((row) => parseJsonValue<MetricPoint | null>(row.metric_point_json, null))
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
