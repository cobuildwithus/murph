import {
  biomarkerSelectionKeys,
  createCustomMetricDefinition,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  resolveMetricInputKey,
  uniqueStrings,
} from "./catalog.ts";
import { formatMetricDisplayValue, formatNumber } from "./format.ts";
import { selectMetricValue } from "./selectors.ts";
import type {
  ListMetricPointsInput,
  MetricConfidence,
  MetricDefinition,
  MetricPoint,
  MetricSelectionWarning,
  MetricSeries,
  MetricSeriesAggregation,
  MetricSeriesDuplicatePolicy,
  MetricSeriesPoint,
  MetricStatistic,
  SelectMetricSeriesInput,
} from "./types.ts";

export function listMetricPoints(input: ListMetricPointsInput): MetricPoint[] {
  const definitionFromBiomarker = input.biomarkerKey ? resolveMetricDefinitionForBiomarker(input.biomarkerKey) : null;
  const requestedMetricKey = input.metricKey !== undefined && input.metricKey !== null;
  const metricKey = requestedMetricKey ? resolveMetricInputKey(input.metricKey ?? "") : definitionFromBiomarker?.key ?? null;
  if (requestedMetricKey && !metricKey) {
    return [];
  }

  const biomarkerKeys = input.biomarkerKey
    ? biomarkerSelectionKeys(input.biomarkerKey, definitionFromBiomarker)
    : null;
  return input.points
    .filter((point) => !metricKey || point.metricKey === metricKey)
    .filter((point) => !biomarkerKeys || (point.biomarkerKey !== null && biomarkerKeys.includes(point.biomarkerKey)))
    .filter((point) => !input.from || point.effectiveDate >= input.from)
    .filter((point) => !input.to || point.effectiveDate <= input.to)
    .filter((point) => !input.grain || point.grain === input.grain)
    .filter((point) => !input.statistic || point.statistic === input.statistic)
    .sort(compareMetricPointsAsc);
}

export function buildMetricSeries(input: ListMetricPointsInput): MetricPoint[] {
  return listMetricPoints(input);
}

export function selectMetricSeries(input: SelectMetricSeriesInput): MetricSeries {
  const definitionFromBiomarker = input.biomarkerKey ? resolveMetricDefinitionForBiomarker(input.biomarkerKey) : null;
  const hasRequestedMetricKey = input.metricKey !== undefined && input.metricKey !== null;
  const requestedMetricKey = hasRequestedMetricKey ? resolveMetricInputKey(input.metricKey ?? "") : definitionFromBiomarker?.key ?? null;
  const points = listMetricPoints(input);
  const resolvedMetricKey = requestedMetricKey || points[0]?.metricKey || "unknown";
  const definition = resolveMetricDefinition(resolvedMetricKey) ?? createCustomMetricDefinition(resolvedMetricKey);
  const minimumPoints = input.minimumPoints ?? 0;
  const warnings = collectSeriesWarnings({ definition, minimumPoints, points });

  if (points.length === 0) {
    return {
      biomarkerKey: input.biomarkerKey ?? definition.biomarkerKey ?? null,
      metricKey: definition.key,
      provenance: { pointIds: [], recordIds: [], sourceKinds: [] },
      rows: [],
      status: "no_data",
      warnings,
    };
  }

  if (minimumPoints > 0 && points.length < minimumPoints) {
    return {
      biomarkerKey: input.biomarkerKey ?? definition.biomarkerKey ?? null,
      metricKey: definition.key,
      provenance: seriesProvenance(points),
      rows: [],
      status: "insufficient_data",
      warnings,
    };
  }

  const rows = input.aggregation
    ? aggregateMetricSeriesPoints(points, definition, input.aggregation)
    : selectMetricSeriesRowsByPolicy(points, definition, input.duplicatePolicy ?? "selection-policy");

  return {
    biomarkerKey: input.biomarkerKey ?? rows[0]?.biomarkerKey ?? definition.biomarkerKey ?? null,
    metricKey: definition.key,
    provenance: seriesProvenance(points),
    rows,
    status: rows.length > 0 ? "ready" : "no_data",
    warnings,
  };
}

