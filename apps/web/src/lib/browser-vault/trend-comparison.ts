import type { BrowserVaultMetricRow } from "@murphai/query/browser";

import type { BiomarkerPageModel } from "@/src/lib/health-commons/biomarker-detail";

export interface TrendComparison {
  baselineValue: number;
  currentValue: number;
  delta: number;
  direction: "down" | "flat" | "up";
  label: string;
}

export type BrowserVaultMetricRowWithValue = BrowserVaultMetricRow & {
  value: number;
};

export function buildTrendComparison(
  rows: BrowserVaultMetricRowWithValue[],
  biomarker: BiomarkerPageModel,
): TrendComparison | null {
  const latest = rows.at(-1);

  if (!latest) {
    return null;
  }

  const currentStart = subtractIsoDays(latest.date, biomarker.trendDefaults.latestWindowDays - 1);
  const baselineStart = subtractIsoDays(currentStart, biomarker.trendDefaults.comparisonWindowDays);
  const currentRows = rows.filter((row) => row.date >= currentStart && row.date <= latest.date);
  const baselineRows = rows.filter((row) => row.date >= baselineStart && row.date < currentStart);

  if (currentRows.length === 0 || baselineRows.length < biomarker.trendDefaults.minimumPoints) {
    return null;
  }

  const currentValue = aggregateMetricRows(currentRows, biomarker.trendDefaults.aggregation);
  const baselineValue = aggregateMetricRows(baselineRows, biomarker.trendDefaults.aggregation);
  const delta = currentValue - baselineValue;
  const directionDelta = isPercentageUnit(biomarker.unit)
    ? delta
    : roundMetricValue(delta, biomarker.valuePrecision);
  const nearFlatThreshold = nearFlatThresholdForUnit(biomarker.unit);
  const direction = Math.abs(directionDelta) <= nearFlatThreshold + 1e-9
    ? "flat"
    : directionDelta < 0
      ? "down"
      : "up";

  return {
    baselineValue,
    currentValue,
    delta,
    direction,
    label: `${biomarker.trendDefaults.latestWindowDays}-day ${biomarker.trendDefaults.aggregation} vs prior ${biomarker.trendDefaults.comparisonWindowDays} days`,
  };
}

export function formatTrendDeltaSummary(input: {
  comparison: TrendComparison;
  precision: number;
  unit: string;
}): string {
  const absoluteDelta = Math.abs(roundMetricValue(input.comparison.delta, input.precision));
  const deltaUnit = formatTrendDeltaUnit(input.unit);
  const percentageUnit = isPercentageUnit(input.unit);

  if (input.comparison.direction === "flat") {
    if (percentageUnit) {
      return `within ${formatMetricValue(absoluteDelta, input.precision)} ${deltaUnit} of baseline`;
    }

    return `flat ${formatMetricValue(absoluteDelta, input.precision)} ${deltaUnit}`;
  }

  return `${input.comparison.direction} ${formatMetricValue(absoluteDelta, input.precision)} ${deltaUnit}`;
}

export function formatTrendDeltaUnit(unit: string): string {
  return isPercentageUnit(unit) ? "percentage points" : unit;
}

export function nearFlatThresholdForUnit(unit: string): number {
  const normalized = unit.trim().toLowerCase();

  if (normalized === "bpm") {
    return 0.5;
  }

  if (normalized === "ml/kg/min") {
    return 0.1;
  }

  if (isPercentageUnit(unit)) {
    return 0.5;
  }

  if (normalized === "minutes") {
    return 1;
  }

  return 0.01;
}

export function hasNumericMetricValue(row: BrowserVaultMetricRow): row is BrowserVaultMetricRowWithValue {
  return typeof row.value === "number" && Number.isFinite(row.value);
}

export function formatMetricValue(value: number, precision: number): string {
  return value.toFixed(precision);
}

export function roundMetricValue(value: number, precision: number): number {
  return Number(value.toFixed(precision));
}

function isPercentageUnit(unit: string): boolean {
  const normalized = unit.trim().toLowerCase();
  return normalized === "%" || normalized === "percent" || normalized.includes("percentage");
}

function aggregateMetricRows(
  rows: readonly BrowserVaultMetricRowWithValue[],
  aggregation: "mean" | "median",
): number {
  const values = rows.map((row) => row.value);

  if (aggregation === "mean") {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  const sorted = values.slice().sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
  }

  return sorted[midpoint] ?? 0;
}

function subtractIsoDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}
