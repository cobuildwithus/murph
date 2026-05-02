import type { MetricSeriesPoint } from "./types.ts";

export type MetricAggregation = "mean" | "median" | "min" | "max" | "sum";

type MetricConfidence = "none" | "low" | "medium" | "high";
type MetricSelectionWarningCode =
  | "COMPARATOR_VALUE"
  | "LOW_SAMPLE_COUNT"
  | "METHOD_CHANGED"
  | "MIXED_SOURCES"
  | "SOURCE_STALE"
  | "UNIT_NOT_NORMALIZED";

interface MetricSelectionWarning {
  code: MetricSelectionWarningCode;
  message: string;
}

interface MetricTrendPolicyLike {
  aggregation: MetricAggregation;
  comparisonWindowDays?: number;
  latestWindowDays?: number;
  minimumPoints?: number;
}

export type MetricWindowComparisonStatus =
  | "ready"
  | "no_data"
  | "insufficient_data"
  | "unsupported";

export interface MetricWindowRange {
  end: string | null;
  start: string | null;
  totalDays?: number;
}

export interface MetricWindowSummary {
  daysWithData: number;
  end: string | null;
  pointIds: string[];
  recordIds: string[];
  start: string | null;
  totalDays: number;
  unit: string | null;
  value: number | null;
}

export interface MetricWindowComparison {
  baseline: MetricWindowSummary;
  comparison: MetricWindowSummary;
  delta: number | null;
  deltaPercent: number | null;
  metricKey: string;
  status: MetricWindowComparisonStatus;
  statistic: MetricAggregation;
  unit: string | null;
  warnings: MetricSelectionWarning[];
}

export interface MetricTrend {
  aggregation: MetricAggregation;
  baselineValue: number;
  comparisonWindowDays: number;
  currentValue: number;
  delta: number;
  direction: "down" | "flat" | "up";
  label: string;
  latestWindowDays: number;
}

export function selectMetricWindowComparison(input: {
  baselineWindow: MetricWindowRange;
  comparisonWindow: MetricWindowRange;
  metricKey: string;
  minimumPoints?: number;
  points: readonly MetricSeriesPoint[];
  statistic?: MetricAggregation;
}): MetricWindowComparison {
  const statistic = input.statistic ?? "mean";
  const minimumPoints = input.minimumPoints ?? 1;
  const metricRows = input.points.filter((point) => point.metricKey === input.metricKey);
  const baseline = summarizeMetricWindow(metricRows, input.baselineWindow, statistic);
  const comparison = summarizeMetricWindow(metricRows, input.comparisonWindow, statistic);
  const warnings = buildWindowWarnings(baseline, comparison);
  const status = selectWindowStatus({
    baseline,
    comparison,
    minimumPoints,
    windowCount: countAvailableWindows(input.baselineWindow, input.comparisonWindow),
  });
  const unit = comparison.unit ?? baseline.unit;
  const delta = baseline.value !== null && comparison.value !== null
    ? comparison.value - baseline.value
    : null;
  const deltaPercent = delta !== null && baseline.value !== null && baseline.value !== 0
    ? (delta / Math.abs(baseline.value)) * 100
    : null;

  return {
    baseline,
    comparison,
    delta,
    deltaPercent,
    metricKey: input.metricKey,
    status,
    statistic,
    unit,
    warnings,
  };
}

export function selectMetricTrend(input: {
  latestDate?: string;
  metricKey: string;
  points: readonly MetricSeriesPoint[];
  policy: MetricTrendPolicyLike;
  unit?: string | null;
  valuePrecision?: number;
}): MetricTrend | null {
  const rows = input.points
    .filter((point) => point.metricKey === input.metricKey && hasNumericValue(point))
    .sort(compareMetricSeriesPointsAsc);
  const latest = input.latestDate
    ? input.latestDate.slice(0, 10)
    : rows.at(-1)?.date ?? null;
  const latestWindowDays = input.policy.latestWindowDays ?? 7;
  const comparisonWindowDays = input.policy.comparisonWindowDays ?? 30;
  const minimumPoints = input.policy.minimumPoints ?? 1;

  if (!latest) {
    return null;
  }

  const currentStart = subtractIsoDays(latest, latestWindowDays - 1);
  const baselineEnd = subtractIsoDays(currentStart, 1);
  const baselineStart = subtractIsoDays(currentStart, comparisonWindowDays);
  const comparison = selectMetricWindowComparison({
    baselineWindow: {
      end: baselineEnd,
      start: baselineStart,
      totalDays: comparisonWindowDays,
    },
    comparisonWindow: {
      end: latest,
      start: currentStart,
      totalDays: latestWindowDays,
    },
    metricKey: input.metricKey,
    minimumPoints,
    points: rows,
    statistic: input.policy.aggregation,
  });

  if (
    comparison.status !== "ready" ||
    comparison.baseline.value === null ||
    comparison.comparison.value === null ||
    comparison.delta === null
  ) {
    return null;
  }

  const unit = input.unit ?? comparison.unit ?? "";
  const precision = input.valuePrecision ?? 1;
  const directionDelta = isPercentageUnit(unit)
    ? comparison.delta
    : roundMetricValue(comparison.delta, precision);
  const flatThreshold = nearFlatThresholdForUnit(unit);

  return {
    aggregation: input.policy.aggregation,
    baselineValue: comparison.baseline.value,
    comparisonWindowDays,
    currentValue: comparison.comparison.value,
    delta: comparison.delta,
    direction: Math.abs(directionDelta) <= flatThreshold + 1e-9
      ? "flat"
      : directionDelta < 0
        ? "down"
        : "up",
    label: `${latestWindowDays}-day ${input.policy.aggregation} vs prior ${comparisonWindowDays} days`,
    latestWindowDays,
  };
}