function selectMetricSeriesRowsByPolicy(
  points: readonly MetricPoint[],
  definition: MetricDefinition,
  duplicatePolicy: MetricSeriesDuplicatePolicy,
): MetricSeriesPoint[] {
  if (duplicatePolicy === "keep-all") {
    return points.map((point) => metricPointToSeriesPoint(point, definition));
  }

  return groupMetricPointsByDate(points).flatMap((datePoints) => {
    const selected = duplicatePolicy === "selection-policy"
      ? selectMetricValue({ metricKey: definition.key, points: datePoints }).point ?? datePoints.at(-1) ?? null
      : datePoints.at(-1) ?? null;

    return selected ? [metricPointToSeriesPoint(selected, definition)] : [];
  });
}

function aggregateMetricSeriesPoints(
  points: readonly MetricPoint[],
  definition: MetricDefinition,
  aggregation: MetricSeriesAggregation,
): MetricSeriesPoint[] {
  return groupMetricPointsByDate(points).flatMap((datePoints) => {
    const useCanonicalValues = aggregation !== "count" && definition.canonicalUnit !== null;
    if (useCanonicalValues && datePoints.some((point) => point.value !== null && point.canonicalValue === null)) {
      return [];
    }

    const values = datePoints
      .map((point) => useCanonicalValues ? point.canonicalValue : pointNumericValue(point))
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    if (values.length === 0 && aggregation !== "count") {
      return [];
    }

    const first = datePoints[0];
    if (!first) {
      return [];
    }

    const observedAt = datePoints
      .map((point) => point.observedAt)
      .sort()
      .at(-1) ?? first.observedAt;
    const value = aggregateMetricValues(values, aggregation);
    const sourceKinds = uniqueStrings(datePoints.map((point) => point.source.kind));
    const recordIds = uniqueStrings(datePoints.flatMap(metricPointRecordIds));
    const pointIds = uniqueStrings(datePoints.map((point) => point.id));
    const unit = aggregation === "count"
      ? "count"
      : useCanonicalValues
        ? definition.canonicalUnit
        : first.canonicalUnit ?? first.unit ?? definition.displayUnit;
    const statistic: MetricStatistic = aggregation;

    return [{
      biomarkerKey: first.biomarkerKey,
      comparator: null,
      confidence: highestMetricConfidence(datePoints.map((point) => point.confidence)),
      context: {
        aggregatePointCount: datePoints.length,
        aggregation,
      },
      date: first.effectiveDate,
      grain: first.grain === "instant" || first.grain === "event" ? "day" : first.grain,
      id: `metric-series:${definition.key}:${first.effectiveDate}:${aggregation}`,
      metricKey: definition.key,
      observedAt,
      pointIds,
      recordIds,
      sourceFamily: datePoints.length === 1 ? first.source.family : "derived",
      sourceKind: datePoints.length === 1 ? first.source.kind : "metric-series",
      sourceKinds,
      sourceLabel: uniqueStrings(datePoints.map((point) => point.provenance.sourceLabel)).join(", ") || null,
      statistic,
      unit,
      value,
      valueLabel: value === null ? null : formatAggregatedMetricValue(value, definition, unit),
    }];
  });
}

function metricPointToSeriesPoint(point: MetricPoint, definition: MetricDefinition): MetricSeriesPoint {
  return {
    biomarkerKey: point.biomarkerKey,
    comparator: point.comparator,
    confidence: point.confidence,
    context: point.context,
    date: point.effectiveDate,
    grain: point.grain,
    id: `metric-series:${point.id}`,
    metricKey: point.metricKey,
    observedAt: point.observedAt,
    pointIds: [point.id],
    recordIds: metricPointRecordIds(point),
    sourceFamily: point.source.family,
    sourceKind: point.source.kind,
    sourceKinds: [point.source.kind],
    sourceLabel: point.provenance.sourceLabel,
    statistic: point.statistic,
    unit: point.canonicalUnit ?? point.unit ?? definition.displayUnit,
    value: pointNumericValue(point),
    valueLabel: formatMetricDisplayValue(point, definition),
  };
}

