import type { GoalMetricTarget, MetricDefinition, MetricPoint } from "./types.ts";

export function formatMetricDisplayValue(point: MetricPoint, definition: MetricDefinition | null = null): string | null {
  const numericValue = point.canonicalValue ?? point.value;
  if (numericValue === null || !Number.isFinite(numericValue)) {
    return point.textValue ?? "—";
  }
  const formatted = formatNumber(numericValue, definition?.valuePrecision ?? guessValuePrecision(point.canonicalUnit ?? point.unit));
  return point.comparator ? `${point.comparator}${formatted}` : formatted;
}

export function formatTargetValue(target: GoalMetricTarget, definition: MetricDefinition | null = null): string {
  const precision = definition?.valuePrecision ?? guessValuePrecision(target.unit);
  const value = formatNumber(target.value, precision);
  if (target.comparator === "between") {
    const highValue = target.highValue === undefined ? "?" : formatNumber(target.highValue, precision);
    return `${value}-${highValue} ${target.unit}`;
  }
  return `${target.comparator}${value} ${target.unit}`;
}

export function humanizeMetricKey(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function guessValuePrecision(unit: string | null | undefined): number {
  const normalized = normalizeDisplayUnit(unit);
  if (!normalized) return 0;
  if (["bpm", "count", "minutes", "ms", "ng/ml", "u/l"].includes(normalized)) return 0;
  if (["mg/dl", "mg/l", "percent", "%", "score"].includes(normalized)) return 1;
  return 1;
}

export function formatNumber(value: number, precision: number): string {
  if (precision <= 0) return Math.round(value).toString();
  return value.toFixed(precision).replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
}

function normalizeDisplayUnit(value: string | null | undefined): string | null {
  return value ? value.trim().toLowerCase() : null;
}