function summarizeMetricWindow(
  points: readonly MetricSeriesPoint[],
  window: MetricWindowRange,
  statistic: MetricAggregation,
): MetricWindowSummary {
  const rows = dedupeMetricRowsByDay(points
    .filter(hasNumericValue)
    .filter((point) => dateInWindow(point.date, window)));
  const values = rows.map((row) => row.value);
  const units = uniqueStrings(rows
    .map((row) => row.unit)
    .filter((unit): unit is string => typeof unit === "string" && unit.length > 0));

  return {
    daysWithData: rows.length,
    end: window.end,
    pointIds: uniqueStrings(rows.flatMap((row) => row.pointIds ?? (row.id ? [row.id] : []))),
    recordIds: uniqueStrings(rows.flatMap((row) => row.recordIds ?? [])),
    start: window.start,
    totalDays: window.totalDays ?? countWindowDays(window.start, window.end),
    unit: units.at(-1) ?? null,
    value: values.length > 0 ? aggregate(values, statistic) : null,
  };
}

function buildWindowWarnings(
  baseline: MetricWindowSummary,
  comparison: MetricWindowSummary,
): MetricSelectionWarning[] {
  const warnings: MetricSelectionWarning[] = [];
  const units = uniqueStrings([baseline.unit, comparison.unit]
    .filter((unit): unit is string => typeof unit === "string" && unit.length > 0));
  if (units.length > 1) {
    warnings.push({
      code: "UNIT_NOT_NORMALIZED",
      message: `Metric windows use mixed units: ${units.join(", ")}.`,
    });
  }
  return warnings;
}

function selectWindowStatus(input: {
  baseline: MetricWindowSummary;
  comparison: MetricWindowSummary;
  minimumPoints: number;
  windowCount: number;
}): MetricWindowComparisonStatus {
  if (input.windowCount < 2) {
    return "unsupported";
  }
  if (input.baseline.daysWithData === 0 && input.comparison.daysWithData === 0) {
    return "no_data";
  }
  if (
    input.baseline.daysWithData < input.minimumPoints ||
    input.comparison.daysWithData < input.minimumPoints
  ) {
    return "insufficient_data";
  }
  return "ready";
}

function dedupeMetricRowsByDay(
  points: readonly (MetricSeriesPoint & { value: number })[],
): Array<MetricSeriesPoint & { value: number }> {
  const byDate = new Map<string, MetricSeriesPoint & { value: number }>();
  for (const point of points.slice().sort(compareMetricSeriesPointsAsc)) {
    byDate.set(point.date, point);
  }
  return [...byDate.values()].sort(compareMetricSeriesPointsAsc);
}

function hasNumericValue(point: MetricSeriesPoint): point is MetricSeriesPoint & { value: number } {
  return typeof point.value === "number" && Number.isFinite(point.value);
}

function aggregate(values: readonly number[], statistic: MetricAggregation): number {
  if (values.length === 0) {
    return 0;
  }
  if (statistic === "sum") {
    return values.reduce((sum, value) => sum + value, 0);
  }
  if (statistic === "min") {
    return Math.min(...values);
  }
  if (statistic === "max") {
    return Math.max(...values);
  }
  if (statistic === "median") {
    const sorted = values.slice().sort((left, right) => left - right);
    const midpoint = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2
      : sorted[midpoint] ?? 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compareMetricSeriesPointsAsc(
  left: MetricSeriesPoint,
  right: MetricSeriesPoint,
): number {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  if ((left.observedAt ?? "") !== (right.observedAt ?? "")) {
    return (left.observedAt ?? "").localeCompare(right.observedAt ?? "");
  }
  return (left.id ?? "").localeCompare(right.id ?? "");
}

function dateInWindow(date: string, window: MetricWindowRange): boolean {
  if (!window.start || !window.end) return false;
  return date >= window.start && date <= window.end;
}

function countAvailableWindows(...windows: readonly MetricWindowRange[]): number {
  return windows.filter((window) => Boolean(window.start && window.end)).length;
}

function countWindowDays(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const startTime = Date.parse(`${start}T00:00:00.000Z`);
  const endTime = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return 0;
  return Math.floor((endTime - startTime) / ISO_DAY_MS) + 1;
}

function subtractIsoDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function roundMetricValue(value: number, precision: number): number {
  return Number(value.toFixed(precision));
}

function nearFlatThresholdForUnit(unit: string): number {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "bpm") return 0.5;
  if (normalized === "ml/kg/min") return 0.1;
  if (isPercentageUnit(unit)) return 0.5;
  if (normalized === "minutes") return 1;
  return 0.01;
}

function isPercentageUnit(unit: string): boolean {
  const normalized = unit.trim().toLowerCase();
  return normalized === "%" || normalized === "percent" || normalized.includes("percentage");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

const ISO_DAY_MS = 24 * 60 * 60 * 1000;