function collectSeriesWarnings(input: {
  definition: MetricDefinition;
  minimumPoints: number;
  points: readonly MetricPoint[];
}): MetricSelectionWarning[] {
  const warnings: MetricSelectionWarning[] = [];
  const sourceKinds = uniqueStrings(input.points.map((point) => point.source.kind));
  const methodKeys = uniqueStrings(input.points.map((point) =>
    typeof point.context.measurementMethodKey === "string" ? point.context.measurementMethodKey : null
  ));

  if (input.minimumPoints > 0 && input.points.length > 0 && input.points.length < input.minimumPoints) {
    warnings.push({
      code: "LOW_SAMPLE_COUNT",
      message: `Only ${input.points.length} point${input.points.length === 1 ? "" : "s"} were available for ${input.definition.displayName}.`,
    });
  }

  if (sourceKinds.length > 1) {
    warnings.push({
      code: "MIXED_SOURCES",
      message: `${input.definition.displayName} series includes multiple source types: ${sourceKinds.join(", ")}.`,
    });
  }

  if (methodKeys.length > 1) {
    warnings.push({
      code: "METHOD_CHANGED",
      message: `${input.definition.displayName} series includes multiple measurement methods.`,
    });
  }

  if (input.points.some((point) => point.comparator !== null)) {
    warnings.push({
      code: "COMPARATOR_VALUE",
      message: `${input.definition.displayName} series includes comparator values such as < or >.`,
    });
  }

  if (input.definition.canonicalUnit && input.points.some((point) =>
    point.value !== null && point.canonicalValue === null && point.canonicalUnit === null
  )) {
    warnings.push({
      code: "UNIT_NOT_NORMALIZED",
      message: `${input.definition.displayName} series includes values that could not be normalized to ${input.definition.canonicalUnit}.`,
    });
  }

  return warnings;
}

function groupMetricPointsByDate(points: readonly MetricPoint[]): MetricPoint[][] {
  const groups = new Map<string, MetricPoint[]>();
  for (const point of points) {
    const existing = groups.get(point.effectiveDate) ?? [];
    existing.push(point);
    groups.set(point.effectiveDate, existing);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, datePoints]) => datePoints.sort(compareMetricPointsAsc));
}

function pointNumericValue(point: MetricPoint): number | null {
  return point.canonicalValue ?? point.value;
}

function metricPointRecordIds(point: MetricPoint): string[] {
  const contributingRecordIds = point.context.contributingRecordIds;
  if (Array.isArray(contributingRecordIds)) {
    return uniqueStrings([
      ...contributingRecordIds.filter((value): value is string => typeof value === "string" && value.length > 0),
      point.source.recordId,
    ]);
  }

  return [point.source.recordId];
}

function aggregateMetricValues(values: readonly number[], aggregation: MetricSeriesAggregation): number {
  switch (aggregation) {
    case "count":
      return values.length;
    case "max":
      return Math.max(...values);
    case "mean":
      return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
    case "median":
      return median(values);
    case "min":
      return Math.min(...values);
    case "sum":
      return Number(values.reduce((sum, value) => sum + value, 0).toFixed(4));
  }
}

function median(values: readonly number[]): number {
  const sorted = values.slice().sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number((((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2).toFixed(4))
    : sorted[midpoint] ?? 0;
}

function seriesProvenance(points: readonly MetricPoint[]): MetricSeries["provenance"] {
  return {
    pointIds: uniqueStrings(points.map((point) => point.id)),
    recordIds: uniqueStrings(points.flatMap(metricPointRecordIds)),
    sourceKinds: uniqueStrings(points.map((point) => point.source.kind)),
  };
}

function highestMetricConfidence(values: readonly MetricConfidence[]): MetricConfidence {
  const rank: Record<MetricConfidence, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
  };
  return values.reduce<MetricConfidence>((best, value) => rank[value] > rank[best] ? value : best, "none");
}

function formatAggregatedMetricValue(value: number, definition: MetricDefinition, unit: string | null): string {
  const precision = unit === "count" ? 0 : definition.valuePrecision;
  return formatNumber(value, precision);
}

export function compareMetricPointsAsc(left: MetricPoint, right: MetricPoint): number {
  if (left.effectiveDate !== right.effectiveDate) return left.effectiveDate.localeCompare(right.effectiveDate);
  if (left.observedAt !== right.observedAt) return left.observedAt.localeCompare(right.observedAt);
  return left.id.localeCompare(right.id);
}
